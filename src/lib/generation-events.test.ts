import { describe, expect, it } from "vitest";

import {
  EMPTY_SNAPSHOT,
  type GenerationEvent,
  type GenerationSnapshot,
  foldGenerationEvent,
} from "@/lib/generation-events";

function foldAll(events: GenerationEvent[], from = EMPTY_SNAPSHOT) {
  return events.reduce(foldGenerationEvent, from);
}

/** A run that plans, writes two files, builds and finishes. */
const RUN: GenerationEvent[] = [
  { type: "phase", phase: "planning" },
  {
    type: "plan",
    understanding: "a breakout clone",
    changes: [{ path: "src/game/engine.ts", intent: "core loop" }],
    assumptions: ["three lives"],
  },
  { type: "thinking", chars: 120 },
  { type: "phase", phase: "writing" },
  { type: "file-open", path: "src/game/engine.ts" },
  { type: "file-delta", path: "src/game/engine.ts", text: "export const " },
  { type: "file-delta", path: "src/game/engine.ts", text: "tick = () => {}" },
  { type: "file-close", path: "src/game/engine.ts" },
  { type: "file-open", path: "src/App.tsx" },
  { type: "file-delta", path: "src/App.tsx", text: "export default App" },
  { type: "file-close", path: "src/App.tsx" },
  { type: "phase", phase: "building" },
  { type: "log", level: "info", message: "bundled" },
];

describe("foldGenerationEvent", () => {
  it("rebuilds each file from its own deltas", () => {
    const state = foldAll(RUN);
    expect(state.order).toEqual(["src/game/engine.ts", "src/App.tsx"]);
    expect(state.drafts["src/game/engine.ts"]).toBe("export const tick = () => {}");
    expect(state.drafts["src/App.tsx"]).toBe("export default App");
    expect(state.activePath).toBeUndefined();
    expect(state.phase).toBe("building");
    expect(state.logs).toEqual(["bundled"]);
    expect(state.thinkingChars).toBe(120);
  });

  it("never mutates the state it was given", () => {
    const before = foldAll(RUN);
    const copy = structuredClone(before);
    foldGenerationEvent(before, {
      type: "file-delta",
      path: "src/App.tsx",
      text: "!",
    });
    expect(before).toEqual(copy);
  });

  /**
   * The guarantee the whole reattach feature rests on: someone who opens the
   * page halfway through ends up in exactly the state they would have been in
   * had they watched from the beginning. The server folds, sends one snapshot,
   * and the client folds the rest onto it — so this has to hold for any split.
   */
  it("gives a late subscriber the same state as one that watched throughout", () => {
    const watchedThroughout = foldAll(RUN);

    for (let split = 0; split <= RUN.length; split += 1) {
      const serverSide = foldAll(RUN.slice(0, split));
      const lateSubscriber = foldAll(RUN.slice(split), {
        ...EMPTY_SNAPSHOT,
        // What the stream route sends first when there is nothing to resume.
        ...foldGenerationEvent(EMPTY_SNAPSHOT, {
          type: "snapshot",
          state: serverSide,
        }),
      });
      expect(lateSubscriber, `split at ${split}`).toEqual(watchedThroughout);
    }
  });

  it("treats a snapshot as a replacement, not a merge", () => {
    const stale: GenerationSnapshot = {
      ...EMPTY_SNAPSHOT,
      understanding: "something else",
      order: ["stale.ts"],
      drafts: { "stale.ts": "leftover" },
      logs: ["old"],
    };
    const fresh = foldAll(RUN);
    expect(
      foldGenerationEvent(stale, { type: "snapshot", state: fresh }),
    ).toEqual(fresh);
  });

  it("stops marking a file active once the run ends", () => {
    const midWrite = foldAll(RUN.slice(0, 6));
    expect(midWrite.activePath).toBe("src/game/engine.ts");

    const failed = foldGenerationEvent(midWrite, {
      type: "error",
      code: "step_timed_out",
    });
    expect(failed.activePath).toBeUndefined();
    expect(failed.status).toBe("error");
    // The partial file is kept: it is what the editor is showing.
    expect(failed.drafts["src/game/engine.ts"]).toBe("export const ");
  });

  it("clears the active file when the agent stops to ask", () => {
    const asked = foldGenerationEvent(foldAll(RUN.slice(0, 6)), {
      type: "question",
      understanding: "which mode?",
      questions: [{ question: "one or two players?", options: ["one", "two"] }],
    });
    expect(asked.activePath).toBeUndefined();
    expect(asked.questions).toHaveLength(1);
    // Not terminal in the failure sense — nothing was built, nothing broke.
    expect(asked.status).toBe("running");
  });

  it("does not re-add a path the agent reopens", () => {
    const reopened = foldAll([
      { type: "file-open", path: "a.ts" },
      { type: "file-delta", path: "a.ts", text: "one" },
      { type: "file-close", path: "a.ts" },
      { type: "file-open", path: "a.ts" },
    ]);
    expect(reopened.order).toEqual(["a.ts"]);
    // Reopening starts the file over, matching what the editor should show.
    expect(reopened.drafts["a.ts"]).toBe("");
  });
});
