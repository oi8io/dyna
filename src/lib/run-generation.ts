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
  | { phase: "file"; jobId: string; path: string }
  | { phase: "finish"; jobId: string };

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
 * Drives a generation to completion across several short requests.
 *
 * Plan, then one request per planned file, then a final assemble-and-build.
 * Splitting it this way keeps every request comfortably inside the platform's
 * per-invocation limit, and lets the model spend its whole reasoning budget on
 * one file at a time instead of emitting a complete game in a single answer.
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

  for (const path of planned.files) {
    const step = await runPhase(
      projectId,
      { phase: "file", jobId: planned.jobId, path },
      onEvent,
      signal,
    );
    // Files already written stay on the job, so a retry resumes rather than
    // starting over.
    if (!step.ok) return { ok: false, error: step.error };
  }

  const finished = await runPhase(
    projectId,
    { phase: "finish", jobId: planned.jobId },
    onEvent,
    signal,
  );
  return { ok: finished.ok, error: finished.error };
}
