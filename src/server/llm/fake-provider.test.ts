import { transform } from "esbuild";
import { describe, expect, it } from "vitest";

import { validateStandaloneHtml } from "@/server/build/validation";
import {
  fakeWorkspaceFixture,
  planInputFixture,
  writeInputFixture,
} from "@/server/llm/test-fixtures";
import { FakeGameProvider } from "./fake-provider";

describe("FakeGameProvider", () => {
  it("assembles compilable source across one call per planned file", async () => {
    const { workspace, prebuiltArtifactHtml } = await fakeWorkspaceFixture();

    const paths = workspace.files.map((file) => file.path);
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

    for (const file of workspace.files) {
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

    expect(prebuiltArtifactHtml).toBeTruthy();
    expect(prebuiltArtifactHtml).toContain(".overlay[hidden]{display:none}");
    expect(() =>
      validateStandaloneHtml(prebuiltArtifactHtml ?? ""),
    ).not.toThrow();
  });

  it("writes the engine the App imports, in the same pass", async () => {
    const { files } = await new FakeGameProvider().write(writeInputFixture());
    const engine = files.find((file) => file.path === "src/game/engine.ts");
    expect(engine?.content).toContain("BreakoutEngine");
  });

  it("plans files in dependency order so later ones can rely on earlier", async () => {
    const { plan } = await new FakeGameProvider().plan(planInputFixture());
    const paths = plan.changes.map((change) => change.path);
    expect(paths.indexOf("src/game/engine.ts")).toBeLessThan(
      paths.indexOf("src/App.tsx"),
    );
  });

  it("never asks a question, because the fixture is fully determined", async () => {
    const { plan } = await new FakeGameProvider().plan(planInputFixture());
    expect(plan.questions).toEqual([]);
  });
});
