import { describe, expect, it } from "vitest";

import { filterCases, loadDataset } from "./dataset";

/**
 * The dataset is edited by hand, one JSON object per line. A typo there would
 * otherwise surface as a confusing crash halfway through a paid live run, so it
 * is validated by the same gate that runs the unit tests.
 */
describe("the shipped dataset", () => {
  it("parses, and every case is well-formed", async () => {
    const cases = await loadDataset("evals/datasets/games.v1.jsonl");

    expect(cases.length).toBeGreaterThanOrEqual(20);
    for (const item of cases) {
      expect(item.tags.length).toBeGreaterThan(0);
      if (item.kind === "edit") expect(item.seedPrompt).toBeTruthy();
    }
  });

  it("keeps both sides of the clarification label represented", async () => {
    const cases = await loadDataset("evals/datasets/games.v1.jsonl");
    const ambiguous = cases.filter((item) => item.expectClarification);

    // A set with no ambiguous cases scores a model that never asks at 100%,
    // which is exactly the failure the two-stage design exists to prevent.
    expect(ambiguous.length).toBeGreaterThanOrEqual(4);
    expect(cases.length - ambiguous.length).toBeGreaterThanOrEqual(10);
  });

  it("rejects a duplicate id rather than silently overwriting a case", async () => {
    await expect(loadDataset("evals/runner/__fixtures__/duplicate-id.jsonl")).rejects.toThrow(
      /repeats the id/,
    );
  });

  it("rejects an edit case with nothing to edit", async () => {
    await expect(loadDataset("evals/runner/__fixtures__/edit-without-seed.jsonl")).rejects.toThrow(
      /seedPrompt/,
    );
  });

  it("filters by id fragment and by tag", async () => {
    const cases = await loadDataset("evals/datasets/games.v1.jsonl");

    expect(filterCases(cases, []).length).toBe(cases.length);
    expect(filterCases(cases, ["ambiguous"]).every((item) => item.tags.includes("ambiguous") || item.id.includes("ambiguous"))).toBe(true);
    expect(filterCases(cases, ["zh", "edit"]).length).toBeGreaterThan(0);
  });
});
