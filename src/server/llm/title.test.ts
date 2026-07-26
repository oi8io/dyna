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
