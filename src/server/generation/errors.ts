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
  if (/timed_out|aborted|AbortError|deadline/i.test(message)) return "step_timed_out";

  return "generation_failed";
}

/** Redacted, truncated detail for the console pane and the server log. */
export function generationErrorDetail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return redactBuildLog(message || "unknown_generation_error").slice(0, 800);
}
