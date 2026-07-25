import type { GenerationEvent } from "@/lib/generation-events";
import { createSseDecoder } from "@/lib/sse";

interface RunGenerationOptions {
  projectId: string;
  prompt: string;
  kind: "create" | "edit";
  onEvent: (event: GenerationEvent) => void;
  signal?: AbortSignal;
}

/**
 * Posts a generation request and drives `onEvent` from the SSE response.
 *
 * Resolves with the terminal outcome. Failures that happen before the stream
 * opens arrive as a normal JSON error body; failures after it opens arrive as
 * an `error` event, because the status line is already committed.
 */
export async function runGeneration({
  projectId,
  prompt,
  kind,
  onEvent,
  signal,
}: RunGenerationOptions): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch(`/api/projects/${projectId}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      kind,
      idempotencyKey: crypto.randomUUID(),
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    return { ok: false, error: result.error ?? "生成失败，请稍后重试。" };
  }

  const reader = response.body.getReader();
  const textDecoder = new TextDecoder();
  const decode = createSseDecoder<GenerationEvent>();
  let outcome: { ok: boolean; error?: string } = {
    ok: false,
    error: "连接中断，请稍后重试。",
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const event of decode(textDecoder.decode(value, { stream: true }))) {
        onEvent(event);
        if (event.type === "done") outcome = { ok: true };
        if (event.type === "error") outcome = { ok: false, error: event.message };
      }
    }
  } finally {
    reader.releaseLock();
  }

  return outcome;
}
