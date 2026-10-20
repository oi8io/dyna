import { describe, expect, it } from "vitest";

import { generationErrorCode } from "@/server/generation/errors";

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

  it("classifies either model clock as a timeout", () => {
    expect(
      generationErrorCode(new Error("deepseek_idle_timed_out: after 45s")),
    ).toBe("step_timed_out");
    expect(
      generationErrorCode(new Error("deepseek_deadline_timed_out: after 290s")),
    ).toBe("step_timed_out");
  });

  it("still falls back for the unknown", () => {
    expect(generationErrorCode(new Error("something else"))).toBe(
      "generation_failed",
    );
  });
});
