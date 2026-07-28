import { beforeEach, describe, expect, it } from "vitest";

import type { GenerationEvent } from "@/lib/generation-events";
import { getRun, resetRegistry, startRun } from "@/server/generation/registry";

beforeEach(() => resetRegistry());

/** Distinct events, so trimming and replay can be checked by identity. */
const fileOpen = (path: string): GenerationEvent => ({
  type: "file-open",
  path,
});

/**
 * The point of the registry is that a run outlives the connection watching it.
 * These cover the three things a reconnect depends on: the run kept going, the
 * events it missed are still there, and it does not receive them twice.
 */
describe("generation registry", () => {
  it("keeps accepting events with nobody watching", () => {
    const { emit } = startRun("job-1");
    emit(fileOpen("a"));
    emit(fileOpen("b"));
    expect(getRun("job-1")?.seq).toBe(2);
  });

  it("replays everything a late subscriber missed", () => {
    const { emit } = startRun("job-1");
    emit(fileOpen("a"));
    emit(fileOpen("b"));

    const replayed = getRun("job-1")?.since(0) ?? [];
    expect(replayed.map((event) => (event as { path: string }).path)).toEqual(
      ["a", "b"],
    );
  });

  it("replays only what comes after the last event the client saw", () => {
    const { emit } = startRun("job-1");
    emit(fileOpen("a"));
    emit(fileOpen("b"));
    emit(fileOpen("c"));

    const resumed = getRun("job-1")?.since(2) ?? [];
    expect(resumed.map((event) => (event as { path: string }).path)).toEqual(
      ["c"],
    );
  });

  it("delivers live events to a subscriber", () => {
    const { emit } = startRun("job-1");
    const seen: number[] = [];
    getRun("job-1")?.subscribe((_event, seq) => seen.push(seq));

    emit(fileOpen("a"));
    emit(fileOpen("b"));
    expect(seen).toEqual([1, 2]);
  });

  it("stops delivering after unsubscribe, without affecting the run", () => {
    const { emit } = startRun("job-1");
    const seen: number[] = [];
    const unsubscribe = getRun("job-1")!.subscribe((_e, seq) => seen.push(seq));

    emit(fileOpen("a"));
    unsubscribe();
    emit(fileOpen("b"));

    expect(seen).toEqual([1]);
    // The run carried on regardless.
    expect(getRun("job-1")?.seq).toBe(2);
  });

  it("does not let one broken subscriber stop the others", () => {
    const { emit } = startRun("job-1");
    const seen: number[] = [];
    getRun("job-1")?.subscribe(() => {
      throw new Error("client went away");
    });
    getRun("job-1")?.subscribe((_e, seq) => seen.push(seq));

    emit(fileOpen("a"));
    emit(fileOpen("b"));
    expect(seen).toEqual([1, 2]);
  });

  it("records a terminal status so a reconnect knows not to wait", () => {
    const { emit } = startRun("job-1");
    emit(fileOpen("a"));
    expect(getRun("job-1")?.status).toBe("running");

    emit({ type: "done", versionNumber: 1, provider: "deepseek" });
    expect(getRun("job-1")?.status).toBe("done");
  });

  it("marks a failed run as finished too", () => {
    const { emit } = startRun("job-1");
    emit({ type: "error", code: "generation_failed" });
    expect(getRun("job-1")?.status).toBe("error");
  });

  it("keeps sequence numbers honest after trimming old history", () => {
    const { emit } = startRun("job-1");
    for (let i = 0; i < 4200; i += 1) emit(fileOpen(String(i)));

    const run = getRun("job-1")!;
    expect(run.seq).toBe(4200);
    // Asking for everything returns only what is retained, not a wrong slice.
    const all = run.since(0);
    expect(all.length).toBeLessThanOrEqual(4000);
    expect((all.at(-1) as { path: string }).path).toBe("4199");
  });

  it("returns nothing for a run that was never started", () => {
    expect(getRun("missing")).toBeUndefined();
  });
});

/**
 * Reopening the builder mid-run attaches with nothing to resume from, and raw
 * replay cannot serve it: history is capped, so by then the plan and the first
 * files are gone. The snapshot is folded as events arrive precisely so that
 * what a late subscriber gets does not depend on how long the run has been
 * going.
 */
describe("snapshot for a subscriber that arrives late", () => {
  it("carries what the raw event window no longer holds", () => {
    const { emit } = startRun("job-1");
    emit({ type: "phase", phase: "planning" });
    emit({
      type: "plan",
      understanding: "a breakout clone",
      changes: [{ path: "src/App.tsx", intent: "shell" }],
      assumptions: ["three lives"],
    });
    emit({ type: "file-open", path: "src/App.tsx" });
    emit({ type: "file-delta", path: "src/App.tsx", text: "export " });

    // Enough deltas to push every event above out of the retained window.
    for (let i = 0; i < 4200; i += 1) {
      emit({ type: "file-delta", path: "src/App.tsx", text: "x" });
    }

    const run = getRun("job-1");
    const oldest = run?.since(0) ?? [];
    // The window really has dropped the plan — otherwise this proves nothing.
    expect(oldest.some((event) => event.type === "plan")).toBe(false);

    const snapshot = run!.snapshot();
    expect(snapshot.understanding).toBe("a breakout clone");
    expect(snapshot.assumptions).toEqual(["three lives"]);
    expect(snapshot.changes).toHaveLength(1);
    expect(snapshot.order).toEqual(["src/App.tsx"]);
    expect(snapshot.activePath).toBe("src/App.tsx");
    // Every delta, including the ones no longer replayable.
    expect(snapshot.drafts["src/App.tsx"]).toBe(`export ${"x".repeat(4200)}`);
  });

  it("accumulates several files independently", () => {
    const { emit } = startRun("job-1");
    emit({ type: "file-open", path: "a.ts" });
    emit({ type: "file-delta", path: "a.ts", text: "one" });
    emit({ type: "file-close", path: "a.ts" });
    emit({ type: "file-open", path: "b.ts" });
    emit({ type: "file-delta", path: "b.ts", text: "two" });

    const snapshot = getRun("job-1")!.snapshot();
    expect(snapshot.order).toEqual(["a.ts", "b.ts"]);
    expect(snapshot.drafts).toEqual({ "a.ts": "one", "b.ts": "two" });
    expect(snapshot.activePath).toBe("b.ts");
  });

  it("records how a finished run ended", () => {
    const { emit } = startRun("done-job");
    emit({ type: "done", versionNumber: 3, provider: "deepseek" });
    const done = getRun("done-job")!.snapshot();
    expect(done.status).toBe("done");
    expect(done.versionNumber).toBe(3);
    expect(done.activePath).toBeUndefined();

    const { emit: emitFailure } = startRun("failed-job");
    emitFailure({ type: "file-open", path: "a.ts" });
    emitFailure({ type: "error", code: "plan_timed_out" });
    const failed = getRun("failed-job")!.snapshot();
    expect(failed.status).toBe("error");
    expect(failed.errorCode).toBe("plan_timed_out");
    // A run that stopped is not still writing a file.
    expect(failed.activePath).toBeUndefined();
  });

  it("keeps the phase, and whether that phase was inherited", () => {
    const { emit } = startRun("job-1");
    emit({ type: "phase", phase: "planning", resumed: true });
    expect(getRun("job-1")!.snapshot().phaseResumed).toBe(true);
    emit({ type: "phase", phase: "writing" });
    const snapshot = getRun("job-1")!.snapshot();
    expect(snapshot.phase).toBe("writing");
    expect(snapshot.phaseResumed).toBe(false);
  });
});
