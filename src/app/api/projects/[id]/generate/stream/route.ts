import { z } from "zod";

import { apiError } from "@/lib/api-error";
import type { GenerationEvent } from "@/lib/generation-events";
import { encodeSseFrame } from "@/lib/sse";
import { createClient } from "@/lib/supabase/server";
import { getRun } from "@/server/generation/registry";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.uuid() });

/** Comfortably inside the 60s idle timeout most proxies default to. */
const HEARTBEAT_MS = 20_000;

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
    return apiError("invalid_request", 400);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return apiError("not_authenticated", 401);
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, user_id")
    .eq("id", params.data.id)
    .single();
  if (!project || project.user_id !== user.id) {
    return apiError("project_not_found", 404);
  }

  const run = getRun(runId);
  if (!run) {
    // Either it finished long enough ago to be evicted, or the process
    // restarted. Either way the project row is the source of truth now.
    return apiError("run_finished", 410);
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
      if (resumeFrom > 0) {
        // A reconnecting `EventSource` knows what it already has, so it gets
        // only what it missed and its own state stays intact.
        const missed = run.since(resumeFrom);
        const firstSeq = run.seq - missed.length + 1;
        missed.forEach((event, index) => write(event, firstSeq + index));
      } else {
        // A caller starting from nothing — a reopened page, most often. Raw
        // replay is not enough here: history is capped, so by this point the
        // plan and the earliest files may have been evicted. The folded
        // snapshot carries the same result in one frame, tagged with the
        // sequence it summarises so a later drop resumes from the right place.
        write({ type: "snapshot", state: run.snapshot() }, run.seq);
      }

      if (run.status !== "running") {
        closed = true;
        controller.close();
        return;
      }

      /**
       * Keeps the connection alive through a quiet stretch.
       *
       * Planning is a single model call that can run for a minute with nothing
       * to report, and an idle proxy in front of the app will close the socket
       * well before that. A comment frame never reaches `onmessage`, so it
       * costs the client nothing to ignore.
       */
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          closed = true;
        }
      }, HEARTBEAT_MS);
      heartbeat.unref?.();

      let unsubscribe = () => {};
      const stop = () => {
        clearInterval(heartbeat);
        unsubscribe();
        closed = true;
      };

      unsubscribe = run.subscribe((event, seq) => {
        write(event, seq);
        if (event.type === "done" || event.type === "error") {
          stop();
          controller.close();
        }
      });

      // Client navigated away or the connection dropped. The run continues.
      request.signal.addEventListener("abort", stop);
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
