import { describe, expect, it } from "vitest";

import { findUnresolvedImports } from "@/server/build/imports";
import { FakeGameProvider } from "@/server/llm/fake-provider";
import {
  fakeWorkspaceFixture,
  planFixture,
  writeInputFixture,
} from "@/server/llm/test-fixtures";

/**
 * Files are written together, in one call, because they have to agree with each
 * other. Writing them one at a time left each one guessing about the others and
 * produced import paths that pointed at nothing.
 */
describe("write step", () => {
  it("returns every file the plan asked for", async () => {
    const { files } = await new FakeGameProvider().write(writeInputFixture());
    expect(files.map((file) => file.path)).toEqual([
      "src/game/engine.ts",
      "src/App.tsx",
    ]);
  });

  it("covers a plan with more files than the fixture knows", async () => {
    const { files } = await new FakeGameProvider().write(
      writeInputFixture({
        plan: planFixture({
          changes: [
            { path: "src/App.tsx", intent: "外壳" },
            { path: "src/components/game/Hud.tsx", intent: "分数显示" },
          ],
        }),
      }),
    );
    expect(files).toHaveLength(2);
    expect(files[1].content).toContain("分数显示");
  });

  it("refuses a plan naming a path outside the writable area", async () => {
    await expect(
      new FakeGameProvider().write(
        writeInputFixture({
          plan: planFixture({
            changes: [{ path: "package.json", intent: "改依赖" }],
          }),
        }),
      ),
    ).rejects.toThrow();
  });

  it("produces a workspace whose imports all resolve", async () => {
    const { workspace } = await fakeWorkspaceFixture();
    expect(findUnresolvedImports(workspace)).toEqual([]);
  });
});
