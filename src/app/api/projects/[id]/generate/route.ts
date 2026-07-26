import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { createDetachedClient } from "@/server/generation/client";
import { startRun } from "@/server/generation/registry";
import type { GenerationCheckpoint } from "@/server/generation/run";
import { executeGeneration } from "@/server/generation/run";
import { isLiveGenerationReady } from "@/server/env";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.uuid() });
const bodySchema = z.object({
  prompt: z.string().trim().min(3).max(4000),
  kind: z.enum(["create", "edit"]).default("edit"),
  idempotencyKey: z.string().min(8).max(120),
});

/**
 * Starts a generation and returns immediately.
 *
 * The run does not live inside this request. Progress is read from
 * `GET .../generate/stream`, which can be opened, dropped and reopened without
 * affecting the work — closing a tab should cost the user their view of the
 * run, not the run.
 */
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
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!user || !session) {
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

  // An earlier attempt that stopped part-way. Its plan and files are carried
  // into this one, so a failure at the build step does not throw away a
  // finished plan and a finished set of files — and does not answer the same
  // request differently the second time.
  const { data: previousJob } = await supabase
    .from("generation_jobs")
    .select("id, stage, plan, draft_files, draft_artifact_html, attempts")
    .eq("project_id", project.id)
    .not("stage", "in", '("succeeded","failed")')
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Only a retry of the same request may inherit it. A new instruction after a
  // failure is a different question, and answering it with the old plan would
  // build the thing the user just moved on from.
  const storedPrompt = (previousJob?.plan as { prompt?: string } | null)?.prompt;
  const isRetryOfSameRequest =
    Boolean(previousJob) && storedPrompt === body.data.prompt;

  const checkpoint: GenerationCheckpoint | undefined =
    previousJob && isRetryOfSameRequest
      ? {
          stage: previousJob.stage as GenerationCheckpoint["stage"],
          plan: previousJob.plan ?? undefined,
          draftFiles: (previousJob.draft_files ?? {}) as Record<string, string>,
          draftArtifactHtml: previousJob.draft_artifact_html ?? undefined,
          attempts: (previousJob.attempts as number) ?? 0,
        }
      : undefined;

  // Reserved here rather than inside the run so the caller learns about an
  // exhausted budget as a status code, not as an event on a stream it has yet
  // to open.
  let jobId: string | undefined;
  if (isLiveGenerationReady()) {
    const { data: job, error: reserveError } = await supabase.rpc(
      "reserve_generation",
      {
        p_project_id: project.id,
        p_kind: body.data.kind,
        p_idempotency_key: body.data.idempotencyKey,
        p_reserved_usd: 0.05,
      },
    );
    if (reserveError) {
      const message = reserveError.message ?? "";
      const known =
        /credit_exhausted|budget_exhausted|rate_limit|generation_disabled/.test(
          message,
        );
      return NextResponse.json(
        { error: known ? message : "无法开始生成，请稍后重试。" },
        { status: known ? 429 : 500 },
      );
    }
    jobId = job?.id;
  }

  // Demo mode reserves nothing, so it needs its own handle to stream under.
  const runId = jobId ?? crypto.randomUUID();

  await Promise.all([
    supabase.from("projects").update({ status: "generating" }).eq("id", project.id),
    supabase.from("messages").insert({
      project_id: project.id,
      role: "user",
      content: body.data.prompt,
      metadata: { kind: body.data.kind },
    }),
  ]);

  if (previousJob && jobId && previousJob.id !== jobId) {
    // Its work now belongs to this attempt; leaving it resumable would offer
    // the same checkpoint twice.
    await supabase.rpc("checkpoint_generation", {
      p_job_id: previousJob.id,
      p_stage: "failed",
      p_plan: null,
      p_draft_files: null,
      p_artifact_html: null,
      p_error: "已被新的尝试接管。",
    });
  }

  const { emit } = startRun(runId);
  // Detached on purpose. A long-lived process keeps this running after the
  // response is sent; the client reconnects to watch, or does not.
  void executeGeneration({
    // The request-scoped client reads cookies through `next/headers` and stops
    // working once the response is sent.
    supabase: createDetachedClient(session.access_token),
    project,
    prompt: body.data.prompt,
    kind: body.data.kind,
    jobId,
    checkpoint,
    emit,
  }).catch((error: unknown) => {
    console.error("[generation_crashed]", error);
    emit({ type: "error", message: "生成失败，请稍后重试。" });
  });

  return NextResponse.json({ runId }, { status: 202 });
}
