import { describe, expect, it } from "vitest";

import { validateStandaloneHtml } from "@/server/build/validation";
import { fakeWorkspaceFixture } from "@/server/llm/test-fixtures";
import { buildWorkspaceLocally } from "@/server/build/local-esbuild";

/**
 * The artifact reports on itself.
 *
 * The preview iframe is sandboxed without `allow-same-origin`, so the builder
 * cannot read into it: a game that throws on mount looks exactly like one that
 * is still loading. A script in the platform-owned shell posts the outcome back
 * out, which is the only way the user learns why the screen is blank.
 */
describe("preview self-report", () => {
  it("ships a probe that posts to the parent", async () => {
    const { workspace } = await fakeWorkspaceFixture();
    const { artifactHtml } = await buildWorkspaceLocally(workspace);

    expect(artifactHtml).toContain('source:"dyna-preview"');
    expect(artifactHtml).toContain("parent.postMessage");
  });

  it("reports uncaught errors and rejected promises", async () => {
    const { workspace } = await fakeWorkspaceFixture();
    const { artifactHtml } = await buildWorkspaceLocally(workspace);

    expect(artifactHtml).toContain('addEventListener("error"');
    expect(artifactHtml).toContain('addEventListener("unhandledrejection"');
  });

  it("reports whether anything actually rendered", async () => {
    const { workspace } = await fakeWorkspaceFixture();
    const { artifactHtml } = await buildWorkspaceLocally(workspace);

    // A build that compiles but renders nothing is the failure the user sees
    // as "预览没内容", and it is invisible to every other check we run.
    expect(artifactHtml).toContain("childElementCount");
  });

  it("runs before the game, so a crash on module load is still caught", async () => {
    const { workspace } = await fakeWorkspaceFixture();
    const { artifactHtml } = await buildWorkspaceLocally(workspace);

    // The bundle is the last script in the document; minification mangles
    // everything inside it, so position is the only stable thing to assert on.
    const probeAt = artifactHtml.indexOf('source:"dyna-preview"');
    const bundleAt = artifactHtml.lastIndexOf("<script>");
    expect(probeAt).toBeGreaterThan(-1);
    expect(bundleAt).toBeGreaterThan(probeAt);
  });

  it("does not violate the artifact's own security policy", async () => {
    const { workspace } = await fakeWorkspaceFixture();
    const { artifactHtml } = await buildWorkspaceLocally(workspace);

    expect(() => validateStandaloneHtml(artifactHtml)).not.toThrow();
  });
});
