import { FakeGameProvider } from "@/server/llm/fake-provider";
import type { GenerationPlan } from "@/server/llm/plan";
import type { PlanInput, WriteInput } from "@/server/llm/types";
import { createGameWorkspace } from "@/server/template/game-template";

/** A confident plan, i.e. one that asks nothing and therefore proceeds to build. */
export function planFixture(overrides: Partial<GenerationPlan> = {}) {
  return {
    understanding: "做一个可玩的打砖块。",
    changes: [
      { path: "src/game/engine.ts", intent: "实现核心玩法循环" },
      { path: "src/App.tsx", intent: "渲染游戏外壳" },
    ],
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

export function writeInputFixture(
  overrides: Partial<WriteInput> = {},
): WriteInput {
  return {
    ...planInputFixture(),
    plan: planFixture(),
    ...overrides,
  };
}

/**
 * Runs the demo provider through a whole plan, one file per call, the way the
 * route does. Gives tests a complete workspace without reaching for a model.
 */
export async function fakeWorkspaceFixture(prompt = "做一个霓虹风格打砖块") {
  const provider = new FakeGameProvider();
  const input = planInputFixture({ prompt, originalPrompt: prompt });
  const { plan } = await provider.plan(input);
  const { files } = await provider.write({ ...input, plan });

  return {
    plan,
    workspace: createGameWorkspace({
      title: "霓虹打砖块",
      summary: plan.changeSummary,
      agentFiles: files,
    }),
    prebuiltArtifactHtml: provider.prebuiltArtifactHtml(input),
  };
}
