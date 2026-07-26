import type { GenerationEvent } from "@/lib/generation-events";
import { createSseDecoder } from "@/lib/sse";

interface RunGenerationOptions {
  projectId: string;
  prompt: string;
  kind: "create" | "edit";
  onEvent: (event: GenerationEvent) => void;
  signal?: AbortSignal;
}

type Phase =
  | { phase: "plan"; prompt: string; kind: string; idempotencyKey: string }
  | { phase: "write"; jobId: string };

interface PhaseOutcome {
  ok: boolean;
  error?: string;
  jobId?: string;
  files?: string[];
  /** True when the run ended because the agent asked something. */
  asked?: boolean;
}

/** Runs one phase and drains its event stream. */
async function runPhase(
  projectId: string,
  body: Phase,
  onEvent: (event: GenerationEvent) => void,
  signal?: AbortSignal,
): Promise<PhaseOutcome> {
  const response = await fetch(`/api/projects/${projectId}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
  const outcome: PhaseOutcome = {
    ok: true,
    error: undefined,
  };
  let sawTerminalError = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const event of decode(textDecoder.decode(value, { stream: true }))) {
        onEvent(event);
        if (event.type === "job") {
          outcome.jobId = event.jobId;
          outcome.files = event.files;
        }
        if (event.type === "question") outcome.asked = true;
        if (event.type === "error") {
          sawTerminalError = true;
          outcome.error = event.message;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (sawTerminalError) outcome.ok = false;
  return outcome;
}

/**
 * Drives a generation to completion.
 *
 * Two requests: understand the request, then write and build. The first can end
 * the run by asking a question, which is why it is separate — everything after
 * it assumes the plan was agreed. The files themselves are written together, in
 * one model call, because they have to agree with each other.
 */
export async function runGeneration({
  projectId,
  prompt,
  kind,
  onEvent,
  signal,
}: RunGenerationOptions): Promise<{ ok: boolean; error?: string }> {
  const planned = await runPhase(
    projectId,
    {
      phase: "plan",
      prompt,
      kind,
      idempotencyKey: crypto.randomUUID(),
    },
    onEvent,
    signal,
  );
  if (!planned.ok) return { ok: false, error: planned.error };
  // The agent stopped to ask. Nothing was built and nothing was charged.
  if (planned.asked) return { ok: false };
  if (!planned.jobId || !planned.files?.length) {
    return { ok: false, error: "计划没有指出要写哪些文件。" };
  }

  const written = await runPhase(
    projectId,
    { phase: "write", jobId: planned.jobId },
    onEvent,
    signal,
  );
  return { ok: written.ok, error: written.error };
}
