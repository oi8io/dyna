import { describe, expect, it } from "vitest";

import {
  FALLBACK_CHANGE_SUMMARY,
  generationPlanSchema,
  planIntent,
  planNeedsClarification,
} from "@/server/llm/plan";

/**
 * The plan schema sits between a live model and the whole generation pipeline.
 * A field the model happens to omit must degrade, never throw: a hard failure
 * here surfaces to the user as a generic "生成失败" they cannot act on.
 */
describe("generationPlanSchema tolerance", () => {
  it("accepts a plan that only carries an understanding", () => {
    const plan = generationPlanSchema.parse({ understanding: "改一下球速" });
    expect(plan.changes).toEqual([]);
    expect(plan.assumptions).toEqual([]);
    expect(plan.questions).toEqual([]);
    expect(plan.spec).toBeUndefined();
    // A sentinel, not copy: the run swaps it for a sentence in the language
    // the request was written in before anyone reads it.
    expect(plan.changeSummary).toBe(FALLBACK_CHANGE_SUMMARY);
  });

  it("keeps a spec when the model supplies a complete one", () => {
    const plan = generationPlanSchema.parse({
      understanding: "x",
      spec: { goal: "轻量小游戏", coreLoop: "接球击砖" },
    });
    expect(plan.spec?.goal).toBe("轻量小游戏");
    expect(plan.spec?.constraints).toEqual([]);
  });

  it("drops a malformed spec instead of failing the run", () => {
    const plan = generationPlanSchema.parse({
      understanding: "x",
      spec: { goal: "只有目标，缺少核心循环" },
    });
    expect(plan.spec).toBeUndefined();
  });

  it("drops malformed changes instead of failing the run", () => {
    const plan = generationPlanSchema.parse({
      understanding: "x",
      changes: "not an array",
    });
    expect(plan.changes).toEqual([]);
  });

  it("drops malformed questions rather than blocking on garbage", () => {
    const plan = generationPlanSchema.parse({
      understanding: "x",
      questions: [{ question: "只有一个选项", options: ["a"] }],
    });
    expect(plan.questions).toEqual([]);
    expect(planNeedsClarification(plan)).toBe(false);
  });

  it("still rejects a plan with no understanding at all", () => {
    expect(() => generationPlanSchema.parse({ changes: [] })).toThrow();
  });

  it("keeps well-formed questions and gates the build on them", () => {
    const plan = generationPlanSchema.parse({
      understanding: "x",
      questions: [{ question: "单人还是双人？", options: ["单人", "双人"] }],
    });
    expect(planNeedsClarification(plan)).toBe(true);
  });
});

/**
 * A question used to have nowhere to go but a rewrite: the plan could only
 * name files or ask back. "究竟实现的咋样了？" rewrote five files.
 */
describe("planIntent", () => {
  const changes = [{ path: "src/game/engine.ts", intent: "修合并" }];

  it("answers when the model says the user asked", () => {
    const plan = generationPlanSchema.parse({
      intent: "answer",
      understanding: "用户想知道当前实现的进度",
    });
    expect(planIntent(plan)).toBe("answer");
  });

  it("answers rather than rewrites when the model says both", () => {
    // An unwanted rewrite cannot be taken back; an answer can be followed by
    // "then fix it".
    const plan = generationPlanSchema.parse({
      intent: "answer",
      understanding: "x",
      changes,
    });
    expect(planIntent(plan)).toBe("answer");
  });

  it("answers a plan that names nothing to change instead of failing it", () => {
    const plan = generationPlanSchema.parse({ understanding: "x" });
    expect(planIntent(plan)).toBe("answer");
  });

  it("builds when there are changes and the model did not say otherwise", () => {
    expect(
      planIntent(generationPlanSchema.parse({ understanding: "x", changes })),
    ).toBe("change");
    expect(
      planIntent(
        generationPlanSchema.parse({ intent: "change", understanding: "x", changes }),
      ),
    ).toBe("change");
  });

  it("lets questions win over everything", () => {
    const plan = generationPlanSchema.parse({
      intent: "change",
      understanding: "x",
      changes,
      questions: [{ question: "单人还是双人？", options: ["单人", "双人"] }],
    });
    expect(planIntent(plan)).toBe("clarify");
  });

  it("ignores an intent it does not recognise", () => {
    const plan = generationPlanSchema.parse({
      intent: "rewrite-everything",
      understanding: "x",
      changes,
    });
    expect(plan.intent).toBeUndefined();
    expect(planIntent(plan)).toBe("change");
  });
});
