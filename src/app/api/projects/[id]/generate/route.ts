import { NextResponse } from "next/server";
import { z } from "zod";

import type { GenerationEvent } from "@/lib/generation-events";
import { encodeSseFrame } from "@/lib/sse";
import { createClient } from "@/lib/supabase/server";
import { buildGeneratedWorkspace } from "@/server/build";
import {
  describeUnresolvedImports,
  findUnresolvedImports,
  isRepairableByAgent,
} from "@/server/build/imports";
import { getServerEnv, isLiveGenerationReady } from "@/server/env";
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
  isEditableAgentPath,
  mergeAgentFiles,
  redactBuildLog,
  validateWorkspace,
} from "@/server/workspace/schema";

// The response is a long-lived stream; it must never be cached or prerendered.
export const dynamic = "force-dynamic";

/**
 * A generation runs as several requests rather than one.
 *
 * That started as a way to stay under a serverless wall clock, but the reason
 * it stayed is quality: asking for a whole game in one answer makes the model
 * hold the loop, the components and the styling in a single context and emit
 * them all at once, and the tail of that output is where it falls apart.
 */
const HISTORY_TURNS = 12;
const PLAN_MAX_MS = 60_000;
/** Left for persisting and, in the finish phase, for the build. */
const TAIL_RESERVE_MS = 100_000;
const REPAIR_MIN_MS = 70_000;

const paramsSchema = z.object({ id: z.uuid() });
const bodySchema = z.discriminatedUnion("phase", [
  z.object({
    phase: z.literal("plan"),
    prompt: z.string().trim().min(3).max(4000),
    kind: z.enum(["create", "edit"]).default("edit"),
    idempotencyKey: z.string().min(8).max(120),
  }),
  z.object({
    phase: z.literal("file"),
    jobId: z.uuid(),
    path: z.string().min(1).max(240),
  }),
  z.object({ phase: z.literal("finish"), jobId: z.uuid() }),
]);

function readableGenerationError(error: unknown) {
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
  if (message.includes("job_not_found"))
    return "这次生成的任务已经结束，请重新开始。";
  if (message.includes("plan_timed_out"))
    return "理解需求这一步超时了。稍后再试一次通常就好。";
  if (/timed_out|aborted|AbortError|deadline/i.test(message))
    return "这一步超时了。稍后重试，已经写好的文件会保留。";
  return "生成失败，请稍后重试。";
}

function generationErrorDetail(error: unknown) {
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

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const params = paramsSchema.safeParse(await context.params);
  const body = bodySchema.safeParse(await request.json());
  if (!params.success || !body.success) {
    return NextResponse.json({ error: "请求参数无效。" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }

  const { data: projectRow } = await supabase
    .from("projects")
    .select("id, user_id, original_prompt, current_version_id")
    .eq("id", params.data.id)
    .single();
  if (!projectRow || projectRow.user_id !== user.id) {
    return NextResponse.json({ error: "项目不存在。" }, { status: 404 });
  }

  // Bound outside the stream closure so its non-null narrowing survives.
  const project = projectRow;
  const phase = body.data;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: GenerationEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(encodeSseFrame(event)));
      };
      const env = getServerEnv();
      const startedAt = Date.now();
      const remainingMs = () =>
        env.GENERATION_DEADLINE_MS - (Date.now() - startedAt);

      let jobId: string | undefined;
      let settled = false;
      const settle = async (
        status: "succeeded" | "failed" | "cancelled",
        usage: { costUsd: number; inputTokens: number; outputTokens: number },
        providerName: string,
        model: string,
        errorCode: string | null,
      ) => {
        if (!jobId || settled) return;
        settled = true;
        await supabase.rpc("finalize_generation", {
          p_job_id: jobId,
          p_status: status,
          p_final_usd: usage.costUsd,
          p_provider: providerName,
          p_model: model,
          p_input_tokens: usage.inputTokens,
          p_output_tokens: usage.outputTokens,
          p_error_code: errorCode,
        });
      };

      /** Rebuilds the context every phase needs from the project's own state. */
      async function loadContext(kind: "create" | "edit", prompt: string) {
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

        const input: PlanInput = {
          kind,
          prompt,
          originalPrompt: project.original_prompt,
          specMarkdown: readSpecMarkdown(previousWorkspace),
          history,
          previousWorkspace,
        };
        return { input, versionNumber, previousWorkspace };
      }

      try {
        const provider = getGameGenerationProvider();

        // ---- Phase one: understand the request, or ask about it ------------
        if (phase.phase === "plan") {
          const { input } = await loadContext(phase.kind, phase.prompt);

          if (isLiveGenerationReady()) {
            send({ type: "phase", phase: "reserving", message: "正在确认额度" });
            const { data: job, error: reserveError } = await supabase.rpc(
              "reserve_generation",
              {
                p_project_id: project.id,
                p_kind: phase.kind,
                p_idempotency_key: phase.idempotencyKey,
                p_reserved_usd: 0.05,
              },
            );
            if (reserveError) throw reserveError;
            jobId = job?.id;
          }

          await Promise.all([
            supabase
              .from("projects")
              .update({ status: "generating" })
              .eq("id", project.id),
            supabase.from("messages").insert({
              project_id: project.id,
              role: "user",
              content: phase.prompt,
              metadata: { kind: phase.kind },
            }),
          ]);

          send({ type: "phase", phase: "planning", message: "正在理解需求" });
          const { plan, ...meta } = await provider
            .plan({
              ...input,
              timeoutMs: Math.min(PLAN_MAX_MS, remainingMs() - TAIL_RESERVE_MS),
            })
            .catch((error: unknown) => {
              throw labelStage(error, "plan");
            });

          if (planNeedsClarification(plan)) {
            await settle(
              "cancelled",
              {
                costUsd: 0,
                inputTokens: meta.usage.inputTokens,
                outputTokens: meta.usage.outputTokens,
              },
              meta.provider,
              meta.model,
              "needs_clarification",
            );
            await Promise.all([
              supabase
                .from("projects")
                .update({
                  status: project.current_version_id ? "ready" : "draft",
                })
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
                metadata: { questions: plan.questions, provider: meta.provider },
              }),
            ]);
            send({
              type: "question",
              understanding: plan.understanding,
              questions: plan.questions,
            });
            return;
          }

          if (!plan.changes.length) {
            throw new Error("计划没有指出要改哪些文件。");
          }

          if (jobId) {
            await supabase.rpc("save_generation_plan", {
              p_job_id: jobId,
              p_plan: { ...plan, prompt: phase.prompt, kind: phase.kind },
            });
          }

          send({
            type: "plan",
            understanding: plan.understanding,
            changes: plan.changes,
            assumptions: plan.assumptions,
          });
          // Demo mode has no job row, so the client gets a synthetic id and the
          // subsequent phases fall back to re-planning from the same prompt.
          send({
            type: "job",
            jobId: jobId ?? "demo",
            files: plan.changes.map((change) => change.path),
          });
          return;
        }

        // ---- Later phases: reload the agreed plan --------------------------
        const { data: jobRow } = await supabase
          .from("generation_jobs")
          .select("id, kind, plan, draft_files, status")
          .eq("id", phase.jobId)
          .maybeSingle();
        if (!jobRow || jobRow.status !== "running") {
          throw new Error("job_not_found");
        }
        jobId = jobRow.id as string;

        const stored = (jobRow.plan ?? {}) as Record<string, unknown>;
        const plan = generationPlanSchema.parse(stored);
        const storedPrompt =
          typeof stored.prompt === "string" ? stored.prompt : plan.understanding;
        const kind = (jobRow.kind as "create" | "edit") ?? "edit";
        const drafts = (jobRow.draft_files ?? {}) as Record<string, string>;
        const { input, versionNumber, previousWorkspace } = await loadContext(
          kind,
          storedPrompt,
        );

        // ---- Phase two: write exactly one file -----------------------------
        if (phase.phase === "file") {
          const change = plan.changes.find(
            (entry) => entry.path === phase.path,
          );
          if (!change || !isEditableAgentPath(change.path)) {
            throw new Error(`计划里没有这个文件：${phase.path}`);
          }

          send({
            type: "phase",
            phase: "writing",
            message: `正在写 ${change.path}`,
          });
          const written = await provider
            .writeFile({
              ...input,
              plan,
              path: change.path,
              intent: change.intent,
              drafts,
              onProgress: send,
              timeoutMs: remainingMs() - TAIL_RESERVE_MS,
            })
            .catch((error: unknown) => {
              throw labelStage(error, "write");
            });

          await supabase.rpc("save_generation_draft", {
            p_job_id: jobId,
            p_path: written.file.path,
            p_content: written.file.content,
          });

          const done = new Set([...Object.keys(drafts), written.file.path]);
          const next = plan.changes.find((entry) => !done.has(entry.path));
          send({
            type: "step-done",
            path: written.file.path,
            nextPath: next?.path,
          });
          return;
        }

        // ---- Phase three: assemble, build, persist -------------------------
        const changed = plan.changes
          .filter((entry) => typeof drafts[entry.path] === "string")
          .map((entry) => ({ path: entry.path, content: drafts[entry.path] }));
        if (!changed.length) {
          throw new Error("没有任何已写好的文件可以构建。");
        }

        const previousAgentFiles = previousWorkspace
          ? extractAgentFiles(previousWorkspace)
          : [];
        const specMarkdown = input.specMarkdown;
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
            title: plan.title,
            summary: plan.changeSummary,
            agentFiles: merged,
          });
          return {
            ...workspace,
            files: [
              ...workspace.files.filter((file) => file.path !== SPEC_PATH),
              ...(specContent
                ? [{ path: SPEC_PATH, content: specContent }]
                : []),
            ],
          } satisfies GeneratedWorkspace;
        };

        let workspace = assemble(changed as AgentFile[]);
        const prebuilt = provider.prebuiltArtifactHtml?.(input);

        // Cross-file references are the main failure mode of per-file writing,
        // and they are decidable from the file list. Catching them here costs
        // microseconds; catching them in the sandbox costs a microVM, a
        // dependency install and a repair call.
        const unresolved = findUnresolvedImports(workspace);
        if (unresolved.length) {
          send({
            type: "log",
            level: "error",
            message: describeUnresolvedImports(unresolved),
          });
        }

        send({ type: "phase", phase: "building", message: "正在打包" });
        let build;
        try {
          if (unresolved.length) {
            throw new Error(
              `import_unresolved: ${describeUnresolvedImports(unresolved)}`,
            );
          }
          build = await buildGeneratedWorkspace(workspace, prebuilt);
        } catch (buildError) {
          const detail = generationErrorDetail(buildError);
          send({ type: "log", level: "error", message: detail });
          if (remainingMs() < REPAIR_MIN_MS) throw buildError;
          // A failure whose only named files are platform-owned cannot be
          // repaired by the agent — it is not allowed to write them. Retrying
          // just spends tokens on an impossible task.
          if (!isRepairableByAgent(detail, changed.map((file) => file.path))) {
            throw buildError;
          }

          // Repair the single most likely culprit rather than everything: the
          // last file written is where a compile error almost always lives.
          const target = changed.at(-1);
          if (!target) throw buildError;
          send({
            type: "phase",
            phase: "repairing",
            message: `出了点问题，正在修 ${target.path}`,
          });
          const fixed = await provider
            .writeFile({
              ...input,
              plan,
              path: target.path,
              intent:
                plan.changes.find((entry) => entry.path === target.path)
                  ?.intent ?? "",
              drafts,
              onProgress: send,
              timeoutMs: remainingMs() - TAIL_RESERVE_MS,
              repair: { attempted: target.content, error: detail },
            })
            .catch((error: unknown) => {
              throw labelStage(error, "repair");
            });
          await supabase.rpc("save_generation_draft", {
            p_job_id: jobId,
            p_path: fixed.file.path,
            p_content: fixed.file.content,
          });
          workspace = assemble(
            changed.map((file) =>
              file.path === fixed.file.path ? fixed.file : file,
            ) as AgentFile[],
          );
          build = await buildGeneratedWorkspace(workspace, prebuilt);
        }

        for (const entry of build.logs) {
          send({ type: "log", level: entry.level, message: entry.message });
        }

        send({ type: "phase", phase: "saving", message: "正在保存" });
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
        if (versionError || !version) {
          throw versionError ?? new Error("No version");
        }

        const { error: filesError } = await supabase
          .from("project_files")
          .upsert(
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
            .update({
              title: workspace.title,
              status: "ready",
              current_version_id: version.id,
            })
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

        await settle(
          "succeeded",
          { costUsd: 0.05, inputTokens: 0, outputTokens: 0 },
          "deepseek",
          env.DEEPSEEK_MODEL,
          null,
        );
        send({ type: "done", versionNumber, provider: "deepseek" });
      } catch (error) {
        const errorDetail = generationErrorDetail(error);
        console.error("[generation_failed]", {
          projectId: project.id,
          phase: phase.phase,
          error: errorDetail,
        });
        // A failed step keeps the job alive so the finished files survive and
        // the user can retry just that step. Only a terminal phase settles.
        if (phase.phase !== "file") {
          await Promise.all([
            supabase
              .from("projects")
              .update({
                status: project.current_version_id ? "ready" : "failed",
              })
              .eq("id", project.id),
            supabase.from("messages").insert({
              project_id: project.id,
              role: "assistant",
              content: readableGenerationError(error),
              metadata: { error: true, phase: phase.phase, detail: errorDetail },
            }),
          ]);
          await settle(
            "failed",
            { costUsd: 0, inputTokens: 0, outputTokens: 0 },
            "deepseek",
            env.DEEPSEEK_MODEL,
            "generation_failed",
          );
        }
        send({ type: "error", message: readableGenerationError(error) });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
