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
