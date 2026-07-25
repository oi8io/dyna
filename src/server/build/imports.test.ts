import { describe, expect, it } from "vitest";

import { findUnresolvedImports } from "@/server/build/imports";
import { fakeWorkspaceFixture } from "@/server/llm/test-fixtures";
import type { GeneratedWorkspace } from "@/server/workspace/schema";

function workspaceOf(
  files: Array<{ path: string; content: string }>,
): GeneratedWorkspace {
  return { title: "t", summary: "s", files };
}

describe("findUnresolvedImports", () => {
  it("catches the off-by-one directory that broke the real build", () => {
    // src/components/game/ -> ../game/engine lands in src/components/game,
    // not src/game. It needed one more level up.
    const problems = findUnresolvedImports(
      workspaceOf([
        {
          path: "src/components/game/SpiderSolitaire.tsx",
          content: `import { deal } from '../game/engine';`,
        },
        { path: "src/game/engine.ts", content: "export const deal = 1;" },
      ]),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].resolved).toBe("src/components/game/engine");
  });

  it("accepts the correct depth", () => {
    expect(
      findUnresolvedImports(
        workspaceOf([
          {
            path: "src/components/game/SpiderSolitaire.tsx",
            content: `import { deal } from '../../game/engine';`,
          },
          { path: "src/game/engine.ts", content: "export const deal = 1;" },
        ]),
      ),
    ).toEqual([]);
  });

  it("ignores bare specifiers, which package.json resolves", () => {
    expect(
      findUnresolvedImports(
        workspaceOf([
          {
            path: "src/App.tsx",
            content: `import React from "react";\nimport { z } from 'zod';`,
          },
        ]),
      ),
    ).toEqual([]);
  });

  it("resolves side-effect imports such as stylesheets", () => {
    expect(
      findUnresolvedImports(
        workspaceOf([
          { path: "src/main.tsx", content: `import "./styles.css";` },
          { path: "src/styles.css", content: "body{}" },
        ]),
      ),
    ).toEqual([]);
  });

  it("flags a stylesheet that was never written", () => {
    const problems = findUnresolvedImports(
      workspaceOf([
        { path: "src/main.tsx", content: `import "./styles.css";` },
      ]),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].specifier).toBe("./styles.css");
  });

  it("resolves an extensionless import to its .ts file", () => {
    expect(
      findUnresolvedImports(
        workspaceOf([
          { path: "src/App.tsx", content: `import x from "./game/state";` },
          { path: "src/game/state.ts", content: "export default 1;" },
        ]),
      ),
    ).toEqual([]);
  });

  it("resolves a directory import to its index file", () => {
    expect(
      findUnresolvedImports(
        workspaceOf([
          { path: "src/App.tsx", content: `import x from "./game";` },
          { path: "src/game/index.ts", content: "export default 1;" },
        ]),
      ),
    ).toEqual([]);
  });

  it("does not skip re-exports", () => {
    const problems = findUnresolvedImports(
      workspaceOf([
        { path: "src/App.tsx", content: `export { deal } from "./missing";` },
      ]),
    );
    expect(problems).toHaveLength(1);
  });

  it("passes a workspace the demo provider actually produces", async () => {
    const { workspace } = await fakeWorkspaceFixture();
    expect(findUnresolvedImports(workspace)).toEqual([]);
  });
});
