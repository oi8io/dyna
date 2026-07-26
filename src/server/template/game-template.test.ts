import { describe, expect, it } from "vitest";

import { findUnresolvedImports } from "@/server/build/imports";
import { createGameWorkspace } from "@/server/template/game-template";

/**
 * `src/main.tsx` is platform-owned and imports `./App` and `./styles.css` by
 * name. Whether those exist must not depend on what the planner happened to
 * list, because a workspace missing them cannot build and cannot be repaired.
 */
describe("createGameWorkspace entry point guarantees", () => {
  it("builds a resolvable workspace from no agent files at all", () => {
    const workspace = createGameWorkspace({
      title: "空工程",
      summary: "什么都没写",
      agentFiles: [],
    });
    expect(findUnresolvedImports(workspace)).toEqual([]);
  });

  it("stays resolvable when the plan only produced a component", () => {
    const workspace = createGameWorkspace({
      title: "蜘蛛纸牌",
      summary: "只写了组件",
      agentFiles: [
        {
          path: "src/components/game/Board.tsx",
          content: "export default function Board() { return null; }",
        },
      ],
    });
    expect(findUnresolvedImports(workspace)).toEqual([]);
  });

  it("lets agent files replace the fallbacks rather than colliding", () => {
    const workspace = createGameWorkspace({
      title: "真游戏",
      summary: "写了主体",
      agentFiles: [
        { path: "src/App.tsx", content: "export default function App(){return null}" },
        { path: "src/styles.css", content: ".real{}" },
      ],
    });

    const app = workspace.files.filter((file) => file.path === "src/App.tsx");
    expect(app).toHaveLength(1);
    expect(app[0].content).toContain("return null");
    expect(
      workspace.files.find((file) => file.path === "src/styles.css")?.content,
    ).toBe(".real{}");
  });

  it("never lets an agent file replace a platform-owned one", () => {
    const workspace = createGameWorkspace({
      title: "越界",
      summary: "试图改模板",
      agentFiles: [
        { path: "src/App.tsx", content: "export default function App(){return null}" },
      ],
    });
    expect(
      workspace.files.find((file) => file.path === "src/main.tsx")?.content,
    ).toContain("createRoot");
  });

  it("keeps exactly one entry for every path", () => {
    const workspace = createGameWorkspace({
      title: "去重",
      summary: "s",
      agentFiles: [
        { path: "src/App.tsx", content: "a" },
        { path: "src/styles.css", content: "b" },
      ],
    });
    const paths = workspace.files.map((file) => file.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
