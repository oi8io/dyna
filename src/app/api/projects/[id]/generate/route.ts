import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { createDetachedClient } from "@/server/generation/client";
import { startRun } from "@/server/generation/registry";
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
    emit,
  }).catch((error: unknown) => {
    console.error("[generation_crashed]", error);
    emit({ type: "error", message: "生成失败，请稍后重试。" });
  });

  return NextResponse.json({ runId }, { status: 202 });
}
