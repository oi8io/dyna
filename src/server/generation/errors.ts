import type { ErrorCode } from "@/lib/i18n/dictionary";
import { redactBuildLog } from "@/server/workspace/schema";

/**
 * Classifies anything a generation can fail with into a code the client knows.
 *
 * Both the credit reservation in the route and the run itself go through here,
 * so an exhausted budget reads the same whether it was caught before the run
 * started or during it.
 */
export function generationErrorCode(error: unknown): ErrorCode {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("generation_disabled")) return "generation_disabled";
  if (message.includes("global_budget_exhausted")) return "global_budget_exhausted";
  if (message.includes("create_credit_exhausted")) return "create_credit_exhausted";
  if (message.includes("edit_credit_exhausted")) return "edit_credit_exhausted";
  if (message.includes("rate_limit_exceeded")) return "rate_limit_exceeded";
  if (message.includes("duplicate key")) return "generation_in_progress";
  if (message.includes("snapshot_unreadable")) return "snapshot_unreadable";
  if (message.includes("plan_timed_out")) return "plan_timed_out";
  // Before the timeout pattern: these are specific, and the fallback that
  // follows them can itself time out with a message that would match it.
  if (message.includes("reasoning_exhausted")) return "reasoning_exhausted";
  if (message.includes("output_truncated")) return "output_truncated";
  // The model service, not the request: rate-limited, overloaded, or the
  // connection dropped. The same request is likely to work a minute later.
  if (
    /DeepSeek request failed \((429|5\d\d)\)/.test(message) ||
    /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up|other side closed/i.test(
      message,
    )
  ) {
    return "upstream_unavailable";
  }
  if (/timed_out|aborted|AbortError|deadline/i.test(message)) return "step_timed_out";

  return "generation_failed";
}

/**
 * Failures that say nothing about the request — time, a model that thought too
 * long, a service that was briefly down. The same plan and files are likely to
 * work on a second attempt, so the run keeps its checkpoint for one.
 *
 * Everything else is assumed to recur: a broken plan, a build that still fails
 * after repair, an unrecognised error. Resuming those would replay the same
 * failure with the same inputs, so their checkpoint is closed and the only
 * offer is to start over.
 */
const RESUMABLE_ERRORS: ReadonlySet<string> = new Set<ErrorCode>([
  "plan_timed_out",
  "step_timed_out",
  "reasoning_exhausted",
  "upstream_unavailable",
]);

export function isResumableError(code: string) {
  return RESUMABLE_ERRORS.has(code);
}

/** Redacted, truncated detail for the console pane and the server log. */
export function generationErrorDetail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return redactBuildLog(message || "unknown_generation_error").slice(0, 800);
}
