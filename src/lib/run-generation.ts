import type { GenerationEvent } from "@/lib/generation-events";

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
}: RunGenerationOptions): Promise<{ ok: boolean; error?: string }> {
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
    error?: string;
  };
  if (!response.ok || !started.runId) {
    return { ok: false, error: started.error ?? "生成失败，请稍后重试。" };
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
}): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const source = new EventSource(
      `/api/projects/${projectId}/generate/stream?runId=${encodeURIComponent(runId)}`,
    );
    let settled = false;

    const finish = (outcome: { ok: boolean; error?: string }) => {
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
      if (event.type === "error") finish({ ok: false, error: event.message });
      // A question ends the run without building anything.
      if (event.type === "question") finish({ ok: false });
    };

    source.onerror = () => {
      // EventSource retries on its own while readyState is CONNECTING. Only a
      // closed source is terminal — and by then the run has either finished or
      // been evicted, so the page reload below picks up the real state.
      onConnectionChange?.(false);
      if (source.readyState === EventSource.CLOSED) {
        finish({ ok: false, error: "连接已断开，刷新页面查看最新结果。" });
      }
    };
  });
}
