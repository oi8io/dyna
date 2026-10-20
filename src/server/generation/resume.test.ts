import { describe, expect, it } from "vitest";

import {
  RESUME_WINDOW_MS,
  type ResumeCandidate,
  resumeRefusal,
} from "@/server/generation/resume";

const STOPPED_AT = Date.parse("2026-10-20T14:51:53Z");

function stopped(overrides: Partial<ResumeCandidate> = {}): ResumeCandidate {
  return {
    id: "job-1",
    stage: "writing",
    status: "failed",
    created_at: "2026-10-20T14:47:30Z",
    completed_at: "2026-10-20T14:51:53Z",
    ...overrides,
  };
}

/**
 * A resume used to be triggered by matching text: sending the same words as a
 * stopped run picked up its plan, whether the user meant "try again" or was
 * asking a question twice. It now happens only on request, and only while the
 * checkpoint still describes the project as it is.
 */
describe("resumeRefusal", () => {
  it("allows the latest stopped run within the window", () => {
    expect(
      resumeRefusal(stopped(), { latestJobId: "job-1", now: STOPPED_AT + 60_000 }),
    ).toBeNull();
  });

  it("refuses a run something has happened after", () => {
    // An answered question or a clarification is a later job: the user moved on.
    expect(
      resumeRefusal(stopped(), { latestJobId: "job-2", now: STOPPED_AT }),
    ).toBe("not_latest");
    expect(resumeRefusal(undefined, { latestJobId: "job-1" })).toBe("not_latest");
  });

  it("refuses a run whose checkpoint was closed", () => {
    // A failure that would recur closes it; so does finishing.
    expect(
      resumeRefusal(stopped({ stage: "failed" }), {
        latestJobId: "job-1",
        now: STOPPED_AT,
      }),
    ).toBe("not_resumable");
    expect(
      resumeRefusal(stopped({ stage: "succeeded" }), {
        latestJobId: "job-1",
        now: STOPPED_AT,
      }),
    ).toBe("not_resumable");
  });

  it("refuses a run that is still going", () => {
    expect(
      resumeRefusal(stopped({ status: "running", completed_at: null }), {
        latestJobId: "job-1",
        now: STOPPED_AT,
      }),
    ).toBe("not_resumable");
  });

  it("expires, counting from when the run stopped", () => {
    const context = { latestJobId: "job-1" };
    expect(
      resumeRefusal(stopped(), { ...context, now: STOPPED_AT + RESUME_WINDOW_MS }),
    ).toBeNull();
    expect(
      resumeRefusal(stopped(), {
        ...context,
        now: STOPPED_AT + RESUME_WINDOW_MS + 1,
      }),
    ).toBe("expired");
  });

  it("falls back to the start time when the stop was never recorded", () => {
    expect(
      resumeRefusal(stopped({ completed_at: null }), {
        latestJobId: "job-1",
        now: Date.parse("2026-10-20T14:47:30Z") + RESUME_WINDOW_MS + 1,
      }),
    ).toBe("expired");
  });

  it("refuses a plan made for code that has since changed", () => {
    expect(
      resumeRefusal(stopped(), {
        latestJobId: "job-1",
        currentVersionCreatedAt: "2026-10-20T14:49:00Z",
        now: STOPPED_AT,
      }),
    ).toBe("superseded_by_version");
    // The version the run started from is fine — it is what the plan read.
    expect(
      resumeRefusal(stopped(), {
        latestJobId: "job-1",
        currentVersionCreatedAt: "2026-10-20T13:00:00Z",
        now: STOPPED_AT,
      }),
    ).toBeNull();
  });
});
