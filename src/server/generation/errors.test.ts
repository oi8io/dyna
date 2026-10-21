import { describe, expect, it } from "vitest";

import {
  generationErrorCode,
  isResumableError,
} from "@/server/generation/errors";

/**
 * Everything unrecognised becomes "generation_failed", which tells the user
 * nothing. The failures with a known cause and a known remedy get their own.
 */
describe("generationErrorCode", () => {
  it("names a budget spent on reasoning", () => {
    expect(
      generationErrorCode(
        new Error("reasoning_exhausted: deepseek-v4-pro reasoned for 17417 chars"),
      ),
    ).toBe("reasoning_exhausted");
  });

  it("names a truncated answer", () => {
    expect(generationErrorCode(new Error("output_truncated: hit the cap"))).toBe(
      "output_truncated",
    );
  });

  it("names the stage a labelled timeout happened in", () => {
    // run.ts prefixes the stage; planning has its own copy for the reader.
    expect(
      generationErrorCode(
        new Error(
          "plan_timed_out: deepseek_deadline_timed_out: deepseek-v4-pro without reasoning, after 60s",
        ),
      ),
    ).toBe("plan_timed_out");
    expect(
      generationErrorCode(
        new Error("write_timed_out: deepseek_idle_timed_out: after 45s"),
      ),
    ).toBe("step_timed_out");
  });

  it("classifies either model clock as a timeout", () => {
    expect(
      generationErrorCode(new Error("deepseek_idle_timed_out: after 45s")),
    ).toBe("step_timed_out");
    expect(
      generationErrorCode(new Error("deepseek_deadline_timed_out: after 290s")),
    ).toBe("step_timed_out");
  });

  it("names a model service that is briefly down", () => {
    for (const message of [
      "DeepSeek request failed (429) for deepseek-v4-pro: rate limited",
      "DeepSeek request failed (503) for deepseek-v4-pro: overloaded",
      "fetch failed",
      "read ECONNRESET",
    ]) {
      expect(generationErrorCode(new Error(message))).toBe("upstream_unavailable");
    }
    // A rejected request is the request's fault, and would be rejected again.
    expect(
      generationErrorCode(
        new Error("DeepSeek request failed (400) for deepseek-v4-pro: bad param"),
      ),
    ).toBe("generation_failed");
  });

  it("still falls back for the unknown", () => {
    expect(generationErrorCode(new Error("something else"))).toBe(
      "generation_failed",
    );
  });
});

/**
 * Only failures that say nothing about the request keep a checkpoint. Resuming
 * one that would recur replays it with the same plan and the same files.
 */
describe("isResumableError", () => {
  it("keeps a checkpoint for time, reasoning and service failures", () => {
    for (const code of [
      "plan_timed_out",
      "step_timed_out",
      "reasoning_exhausted",
      "upstream_unavailable",
    ]) {
      expect(isResumableError(code)).toBe(true);
    }
  });

  it("closes it for failures that would recur", () => {
    for (const code of [
      "generation_failed",
      "output_truncated",
      "snapshot_unreadable",
      "plan_named_no_files",
    ]) {
      expect(isResumableError(code)).toBe(false);
    }
  });
});
