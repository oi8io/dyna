import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api-error";
import { createClient } from "@/lib/supabase/server";
import { createDetachedClient } from "@/server/generation/client";
import {
  generationErrorCode,
  generationErrorDetail,
} from "@/server/generation/errors";
import { startRun } from "@/server/generation/registry";
import { resumeRefusal } from "@/server/generation/resume";
import type { GenerationCheckpoint } from "@/server/generation/run";
import { executeGeneration } from "@/server/generation/run";
import { isLiveGenerationReady } from "@/server/env";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.uuid() });
const bodySchema = z.object({
  prompt: z.string().trim().min(3).max(4000),
  kind: z.enum(["create", "edit"]).default("edit"),
  idempotencyKey: z.string().min(8).max(120),
  /**
   * Continue this stopped run from its checkpoint. Only ever set by the
   * "continue" button; a typed message is always a new turn.
   */
  resumeJobId: z.uuid().optional(),
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
    return apiError("invalid_request", 400);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!user || !session) {
    return apiError("not_authenticated", 401);
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, user_id, title, original_prompt, current_version_id")
    .eq("id", params.data.id)
    .single();
  if (!project || project.user_id !== user.id) {
    return apiError("project_not_found", 404);
  }

  // An earlier attempt that stopped part-way with its checkpoint still open,
  // and the project's latest job of any kind — a resume is only valid for the
  // run nothing has happened after.
  const [{ data: previousJob }, { data: latestJob }] = await Promise.all([
    supabase
      .from("generation_jobs")
      .select(
        "id, kind, stage, status, plan, draft_files, draft_artifact_html, attempts, created_at, completed_at",
      )
      .eq("project_id", project.id)
      .not("stage", "in", '("succeeded","failed")')
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("generation_jobs")
      .select("id")
      .eq("project_id", project.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  // A typed message is a new turn, always. Its checkpoint is inherited only
  // when the user explicitly asked to continue that run, and only while
  // continuing still makes sense — see `resumeRefusal`.
  let checkpoint: GenerationCheckpoint | undefined;
  let prompt = body.data.prompt;
  let kind = body.data.kind;
  const resuming = Boolean(body.data.resumeJobId);

  if (body.data.resumeJobId) {
    const candidate =
      previousJob?.id === body.data.resumeJobId ? previousJob : undefined;
    const { data: currentVersion } = project.current_version_id
      ? await supabase
          .from("project_versions")
          .select("created_at")
          .eq("id", project.current_version_id)
          .maybeSingle()
      : { data: null };
    const refusal = resumeRefusal(candidate, {
      latestJobId: latestJob?.id,
      currentVersionCreatedAt: currentVersion?.created_at,
    });
    if (refusal || !candidate) {
      return apiError("resume_unavailable", 409);
    }

    checkpoint = {
      stage: candidate.stage as GenerationCheckpoint["stage"],
      plan: candidate.plan ?? undefined,
      draftFiles: (candidate.draft_files ?? {}) as Record<string, string>,
      draftArtifactHtml: candidate.draft_artifact_html ?? undefined,
      attempts: (candidate.attempts as number) ?? 0,
    };
    // The run's own request, not whatever the button sent along: the plan was
    // made for these words. A run that stopped before planning stored none,
    // and then the client's copy of the original turn is all there is.
    const storedPrompt = (candidate.plan as { prompt?: string } | null)?.prompt;
    prompt = storedPrompt ?? prompt;
    kind = candidate.kind as typeof kind;
  }

  // Reserved here rather than inside the run so the caller learns about an
  // exhausted budget as a status code, not as an event on a stream it has yet
  // to open.
  let jobId: string | undefined;
  if (isLiveGenerationReady()) {
    const { data: job, error: reserveError } = await supabase.rpc(
      "reserve_generation",
      {
        p_project_id: project.id,
        p_kind: kind,
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
      // A known refusal is the user's to act on, so it keeps its own code; an
      // unrecognised database failure is not, and is flattened to one.
      return apiError(
        known ? generationErrorCode(message) : "generation_start_failed",
        known ? 429 : 500,
      );
    }
    jobId = job?.id;
  }

  // Demo mode reserves nothing, so it needs its own handle to stream under.
  const runId = jobId ?? crypto.randomUUID();

  await Promise.all([
    supabase.from("projects").update({ status: "generating" }).eq("id", project.id),
    // A resume continues a turn that is already in the conversation; writing
    // it again would show the user's request twice.
    resuming
      ? Promise.resolve()
      : supabase.from("messages").insert({
          project_id: project.id,
          role: "user",
          content: prompt,
          metadata: { kind },
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
      p_error: "superseded_by_new_attempt",
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
    prompt,
    kind,
    jobId,
    checkpoint,
    emit,
  }).catch((error: unknown) => {
    console.error("[generation_crashed]", error);
    emit({
      type: "error",
      code: "generation_failed",
      detail: generationErrorDetail(error),
    });
  });

  return NextResponse.json({ runId }, { status: 202 });
}
