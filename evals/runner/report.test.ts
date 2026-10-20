import { describe, expect, it } from "vitest";

import { renderMarkdown, summarize } from "./report";
import type { CaseAttempt, EvalCase, RunReport } from "./types";

const cases: EvalCase[] = [
  { id: "clear-one", kind: "create", prompt: "a", expectClarification: false, tags: ["clear"] },
  { id: "clear-two", kind: "create", prompt: "b", expectClarification: false, tags: ["clear"] },
  { id: "vague-one", kind: "create", prompt: "c", expectClarification: true, tags: ["ambiguous"] },
];

function attempt(overrides: Partial<CaseAttempt> & Pick<CaseAttempt, "caseId">): CaseAttempt {
  return {
    attempt: 1,
    outcome: "built",
    correct: true,
    repaired: false,
    gates: [],
    craft: [],
    craftScore: 1,
    timings: { plan: 10, write: 20, build: 30, total: 60 },
    usage: { inputTokens: 1000, outputTokens: 2000, costUsd: 0.001 },
    ...overrides,
  };
}

describe("summarize", () => {
  it("keeps clarification cases out of the build-pass denominator", () => {
    // A model that asks a question on an ambiguous case did the right thing.
    // Counting it as a failed build would punish exactly the behaviour the
    // two-stage design exists to produce.
    const summary = summarize(cases, [
      attempt({ caseId: "clear-one" }),
      attempt({ caseId: "clear-two", outcome: "failed", correct: false, failedStage: "build" }),
      attempt({ caseId: "vague-one", outcome: "clarified", correct: true, craftScore: 0 }),
    ]);

    expect(summary.buildPassRate).toBe(0.5);
    expect(summary.clarificationAccuracy).toBe(1);
    expect(summary.failuresByStage).toEqual({ build: 1 });
  });

  it("separates first-pass builds from ones the repair round rescued", () => {
    const summary = summarize(cases.slice(0, 2), [
      attempt({ caseId: "clear-one" }),
      attempt({ caseId: "clear-two", repaired: true }),
    ]);

    expect(summary.buildPassRate).toBe(1);
    expect(summary.firstPassBuildRate).toBe(0.5);
  });

  it("counts a case as stable only when every repeat agreed", () => {
    const summary = summarize(cases.slice(0, 2), [
      attempt({ caseId: "clear-one", attempt: 1 }),
      attempt({ caseId: "clear-one", attempt: 2, outcome: "failed", correct: false }),
      attempt({ caseId: "clear-two", attempt: 1 }),
      attempt({ caseId: "clear-two", attempt: 2 }),
    ]);

    expect(summary.cases).toBe(2);
    expect(summary.attempts).toBe(4);
    expect(summary.stableCases).toBe(1);
  });

  it("sums cost and reports both latency percentiles", () => {
    const summary = summarize(cases.slice(0, 2), [
      attempt({ caseId: "clear-one", timings: { plan: 0, write: 0, build: 0, total: 100 } }),
      attempt({ caseId: "clear-two", timings: { plan: 0, write: 0, build: 0, total: 900 } }),
    ]);

    expect(summary.totalCostUsd).toBe(0.002);
    expect(summary.p50LatencyMs).toBe(100);
    expect(summary.p95LatencyMs).toBe(900);
  });
});

describe("baseline comparison", () => {
  const report = (attempts: CaseAttempt[]): RunReport => ({
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:01:00.000Z",
    provider: "deepseek",
    model: "deepseek-v4-pro",
    dataset: "test.jsonl",
    repeat: 1,
    concurrency: 1,
    summary: summarize(cases.slice(0, 2), attempts),
    attempts,
  });

  it("names the case that regressed and the one that recovered", () => {
    const baseline = report([
      attempt({ caseId: "clear-one" }),
      attempt({ caseId: "clear-two", outcome: "failed", correct: false, failedStage: "build" }),
    ]);
    const current = report([
      attempt({
        caseId: "clear-one",
        outcome: "failed",
        correct: false,
        failedStage: "write",
        errorDetail: "write_timed_out",
      }),
      attempt({ caseId: "clear-two" }),
    ]);

    const markdown = renderMarkdown(current, cases, baseline);

    expect(markdown).toContain("回归 1 项");
    expect(markdown).toContain("`clear-one` #1 — write_timed_out");
    expect(markdown).toContain("修复 1 项");
    expect(markdown).toContain("`clear-two` #1");
  });

  it("flags a fake run so nobody reads its clarification number as real", () => {
    const fake = { ...report([attempt({ caseId: "clear-one" })]), provider: "fake" as const };

    expect(renderMarkdown(fake, cases)).toContain("fake");
    expect(renderMarkdown(report([attempt({ caseId: "clear-one" })]), cases)).not.toContain(
      "⚠️",
    );
  });
});
