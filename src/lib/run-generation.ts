import type { GenerationEvent } from "@/lib/generation-events";

/**
 * A finished run, from the caller's point of view.
 *
 * The failure is a code rather than a sentence: it travels from a detached
 * server run that has no idea who is reading, and gets turned into copy by the
 * component that renders it.
 */
export interface GenerationOutcome {
  ok: boolean;
  errorCode?: string;
}

interface RunGenerationOptions {
  projectId: string;
  prompt: string;
  kind: "create" | "edit";
  onEvent: (event: GenerationEvent) => void;
  /** Fired when the connection drops and again when it comes back. */
  onConnectionChange?: (connected: boolean) => void;
}

/**
 * Starts a generation and follows it until it ends.
 *
 * The run lives on the server, not in this connection. `EventSource` handles
 * reconnection and replays `Last-Event-ID`, so a dropped network — or a phone
 * that froze the tab — resumes the same run rather than abandoning it.
 */
export async function runGeneration({
  projectId,
  prompt,
  kind,
  onEvent,
  onConnectionChange,
}: RunGenerationOptions): Promise<GenerationOutcome> {
  const response = await fetch(`/api/projects/${projectId}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      kind,
      idempotencyKey: crypto.randomUUID(),
    }),
  });

  const started = (await response.json().catch(() => ({}))) as {
    runId?: string;
    code?: string;
  };
  if (!response.ok || !started.runId) {
    return { ok: false, errorCode: started.code ?? "generation_failed" };
  }

  return watchGeneration({
    projectId,
    runId: started.runId,
    onEvent,
    onConnectionChange,
  });
}

export function watchGeneration({
  projectId,
  runId,
  onEvent,
  onConnectionChange,
}: {
  projectId: string;
  runId: string;
  onEvent: (event: GenerationEvent) => void;
  onConnectionChange?: (connected: boolean) => void;
}): Promise<GenerationOutcome> {
  return new Promise((resolve) => {
    const source = new EventSource(
      `/api/projects/${projectId}/generate/stream?runId=${encodeURIComponent(runId)}`,
    );
    let settled = false;

    const finish = (outcome: GenerationOutcome) => {
      if (settled) return;
      settled = true;
      source.close();
      resolve(outcome);
    };

    source.onopen = () => onConnectionChange?.(true);

    source.onmessage = (message) => {
      let event: GenerationEvent;
      try {
        event = JSON.parse(message.data) as GenerationEvent;
      } catch {
        return;
      }
      onEvent(event);
      if (event.type === "done") finish({ ok: true });
      if (event.type === "error") finish({ ok: false, errorCode: event.code });
      // A question ends the run without building anything.
      if (event.type === "question") finish({ ok: false });
    };

    source.onerror = () => {
      // EventSource retries on its own while readyState is CONNECTING. Only a
      // closed source is terminal — and by then the run has either finished or
      // been evicted, so the page reload below picks up the real state.
      onConnectionChange?.(false);
      if (source.readyState === EventSource.CLOSED) {
        finish({ ok: false, errorCode: "connection_lost" });
      }
    };
  });
}
