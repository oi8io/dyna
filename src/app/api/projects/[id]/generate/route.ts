import { NextResponse } from "next/server";
import { z } from "zod";

import type { GenerationEvent } from "@/lib/generation-events";
import { encodeSseFrame } from "@/lib/sse";
import { createClient } from "@/lib/supabase/server";
import { buildGeneratedWorkspace } from "@/server/build";
import { getServerEnv, isLiveGenerationReady } from "@/server/env";
import { getGameGenerationProvider } from "@/server/llm";
import { planNeedsClarification } from "@/server/llm/plan";
import {
  SPEC_PATH,
  appendChangelog,
  extractChangelog,
  readSpecMarkdown,
  renderSpecMarkdown,
} from "@/server/llm/spec";
import type { ConversationTurn } from "@/server/llm/types";
import type { AgentFile, GeneratedWorkspace } from "@/server/workspace/schema";
import { redactBuildLog, validateWorkspace } from "@/server/workspace/schema";

// The response is a long-lived stream; it must never be cached or prerendered.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** How much conversation to replay. Enough for context, bounded for cost. */
const HISTORY_TURNS = 12;

/**
 * Wall clock this handler gives itself, under the platform's `maxDuration`.
 *
 * Being killed by the platform is not a graceful failure: the `finally` block
 * never runs, so `finalize_generation` never releases the reserved budget and
 * the job stays `running` forever. Finishing early on our own terms — with a
 * real error event and a settled job — is strictly better than being cut off.
 */
const DEADLINE_MS = (maxDuration - 20) * 1000;

/** Time the build and persistence steps still need after the last model call. */
const BUILD_RESERVE_MS = 100_000;
/** Below this, a repair pass cannot finish, so it is not started. */
const REPAIR_MIN_MS = 70_000;

const paramsSchema = z.object({ id: z.uuid() });
const generateSchema = z.object({
  prompt: z.string().trim().min(3).max(4000),
  kind: z.enum(["create", "edit"]).default("edit"),
  idempotencyKey: z.string().min(8).max(120),
});

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
  if (
    message.includes("generation_deadline_exceeded") ||
    message.includes("aborted") ||
    message.includes("AbortError")
  ) {
    return "这次生成超时了。换一个更小的改动分几次说，通常就能过。";
  }
  return "生成失败，请稍后重试。";
}

function generationErrorDetail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return redactBuildLog(message || "unknown_generation_error").slice(0, 800);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const params = paramsSchema.safeParse(await context.params);
  const body = generateSchema.safeParse(await request.json());
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

  const { data: project } = await supabase
    .from("projects")
    .select("id, user_id, original_prompt, current_version_id")
    .eq("id", params.data.id)
    .single();
  if (!project || project.user_id !== user.id) {
    return NextResponse.json({ error: "项目不存在。" }, { status: 404 });
  }

  // Everything above can still fail with a normal status code. Once the stream
  // opens the status is already 200, so later failures travel as `error` events.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: GenerationEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(encodeSseFrame(event)));
      };

      const startedAt = Date.now();
      const remainingMs = () => DEADLINE_MS - (Date.now() - startedAt);

      const live = isLiveGenerationReady();
      const env = getServerEnv();
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
            // A snapshot that will not validate used to be swallowed and the
            // request continued with no previous project attached, at which
            // point the agent had no choice but to invent a brand new game on
            // top of the user's existing one. Fail loudly instead.
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
        const provider = getGameGenerationProvider();
        const planInput = {
          kind: body.data.kind,
          prompt: body.data.prompt,
          originalPrompt: project.original_prompt,
          specMarkdown,
          history,
          previousWorkspace,
        };

        if (live) {
          send({ type: "phase", phase: "reserving", message: "正在确认额度" });
          const { data: job, error: reserveError } = await supabase.rpc(
            "reserve_generation",
            {
              p_project_id: project.id,
              p_kind: body.data.kind,
              p_idempotency_key: body.data.idempotencyKey,
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
            content: body.data.prompt,
            metadata: { kind: body.data.kind },
          }),
        ]);

        // Stage one: decide what to do, or ask.
        send({ type: "phase", phase: "planning", message: "正在理解需求" });
        const { plan, ...planMeta } = await provider.plan({
          ...planInput,
          timeoutMs: remainingMs() - BUILD_RESERVE_MS,
        });

        if (planNeedsClarification(plan)) {
          // Nothing was built, so nothing is charged. The reservation is
          // released and the questions are stored as a normal assistant turn so
          // the next request sees them in the history.
          await settle(
            "cancelled",
            {
              costUsd: 0,
              inputTokens: planMeta.usage.inputTokens,
              outputTokens: planMeta.usage.outputTokens,
            },
            planMeta.provider,
            planMeta.model,
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
              metadata: { questions: plan.questions, provider: planMeta.provider },
            }),
          ]);
          send({
            type: "question",
            understanding: plan.understanding,
            questions: plan.questions,
          });
          return;
        }

        send({
          type: "plan",
          understanding: plan.understanding,
          changes: plan.changes,
          assumptions: plan.assumptions,
        });

        // Stage two: implement the agreed plan.
        send({ type: "phase", phase: "writing", message: "正在写代码" });
        let result = await provider.generate({
          ...planInput,
          plan,
          onProgress: send,
          timeoutMs: remainingMs() - BUILD_RESERVE_MS,
        });

        send({ type: "phase", phase: "building", message: "正在隔离构建" });
        let build;
        try {
          build = await buildGeneratedWorkspace(
            result.workspace,
            result.prebuiltArtifactHtml,
          );
        } catch (buildError) {
          const detail = generationErrorDetail(buildError);
          send({ type: "log", level: "error", message: detail });

          // One repair pass. The model has never seen its own compiler errors
          // before; showing them converts most failures into successes. Started
          // only when there is time to finish it — a repair cut off by the
          // platform loses the reservation as well as the attempt.
          if (remainingMs() < REPAIR_MIN_MS) {
            throw buildError;
          }
          send({
            type: "phase",
            phase: "repairing",
            message: "构建失败，正在修复",
          });
          const attemptedFiles = result.workspace.files.filter((file) =>
            result.changedPaths.includes(file.path),
          ) as AgentFile[];
          result = await provider.generate({
            ...planInput,
            plan,
            onProgress: send,
            repair: { attemptedFiles, error: detail },
            timeoutMs: remainingMs() - BUILD_RESERVE_MS,
          });
          build = await buildGeneratedWorkspace(
            result.workspace,
            result.prebuiltArtifactHtml,
          );
        }

        for (const entry of build.logs) {
          send({ type: "log", level: entry.level, message: entry.message });
        }

        // The platform renders SPEC.md from the plan rather than letting the
        // model write it: the shape stays stable and the changelog accumulates.
        // When the plan came back without a spec, the previous one is carried
        // forward untouched rather than being dropped.
        const specContent = plan.spec
          ? renderSpecMarkdown(
              plan.spec,
              appendChangelog(
                extractChangelog(specMarkdown ?? ""),
                plan.changeSummary,
              ),
            )
          : specMarkdown;
        const workspace: GeneratedWorkspace = {
          ...result.workspace,
          files: [
            ...result.workspace.files.filter((file) => file.path !== SPEC_PATH),
            ...(specContent
              ? [{ path: SPEC_PATH, content: specContent }]
              : []),
          ],
        };

        send({ type: "phase", phase: "saving", message: "正在保存版本" });
        const { data: version, error: versionError } = await supabase
          .from("project_versions")
          .insert({
            project_id: project.id,
            version_number: versionNumber,
            status: "runnable",
            source_snapshot: workspace,
            artifact_html: build.artifactHtml,
            build_log: [
              {
                level: "info",
                message: `${result.provider} 生成完成；隔离校验通过。`,
              },
              ...build.logs,
            ],
          })
          .select("id")
          .single();
        if (versionError || !version) {
          throw versionError ?? new Error("No version");
        }

        const fileRows = workspace.files.map((file) => ({
          project_id: project.id,
          path: file.path,
          content: file.content,
        }));
        const { error: filesError } = await supabase
          .from("project_files")
          .upsert(fileRows, { onConflict: "project_id,path" });
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
              provider: result.provider,
              model: result.model,
              changedPaths: result.changedPaths,
              assumptions: plan.assumptions,
            },
          }),
        ]);

        await settle(
          "succeeded",
          {
            costUsd: result.usage.estimatedCostUsd + planMeta.usage.estimatedCostUsd,
            inputTokens:
              result.usage.inputTokens + planMeta.usage.inputTokens,
            outputTokens:
              result.usage.outputTokens + planMeta.usage.outputTokens,
          },
          result.provider,
          result.model,
          null,
        );

        send({ type: "done", versionNumber, provider: result.provider });
      } catch (error) {
        const errorDetail = generationErrorDetail(error);
        console.error("[generation_failed]", {
          projectId: project.id,
          kind: body.data.kind,
          error: errorDetail,
        });
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
            metadata: {
              error: true,
              kind: body.data.kind,
              // Stored in production too. It has already been through
              // `redactBuildLog`, and without it a failure on a deployment is
              // undiagnosable from the UI — the cause only exists in a platform
              // log the person who hit the error usually cannot read.
              detail: errorDetail,
            },
          }),
        ]);
        await settle(
          "failed",
          { costUsd: 0, inputTokens: 0, outputTokens: 0 },
          "deepseek",
          env.DEEPSEEK_MODEL,
          "generation_failed",
        );
        send({
          type: "error",
          message: readableGenerationError(error),
        });
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
      // Stops nginx and similar proxies from buffering the whole response.
      "X-Accel-Buffering": "no",
    },
  });
}
