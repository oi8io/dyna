import { describe, expect, it } from "vitest";

import { FakeGameProvider } from "@/server/llm/fake-provider";
import { buildInputFixture } from "@/server/llm/test-fixtures";
import { validateStandaloneHtml } from "@/server/build/validation";
import { buildWorkspaceLocally } from "./local-esbuild";

describe("local esbuild executor", () => {
  it("bundles a validated workspace without running its build script", async () => {
    const generated = await new FakeGameProvider().generate(
      buildInputFixture({ prompt: "做一个可玩的打砖块游戏" }),
    );

    const result = await buildWorkspaceLocally(generated.workspace);

    expect(result.executor).toBe("local-esbuild");
    expect(result.artifactHtml).toContain("<script>");
    expect(result.artifactHtml).toContain("<style>");
    expect(() => validateStandaloneHtml(result.artifactHtml)).not.toThrow();
  });

  it("ships a base layer that keeps the artifact inside its container", async () => {
    const generated = await new FakeGameProvider().generate(buildInputFixture());
    const { artifactHtml } = await buildWorkspaceLocally(generated.workspace);

    // The same artifact renders in a narrow builder pane, a full-width play
    // page and a phone. Without these the iframe grows its own scrollbars.
    expect(artifactHtml).toContain("html,body{margin:0;width:100%;height:100%;overflow:hidden}");
    expect(artifactHtml).toContain("canvas,svg,img,video{max-width:100%;max-height:100%}");

    // The agent stylesheet must come after the base layer so a game can still
    // override any of it.
    const baseAt = artifactHtml.indexOf("#root>*{max-width:100%");
    const agentAt = artifactHtml.indexOf(".game-shell");
    expect(baseAt).toBeGreaterThan(-1);
    expect(agentAt).toBeGreaterThan(baseAt);
  });
});
