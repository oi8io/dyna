import type { GenerationPlan } from "@/server/llm/plan";
import type { BuildInput, PlanInput } from "@/server/llm/types";

/** A confident plan, i.e. one that asks nothing and therefore proceeds to build. */
export function planFixture(overrides: Partial<GenerationPlan> = {}) {
  return {
    understanding: "做一个可玩的打砖块。",
    changes: [{ path: "src/App.tsx", intent: "渲染游戏外壳" }],
    assumptions: [],
    questions: [],
    spec: {
      goal: "轻量、几秒上手的网页小游戏。",
      coreLoop: "移动挡板接球，击碎全部砖块。",
      constraints: [],
      decisions: [],
      openQuestions: [],
    },
    changeSummary: "生成了首个可玩版本。",
    ...overrides,
  } satisfies GenerationPlan;
}

export function planInputFixture(
  overrides: Partial<PlanInput> = {},
): PlanInput {
  return {
    kind: "create",
    prompt: "做一个霓虹风格打砖块",
    originalPrompt: "做一个霓虹风格打砖块",
    history: [],
    ...overrides,
  };
}

export function buildInputFixture(
  overrides: Partial<BuildInput> = {},
): BuildInput {
  return {
    ...planInputFixture(),
    plan: planFixture(),
    ...overrides,
  };
}
