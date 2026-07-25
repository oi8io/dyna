import { transform } from "esbuild";
import { describe, expect, it } from "vitest";

import { validateStandaloneHtml } from "@/server/build/validation";
import { buildInputFixture } from "@/server/llm/test-fixtures";
import { FakeGameProvider } from "./fake-provider";

describe("FakeGameProvider", () => {
  it("returns compilable engineering source and a playable artifact", async () => {
    const result = await new FakeGameProvider().generate(buildInputFixture());

    const paths = result.workspace.files.map((file) => file.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "package.json",
        "build.mjs",
        "src/main.tsx",
        "src/App.tsx",
        "src/game/engine.ts",
        "src/styles.css",
      ]),
    );

    for (const file of result.workspace.files) {
      if (file.path.endsWith(".tsx")) {
        await expect(
          transform(file.content, { loader: "tsx", jsx: "automatic" }),
        ).resolves.toBeDefined();
      }
      if (file.path.endsWith(".ts")) {
        await expect(
          transform(file.content, { loader: "ts" }),
        ).resolves.toBeDefined();
      }
    }

    expect(result.prebuiltArtifactHtml).toBeTruthy();
    expect(result.prebuiltArtifactHtml).toContain(
      ".overlay[hidden]{display:none}",
    );
    expect(() =>
      validateStandaloneHtml(result.prebuiltArtifactHtml ?? ""),
    ).not.toThrow();
  });
});
