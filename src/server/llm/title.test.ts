import { describe, expect, it } from "vitest";

import { normalizeTitle } from "@/server/llm/title";

describe("normalizeTitle", () => {
  it("keeps the name out of a request that wraps it in an instruction", () => {
    expect(normalizeTitle("做一个蜘蛛纸牌")).toBe("蜘蛛纸牌");
    expect(normalizeTitle("帮我生成一个贪吃蛇")).toBe("贪吃蛇");
    expect(normalizeTitle("我想要一个2048")).toBe("2048");
  });

  it("stops at the first clause, where naming ends and describing begins", () => {
    expect(normalizeTitle("做一个蜘蛛纸牌，要有拖拽和难度选择")).toBe(
      "蜘蛛纸牌",
    );
    expect(normalizeTitle("霓虹打砖块。加入连击和粒子效果")).toBe("霓虹打砖块");
  });

  it("unwraps quotes the model likes to add", () => {
    expect(normalizeTitle("「蜘蛛纸牌」")).toBe("蜘蛛纸牌");
    expect(normalizeTitle('"Neon Breaker"')).toBe("Neon Breaker");
    expect(normalizeTitle("做一个《连连看》")).toBe("连连看");
  });

  it("leaves a title that was already a name alone", () => {
    expect(normalizeTitle("蜘蛛纸牌")).toBe("蜘蛛纸牌");
    expect(normalizeTitle("霓虹打砖块")).toBe("霓虹打砖块");
  });

  it("caps a run-on title rather than letting it fill the sidebar", () => {
    const long = "超级无敌豪华究极限定版本的打砖块游戏还带排行榜和成就系统";
    expect(normalizeTitle(long).length).toBeLessThanOrEqual(20);
  });

  it("falls back when the request says nothing nameable", () => {
    expect(normalizeTitle("做一个")).toBe("未命名作品");
    expect(normalizeTitle("   ")).toBe("未命名作品");
    expect(normalizeTitle("", "新作品")).toBe("新作品");
  });

  it("collapses newlines instead of carrying them into a heading", () => {
    expect(normalizeTitle("蜘蛛纸牌\n要能拖拽")).toBe("蜘蛛纸牌");
  });
});

/**
 * The name is the project's, not a version's.
 *
 * It appears in the sidebar and on every published card, and it must not drift
 * because someone asked for a faster ball. The planner is told not to name
 * anything; these pin that down.
 */
describe("naming is separate from editing", () => {
  it("the plan schema carries no title at all", async () => {
    const { generationPlanSchema } = await import("@/server/llm/plan");
    const plan = generationPlanSchema.parse({
      understanding: "x",
      title: "模型试图改名",
    });
    expect(plan).not.toHaveProperty("title");
  });

  it("the planner is told the project already has a name", async () => {
    const { PLAN_PROMPT } = await import("@/server/llm/prompts");
    expect(PLAN_PROMPT).toContain("Do not name the project");
  });

  it("naming asks for a name and shows what that means", async () => {
    const { NAME_PROMPT } = await import("@/server/llm/prompts");
    expect(NAME_PROMPT).toContain("A NAME, not a description");
    expect(NAME_PROMPT).toContain("蜘蛛纸牌");
  });

  it("the demo provider can name a project too", async () => {
    const { FakeGameProvider } = await import("@/server/llm/fake-provider");
    const name = await new FakeGameProvider().nameProject("做一个蜘蛛纸牌");
    expect(name.length).toBeGreaterThan(0);
  });
});

/**
 * English requests wrap the name in the same way Chinese ones do, just with
 * more layers: "please make me a" is four separate openers, not one.
 */
describe("normalizeTitle in English", () => {
  it("strips the verb and the article", () => {
    expect(normalizeTitle("make a spider solitaire")).toBe("spider solitaire");
    expect(normalizeTitle("build me a neon breakout")).toBe("neon breakout");
    expect(normalizeTitle("please create an endless runner")).toBe(
      "endless runner",
    );
    expect(normalizeTitle("I want to play a tower defense")).toBe(
      "tower defense",
    );
  });

  it("stops at the first clause here too", () => {
    expect(normalizeTitle("make a spider solitaire, with drag and drop")).toBe(
      "spider solitaire",
    );
  });

  it("leaves a name that never had an opener alone", () => {
    expect(normalizeTitle("Neon Breakout")).toBe("Neon Breakout");
    // Without a word boundary, the opener pattern would eat these.
    expect(normalizeTitle("Makeshift Empire")).toBe("Makeshift Empire");
    expect(normalizeTitle("Anagram Rush")).toBe("Anagram Rush");
  });

  it("gives an English title room the Chinese cap would not", () => {
    const long = "an endless roguelike deckbuilder with permanent upgrades";
    const title = normalizeTitle(long);
    expect(title.length).toBeGreaterThan(20);
    expect(title.length).toBeLessThanOrEqual(40);
    // Truncation lands on a word boundary rather than mid-word.
    expect(long).toContain(title);
    expect(title.endsWith(" ")).toBe(false);
  });

  it("falls back in the language the request was written in", () => {
    expect(normalizeTitle("make a")).toBe("Untitled");
    expect(normalizeTitle("做一个")).toBe("未命名作品");
  });
});
