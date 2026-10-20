/**
 * When a stopped run may be continued from its checkpoint.
 *
 * Resuming used to be implicit: a message whose text matched the stopped run's
 * prompt picked up its plan and files. Text is a poor signal of intent — the
 * same words can be "try that again" or "I am asking again" — and a resume
 * nobody chose rebuilt a plan the user had moved on from. Now a resume happens
 * only when the user presses "continue", and only while it still makes sense.
 *
 * Shared by the page, which decides whether to offer the button, and the
 * route, which decides whether to honour it, so the two cannot disagree.
 */

/** Long enough to step away and come back; short enough that the plan is still the one the user remembers. */
export const RESUME_WINDOW_MS = 30 * 60_000;

export interface ResumeCandidate {
  id: string;
  stage: string;
  status: string;
  created_at: string;
  completed_at?: string | null;
}

export type ResumeRefusal =
  /** Nothing to resume, or something happened in the project after it. */
  | "not_latest"
  /** Finished, closed because its failure would recur, or still running. */
  | "not_resumable"
  | "expired"
  /** A version was made after this run started; its plan is for older code. */
  | "superseded_by_version";

export function resumeRefusal(
  job: ResumeCandidate | null | undefined,
  context: {
    /** The project's most recent job of any kind, answered and asked included. */
    latestJobId: string | undefined;
    currentVersionCreatedAt?: string | null;
    now?: number;
  },
): ResumeRefusal | null {
  if (!job || job.id !== context.latestJobId) return "not_latest";
  if (job.stage === "succeeded" || job.stage === "failed") return "not_resumable";
  if (job.status === "queued" || job.status === "running") return "not_resumable";

  const now = context.now ?? Date.now();
  const stoppedAt = Date.parse(job.completed_at ?? job.created_at);
  if (!(now - stoppedAt <= RESUME_WINDOW_MS)) return "expired";

  if (
    context.currentVersionCreatedAt &&
    Date.parse(context.currentVersionCreatedAt) > Date.parse(job.created_at)
  ) {
    return "superseded_by_version";
  }

  return null;
}
