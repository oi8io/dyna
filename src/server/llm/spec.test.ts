import { describe, expect, it } from "vitest";

import {
  SPEC_PATH,
  appendChangelog,
  extractChangelog,
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
