import { describe, expect, it } from "vitest";

import {
  isEditableAgentPath,
  normalizeWorkspacePath,
  validateAgentFiles,
  validateWorkspace,
  WorkspaceValidationError,
} from "./schema";

describe("workspace path isolation", () => {
  it.each([
    "../.env",
    "src/../../.env",
    "/etc/passwd",
    "src\\..\\secret",
    ".git/config",
  ])("rejects %s", (path) => {
    expect(() => normalizeWorkspacePath(path)).toThrow(
      WorkspaceValidationError,
    );
  });

  it("accepts files inside the generated project", () => {
    expect(normalizeWorkspacePath("./src/game.ts")).toBe("src/game.ts");
    expect(normalizeWorkspacePath("public/sprite.svg")).toBe(
      "public/sprite.svg",
    );
  });

  it("requires a runnable entry point", () => {
    expect(() =>
      validateWorkspace({
        title: "Game",
        summary: "No entry point",
        files: [{ path: "src/game.ts", content: "export {}" }],
      }),
    ).toThrow("index.html");
  });

  it("prevents the Agent from changing locked build files", () => {
    expect(() =>
      validateAgentFiles([
        { path: "package.json", content: '{"scripts":{"pwn":"..."}}' },
      ]),
    ).toThrow("may not modify the template file");
  });

  it("identifies which agent-supplied paths are editable", () => {
    expect(isEditableAgentPath("src/App.tsx")).toBe(true);
    expect(isEditableAgentPath("src/game/engine.ts")).toBe(true);
    expect(isEditableAgentPath("package.json")).toBe(false);
    expect(isEditableAgentPath("../.env")).toBe(false);
  });
});
