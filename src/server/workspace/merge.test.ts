import { describe, expect, it } from "vitest";

import { planNeedsClarification } from "@/server/llm/plan";
import { planFixture } from "@/server/llm/test-fixtures";
import {
  WorkspaceValidationError,
  mergeAgentFiles,
} from "@/server/workspace/schema";

const previous = [
  { path: "src/App.tsx", content: "old app" },
  { path: "src/game/engine.ts", content: "old engine" },
  { path: "src/styles.css", content: "old styles" },
];

describe("mergeAgentFiles", () => {
  it("carries untouched files over byte for byte", () => {
    const merged = mergeAgentFiles(previous, [
      { path: "src/App.tsx", content: "new app" },
    ]);
    expect(merged).toEqual(
      expect.arrayContaining([
        { path: "src/App.tsx", content: "new app" },
        { path: "src/game/engine.ts", content: "old engine" },
        { path: "src/styles.css", content: "old styles" },
      ]),
    );
  });

  it("adds files the previous version did not have", () => {
    const merged = mergeAgentFiles(previous, [
      { path: "src/components/game/Hud.tsx", content: "hud" },
    ]);
    expect(merged).toHaveLength(4);
  });

  it("removes files listed as deleted", () => {
    const merged = mergeAgentFiles(previous, [], ["src/styles.css"]);
    expect(merged.map((file) => file.path)).not.toContain("src/styles.css");
  });

  it("refuses to delete a platform-owned file", () => {
    expect(() => mergeAgentFiles(previous, [], ["package.json"])).toThrow(
      WorkspaceValidationError,
    );
  });

  it("refuses to write a platform-owned file through the merge", () => {
    expect(() =>
      mergeAgentFiles(previous, [{ path: "package.json", content: "{}" }]),
    ).toThrow(WorkspaceValidationError);
  });

  it("rejects a path traversal smuggled in as a change", () => {
    expect(() =>
      mergeAgentFiles(previous, [
        { path: "src/game/../../etc/passwd", content: "x" },
      ]),
    ).toThrow();
  });

  it("refuses to leave the workspace with no editable files", () => {
    expect(() =>
      mergeAgentFiles(previous, [], previous.map((file) => file.path)),
    ).toThrow(WorkspaceValidationError);
  });

  it("re-validates carried-over files, not just the changed ones", () => {
    // An older version could have been stored before a whitelist tightened.
    expect(() =>
      mergeAgentFiles([{ path: "build.mjs", content: "old" }], [
        { path: "src/App.tsx", content: "new" },
      ]),
    ).toThrow(WorkspaceValidationError);
  });
});

describe("planNeedsClarification", () => {
  it("is false for a confident plan", () => {
    expect(planNeedsClarification(planFixture())).toBe(false);
  });

  it("is true whenever a question is present, even alongside changes", () => {
    const plan = planFixture({
      questions: [{ question: "要单人还是双人？", options: ["单人", "双人"] }],
      changes: [{ path: "src/App.tsx", intent: "先改这个" }],
    });
    expect(planNeedsClarification(plan)).toBe(true);
  });
});
