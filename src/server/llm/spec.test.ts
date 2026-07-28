import { describe, expect, it } from "vitest";

import {
  SPEC_PATH,
  appendChangelog,
  extractChangelog,
  projectSpecSchema,
  renderSpecMarkdown,
} from "@/server/llm/spec";
import { planFixture } from "@/server/llm/test-fixtures";

const spec = {
  goal: "一个几秒就能上手的轻量小游戏。",
  coreLoop: "移动挡板接球，击碎全部砖块。",
  constraints: ["不使用远程素材", "单手可玩"],
  decisions: [{ decision: "初始生命值 3", why: "留出试错空间。" }],
  openQuestions: ["是否需要音效"],
};

describe("spec rendering", () => {
  it("includes intent but not derivable structure", () => {
    const markdown = renderSpecMarkdown(spec, []);
    expect(markdown).toContain("## Target experience");
    expect(markdown).toContain("## Core loop");
    expect(markdown).toContain("留出试错空间。");
    // A directory tree or tech stack written by hand goes stale and then
    // misleads the next turn, so it must not appear here.
    expect(markdown).not.toContain("Directory Tree");
    expect(markdown).not.toContain("package.json");
  });

  it("renders empty sections without leaving them blank", () => {
    const markdown = renderSpecMarkdown(
      { ...spec, constraints: [], decisions: [], openQuestions: [] },
      [],
    );
    expect(markdown).toContain("- None yet");
  });

  it("round-trips the changelog across turns", () => {
    const first = renderSpecMarkdown(spec, appendChangelog([], "加了暂停键。"));
    const carried = extractChangelog(first);
    expect(carried).toEqual(["- 加了暂停键。"]);

    const second = renderSpecMarkdown(spec, appendChangelog(carried, "球速加快。"));
    expect(extractChangelog(second)).toEqual(["- 加了暂停键。", "- 球速加快。"]);
  });

  it("treats the placeholder as an empty changelog", () => {
    expect(extractChangelog(renderSpecMarkdown(spec, []))).toEqual([]);
  });

  it("caps the changelog so the spec cannot grow without bound", () => {
    let log: string[] = [];
    for (let i = 0; i < 60; i += 1) log = appendChangelog(log, `改动 ${i}`);
    expect(log).toHaveLength(40);
    expect(log.at(-1)).toBe("- 改动 59");
  });

  it("collapses newlines so one entry stays one bullet", () => {
    expect(appendChangelog([], "第一行\n第二行")).toEqual(["- 第一行 第二行"]);
  });

  it("writes to a path the agent is allowed to keep but the build ignores", () => {
    expect(SPEC_PATH).toBe("SPEC.md");
  });
});

describe("plan gating", () => {
  it("fixture plans are confident by default", () => {
    expect(planFixture().questions).toEqual([]);
  });
});

/**
 * The design fields are the whole point of the spec: they are the only record
 * of why the game is the way it is, and every later turn reads them.
 */
describe("design fields", () => {
  const designed = {
    goal: "几秒上手的霓虹打砖块。",
    coreLoop: "每 1-2 秒球往返一次，移动挡板接住它并清空砖墙。",
    controls: ["← / →：移动挡板", "空格：开球"],
    genreConventions: ["挡板接触点决定反弹角度"],
    difficulty: ["初始球速 4，每清 10 块提速 8%，上限 12"],
    feedback: ["球撞挡板时挡板闪白 80ms"],
    winLose: ["胜：清空全部砖块", "负：三条命耗尽"],
    constraints: [],
    decisions: [],
    openQuestions: [],
  };

  it("renders every design section", () => {
    const markdown = renderSpecMarkdown(designed, []);
    for (const heading of [
      "## Controls",
      "## Genre conventions",
      "## Difficulty",
      "## Feedback",
      "## Win and lose",
    ]) {
      expect(markdown).toContain(heading);
    }
    expect(markdown).toContain("初始球速 4，每清 10 块提速 8%，上限 12");
    expect(markdown).toContain("挡板接触点决定反弹角度");
  });

  /**
   * Projects created before these fields existed carry none of them. Losing a
   * project's goal because a new section was added would be a far worse bug
   * than an empty section.
   */
  it("still renders a spec written before the design fields existed", () => {
    const legacy = {
      goal: "轻量小游戏。",
      coreLoop: "接球，清砖。",
      constraints: ["不使用远程素材"],
      decisions: [],
      openQuestions: [],
    };
    const markdown = renderSpecMarkdown(legacy, ["- 加了暂停键。"]);
    expect(markdown).toContain("轻量小游戏。");
    expect(markdown).toContain("不使用远程素材");
    // The new sections appear, empty, rather than rendering `undefined`.
    expect(markdown).toContain("## Difficulty");
    expect(markdown).not.toContain("undefined");
    // And the history it already had survives.
    expect(extractChangelog(markdown)).toEqual(["- 加了暂停键。"]);
  });

  it("drops a malformed design field instead of failing the whole spec", () => {
    const partly = projectSpecSchema.parse({
      ...designed,
      // The model occasionally answers a list field with prose.
      difficulty: "越来越难",
    });
    expect(partly.difficulty).toEqual([]);
    // Everything else is intact — one bad field must not cost the design.
    expect(partly.goal).toBe(designed.goal);
    expect(partly.feedback).toEqual(designed.feedback);
  });
});

/**
 * `BUILD_PROMPT` held every game rule the project had and stopped being used
 * when generation split into plan and write, which is why generated games
 * stopped behaving like games. These pin the rules to the prompt that runs.
 */
describe("game rules reach the stage that writes the code", () => {
  it("no longer defines a prompt nothing imports", async () => {
    const prompts = await import("@/server/llm/prompts");
    expect("BUILD_PROMPT" in prompts).toBe(false);
  });

  it("tells the writing stage it is building a game", async () => {
    const { WRITE_PROMPT } = await import("@/server/llm/prompts");
    expect(WRITE_PROMPT).toContain("You are building a game");
    // The rule that stops a game running at a different speed per machine.
    expect(WRITE_PROMPT).toContain("requestAnimationFrame");
    expect(WRITE_PROMPT).toContain("ELAPSED TIME");
    expect(WRITE_PROMPT).toContain("setInterval");
    // Recovered from the dead prompt.
    expect(WRITE_PROMPT).toContain("NO scrollbars");
    expect(WRITE_PROMPT).toContain("game-over");
  });

  it("asks the planner for numbers rather than adjectives", async () => {
    const { PLAN_PROMPT } = await import("@/server/llm/prompts");
    expect(PLAN_PROMPT).toContain("NUMBERS AND MECHANISMS, never adjectives");
    for (const field of [
      "genreConventions",
      "difficulty",
      "feedback",
      "winLose",
      "controls",
    ]) {
      expect(PLAN_PROMPT, field).toContain(field);
    }
  });
});
