import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { GenerationEvent } from "@/lib/generation-events";
import { buildGeneratedWorkspace } from "@/server/build";
import {
  describeUnresolvedImports,
  findUnresolvedImports,
  isRepairableByAgent,
} from "@/server/build/imports";
import { getServerEnv } from "@/server/env";
import { getGameGenerationProvider } from "@/server/llm";
import { generationPlanSchema, planNeedsClarification } from "@/server/llm/plan";
import {
  SPEC_PATH,
  appendChangelog,
  extractChangelog,
  readSpecMarkdown,
  renderSpecMarkdown,
} from "@/server/llm/spec";
import type { ConversationTurn, PlanInput } from "@/server/llm/types";
import { createGameWorkspace } from "@/server/template/game-template";
import type { AgentFile, GeneratedWorkspace } from "@/server/workspace/schema";
import {
  extractAgentFiles,
  mergeAgentFiles,
  redactBuildLog,
  validateAgentFiles,
  validateWorkspace,
} from "@/server/workspace/schema";

/** How much conversation to replay. Enough for context, bounded for cost. */
const HISTORY_TURNS = 12;
const PLAN_MAX_MS = 60_000;
/** Left for the build and for persisting, after the last model call. */
const TAIL_RESERVE_MS = 100_000;
/** Below this, a repair pass cannot finish, so it is not started. */
const REPAIR_MIN_MS = 70_000;

export interface GenerationProject {
  id: string;
  title: string;
  original_prompt: string;
  current_version_id: string | null;
}

export type GenerationStage =
  | "planning"
  | "writing"
  | "building"
  | "saving"
  | "succeeded"
  | "failed";

/** What a previous attempt already finished, loaded from the job row. */
export interface GenerationCheckpoint {
  stage: GenerationStage;
  plan?: unknown;
  draftFiles?: Record<string, string>;
  draftArtifactHtml?: string;
  attempts: number;
}

export interface ExecuteGenerationInput {
  supabase: SupabaseClient;
  project: GenerationProject;
  prompt: string;
  kind: "create" | "edit";
  /** Present only in live mode; demo runs reserve nothing. */
  jobId?: string;
  /** Present when resuming a run that stopped part-way. */
  checkpoint?: GenerationCheckpoint;
  emit: (event: GenerationEvent) => void;
}

export function readableGenerationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("generation_disabled")) return "生成能力暂未开放。";
  if (message.includes("global_budget_exhausted"))
    return "今日公共生成预算已用完。";
  if (message.includes("create_credit_exhausted"))
    return "你的新建游戏额度已用完。";
  if (message.includes("edit_credit_exhausted")) return "你的修改额度已用完。";
  if (message.includes("rate_limit_exceeded"))
    return "请求过于频繁，请一分钟后再试。";
  if (message.includes("duplicate key")) return "已有生成任务正在进行。";
  if (message.includes("snapshot_unreadable"))
    return "上一个版本的源码快照损坏，无法在其基础上修改。";
  if (message.includes("plan_timed_out"))
    return "理解需求这一步超时了。稍后再试一次通常就好。";
  if (/timed_out|aborted|AbortError|deadline/i.test(message))
    return "这一步超时了，稍后重试。";
  return "生成失败，请稍后重试。";
}

export function generationErrorDetail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return redactBuildLog(message || "unknown_generation_error").slice(0, 800);
}

function labelStage(error: unknown, stage: string): unknown {
  const message = error instanceof Error ? error.message : String(error);
  if (/abort/i.test(message)) {
    return new Error(`${stage}_timed_out: ${message}`);
  }
  return error;
}

/**
 * Runs a generation to completion, independent of any HTTP connection.
 *
 * Nothing here reads the request. It emits events to whoever is listening, and
 * finishes whether or not anyone still is — which is the point: a closed tab
 * should cost the user their view of the run, not the run.
 */
export async function executeGeneration({
  supabase,
  project,
  prompt,
  kind,
  jobId,
  checkpoint,
  emit,
}: ExecuteGenerationInput): Promise<void> {
  const env = getServerEnv();
  const startedAt = Date.now();
  const remainingMs = () =>
    env.GENERATION_DEADLINE_MS - (Date.now() - startedAt);

  /**
   * Commits what a stage produced, then advances to the next.
   *
   * One write for both, so a crash between them cannot leave a run claiming to
   * have finished work whose output was never stored.
   */
  // Where the work has actually reached. A failure records this, not the stage
  // the attempt started from, or resuming would redo everything it just did.
  let currentStage: GenerationStage = checkpoint?.stage ?? "planning";

  const checkpointAt = async (
    stage: GenerationStage,
    payload: {
      plan?: unknown;
      draftFiles?: Record<string, string>;
      artifactHtml?: string;
      error?: string;
    } = {},
  ) => {
    currentStage = stage;
    if (!jobId) return;
    await supabase.rpc("checkpoint_generation", {
      p_job_id: jobId,
      p_stage: stage,
      p_plan: payload.plan ?? null,
      p_draft_files: payload.draftFiles ?? null,
      p_artifact_html: payload.artifactHtml ?? null,
      p_error: payload.error ?? null,
    });
  };

  let settled = false;
  const settle = async (
    status: "succeeded" | "failed" | "cancelled",
    costUsd: number,
    errorCode: string | null,
  ) => {
    if (!jobId || settled) return;
    settled = true;
    await supabase.rpc("finalize_generation", {
      p_job_id: jobId,
      p_status: status,
      p_final_usd: costUsd,
      p_provider: "deepseek",
      p_model: env.DEEPSEEK_MODEL,
      p_input_tokens: 0,
      p_output_tokens: 0,
      p_error_code: errorCode,
    });
  };

  try {
    let previousWorkspace: GeneratedWorkspace | undefined;
    let versionNumber = 1;
    if (project.current_version_id) {
      const { data: previous } = await supabase
        .from("project_versions")
        .select("version_number, source_snapshot")
        .eq("id", project.current_version_id)
        .single();
      if (previous) {
        versionNumber = previous.version_number + 1;
        previousWorkspace = validateWorkspace(previous.source_snapshot);
      }
    }

    const { data: historyRows } = await supabase
      .from("messages")
      .select("role, content")
      .eq("project_id", project.id)
      .in("role", ["user", "assistant"])
      .order("created_at", { ascending: false })
      .limit(HISTORY_TURNS);
    const history = ((historyRows ?? []) as ConversationTurn[])
      .slice()
      .reverse();

    const specMarkdown = readSpecMarkdown(previousWorkspace);
    const input: PlanInput = {
      kind,
      prompt,
      originalPrompt: project.original_prompt,
      specMarkdown,
      history,
      previousWorkspace,
    };
    const provider = getGameGenerationProvider();

    // ---- Understand the request, or ask about it -------------------------
    // A resumed run keeps the plan it already agreed. Re-planning would not
    // only pay for the call twice, it would answer the same request differently
    // and quietly replace the work the earlier stages already produced.
    const storedPlan = checkpoint?.plan
      ? generationPlanSchema.safeParse(checkpoint.plan)
      : undefined;

    let plan;
    if (storedPlan?.success) {
      plan = storedPlan.data;
      emit({ type: "phase", phase: "planning", message: "沿用上次的计划" });
    } else {
      emit({ type: "phase", phase: "planning", message: "正在理解需求" });
      ({ plan } = await provider
        .plan({
          ...input,
          timeoutMs: Math.min(PLAN_MAX_MS, remainingMs() - TAIL_RESERVE_MS),
        })
        .catch((error: unknown) => {
          throw labelStage(error, "plan");
        }));
    }

    if (planNeedsClarification(plan)) {
      // Nothing was built, so nothing is charged.
      await settle("cancelled", 0, "needs_clarification");
      await Promise.all([
        supabase
          .from("projects")
          .update({ status: project.current_version_id ? "ready" : "draft" })
          .eq("id", project.id),
        supabase.from("messages").insert({
          project_id: project.id,
          role: "assistant",
          content: [
            plan.understanding,
            ...plan.questions.map(
              (item) => `· ${item.question}（${item.options.join(" / ")}）`,
            ),
          ].join("\n"),
          metadata: { questions: plan.questions },
        }),
      ]);
      emit({
        type: "question",
        understanding: plan.understanding,
        questions: plan.questions,
      });
      await checkpointAt("failed", { error: "needs_clarification" });
      return;
    }

    if (!plan.changes.length) {
      throw new Error("计划没有指出要改哪些文件。");
    }

    emit({
      type: "plan",
      understanding: plan.understanding,
      changes: plan.changes,
      assumptions: plan.assumptions,
    });

    // The prompt travels with the plan so a later attempt can tell a retry of
    // this request from a new instruction that happens to follow a failure.
    await checkpointAt("writing", { plan: { ...plan, prompt } });

    // ---- Write every planned file in one pass ----------------------------
    // Files already produced by an earlier attempt are reused. Rewriting them
    // would cost another call and return different code, so a build failure
    // would keep changing the game instead of fixing it.
    const resumedFiles = Object.entries(checkpoint?.draftFiles ?? {}).map(
      ([path, content]) => ({ path, content }),
    );
    let changed: AgentFile[];
    let providerName = "deepseek";

    if (resumedFiles.length) {
      changed = validateAgentFiles(resumedFiles) as AgentFile[];
      emit({ type: "phase", phase: "writing", message: "沿用已写好的文件" });
      for (const file of changed) {
        emit({ type: "file-open", path: file.path });
        emit({ type: "file-delta", path: file.path, text: file.content });
        emit({ type: "file-close", path: file.path });
      }
    } else {
      emit({ type: "phase", phase: "writing", message: "正在写代码" });
      const written = await provider
        .write({
          ...input,
          plan,
          onProgress: emit,
          timeoutMs: remainingMs() - TAIL_RESERVE_MS,
        })
        .catch((error: unknown) => {
          throw labelStage(error, "write");
        });
      changed = written.files;
      providerName = written.provider;
    }

    await checkpointAt("building", {
      draftFiles: Object.fromEntries(
        changed.map((file) => [file.path, file.content]),
      ),
    });

    // ---- Assemble, build, persist ----------------------------------------
    const previousAgentFiles = previousWorkspace
      ? extractAgentFiles(previousWorkspace)
      : [];
    const specContent = plan.spec
      ? renderSpecMarkdown(
          plan.spec,
          appendChangelog(
            extractChangelog(specMarkdown ?? ""),
            plan.changeSummary,
          ),
        )
      : specMarkdown;

    const assemble = (files: AgentFile[]) => {
      const merged = mergeAgentFiles(previousAgentFiles, files);
      const workspace = createGameWorkspace({
        // The project's name, not one derived from this turn. An edit changes
        // the game, never what the game is called.
        title: project.title,
        summary: plan.changeSummary,
        agentFiles: merged,
      });
      return {
        ...workspace,
        files: [
          ...workspace.files.filter((file) => file.path !== SPEC_PATH),
          ...(specContent ? [{ path: SPEC_PATH, content: specContent }] : []),
        ],
      } satisfies GeneratedWorkspace;
    };

    let workspace = assemble(changed);
    const prebuilt = provider.prebuiltArtifactHtml?.(input);

    emit({ type: "phase", phase: "building", message: "正在打包" });
    let build;
    try {
      // Cross-file references are decidable from the file list, so they are
      // caught here rather than after a bundler has spun up.
      const unresolved = findUnresolvedImports(workspace);
      if (unresolved.length) {
        const detail = describeUnresolvedImports(unresolved);
        emit({ type: "log", level: "error", message: detail });
        throw new Error(`import_unresolved: ${detail}`);
      }
      build = await buildGeneratedWorkspace(workspace, prebuilt);
    } catch (buildError) {
      const detail = generationErrorDetail(buildError);
      emit({ type: "log", level: "error", message: detail });
      if (remainingMs() < REPAIR_MIN_MS) throw buildError;
      if (!isRepairableByAgent(detail, changed.map((file) => file.path))) {
        throw buildError;
      }

      emit({ type: "phase", phase: "repairing", message: "出了点问题，正在修" });
      // Rewrites the whole set: a mismatched import is a disagreement between
      // two files, and fixing one end of it introduces the next failure.
      const fixed = await provider
        .write({
          ...input,
          plan,
          onProgress: emit,
          timeoutMs: remainingMs() - TAIL_RESERVE_MS,
          repair: { attempted: changed, error: detail },
        })
        .catch((error: unknown) => {
          throw labelStage(error, "repair");
        });
      workspace = assemble(fixed.files);
      build = await buildGeneratedWorkspace(workspace, prebuilt);
    }

    for (const entry of build.logs) {
      emit({ type: "log", level: entry.level, message: entry.message });
    }

    await checkpointAt("saving", { artifactHtml: build.artifactHtml });
    emit({ type: "phase", phase: "saving", message: "正在保存" });
    const { data: version, error: versionError } = await supabase
      .from("project_versions")
      .insert({
        project_id: project.id,
        version_number: versionNumber,
        status: "runnable",
        source_snapshot: workspace,
        artifact_html: build.artifactHtml,
        build_log: [
          { level: "info", message: "生成完成，打包通过。" },
          ...build.logs,
        ],
      })
      .select("id")
      .single();
    if (versionError || !version) throw versionError ?? new Error("No version");

    const { error: filesError } = await supabase.from("project_files").upsert(
      workspace.files.map((file) => ({
        project_id: project.id,
        path: file.path,
        content: file.content,
      })),
      { onConflict: "project_id,path" },
    );
    if (filesError) throw filesError;

    await Promise.all([
      supabase
        .from("projects")
        // `title` is deliberately absent: it was decided when the project was
        // created and every published card already carries it.
        .update({ status: "ready", current_version_id: version.id })
        .eq("id", project.id),
      supabase.from("messages").insert({
        project_id: project.id,
        role: "assistant",
        content: workspace.summary,
        metadata: {
          versionId: version.id,
          changedPaths: changed.map((file) => file.path),
          assumptions: plan.assumptions,
        },
      }),
    ]);

    await checkpointAt("succeeded");
    await settle("succeeded", 0.05, null);
    emit({ type: "done", versionNumber, provider: providerName });
  } catch (error) {
    const errorDetail = generationErrorDetail(error);
    console.error("[generation_failed]", {
      projectId: project.id,
      error: errorDetail,
    });
    await Promise.all([
      supabase
        .from("projects")
        .update({ status: project.current_version_id ? "ready" : "failed" })
        .eq("id", project.id),
      supabase.from("messages").insert({
        project_id: project.id,
        role: "assistant",
        content: readableGenerationError(error),
        metadata: { error: true, detail: errorDetail },
      }),
    ]);
    // The stage is left where it stopped, so the next attempt resumes there
    // rather than restarting. Only the error and attempt count move.
    await checkpointAt(currentStage, { error: errorDetail }).catch(
      () => undefined,
    );
    await settle("failed", 0, "generation_failed");
    emit({ type: "error", message: readableGenerationError(error) });
  }
}
