import { NextResponse } from "next/server";
import { z } from "zod";

import type { GenerationEvent } from "@/lib/generation-events";
import { encodeSseFrame } from "@/lib/sse";
import { createClient } from "@/lib/supabase/server";
import { getRun } from "@/server/generation/registry";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.uuid() });

/**
 * Watches a running generation. Safe to open, drop and reopen.
 *
 * A `GET` on purpose: `EventSource` reconnects on its own and replays
 * `Last-Event-ID`, so a dropped connection resumes where it left off without
 * the client having to implement retry logic. Everything the caller missed is
 * replayed before live events continue.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const params = paramsSchema.safeParse(await context.params);
  const url = new URL(request.url);
  const runId = url.searchParams.get("runId") ?? "";
  if (!params.success || !runId) {
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
    .select("id, user_id")
    .eq("id", params.data.id)
    .single();
  if (!project || project.user_id !== user.id) {
    return NextResponse.json({ error: "项目不存在。" }, { status: 404 });
  }

  const run = getRun(runId);
  if (!run) {
    // Either it finished long enough ago to be evicted, or the process
    // restarted. Either way the project row is the source of truth now.
    return NextResponse.json(
      { error: "这次生成已经结束，刷新页面查看结果。" },
      { status: 410 },
    );
  }

  // The browser sends this header when EventSource reconnects.
  const lastSeen = Number(request.headers.get("last-event-id") ?? "0");
  const resumeFrom = Number.isFinite(lastSeen) && lastSeen > 0 ? lastSeen : 0;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (event: GenerationEvent, seq: number) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`id: ${seq}\n${encodeSseFrame(event)}`),
          );
        } catch {
          closed = true;
        }
      };

      // Catch up first, then follow.
      const missed = run.since(resumeFrom);
      const firstSeq = run.seq - missed.length + 1;
      missed.forEach((event, index) => write(event, firstSeq + index));

      if (run.status !== "running") {
        closed = true;
        controller.close();
        return;
      }

      const unsubscribe = run.subscribe((event, seq) => {
        write(event, seq);
        if (event.type === "done" || event.type === "error") {
          unsubscribe();
          closed = true;
          controller.close();
        }
      });

      // Client navigated away or the connection dropped. The run continues.
      request.signal.addEventListener("abort", () => {
        unsubscribe();
        closed = true;
      });
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
