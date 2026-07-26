import { describe, expect, it } from "vitest";

import { FakeGameProvider } from "@/server/llm/fake-provider";
import { writeInputFixture } from "@/server/llm/test-fixtures";

/**
 * The write step asks for one file and picks the requested path out of whatever
 * comes back. A model that returns the whole project is verbose, not wrong —
 * rejecting that response threw away one that contained exactly what was asked
 * for.
 */
describe("single-file write step", () => {
  it("returns the requested path even when the plan lists many files", async () => {
    const { file } = await new FakeGameProvider().writeFile(
      writeInputFixture({ path: "src/styles.css", intent: "样式" }),
    );
    expect(file.path).toBe("src/styles.css");
  });

  it("writes a path the fixture has no content for rather than failing", async () => {
    const { file } = await new FakeGameProvider().writeFile(
      writeInputFixture({
        path: "src/components/game/Hud.tsx",
        intent: "分数显示",
      }),
    );
    expect(file.path).toBe("src/components/game/Hud.tsx");
    expect(file.content).toContain("分数显示");
  });

  it("refuses a path outside the agent's writable area", async () => {
    await expect(
      new FakeGameProvider().writeFile(
        writeInputFixture({ path: "package.json", intent: "改依赖" }),
      ),
    ).rejects.toThrow();
  });
});
