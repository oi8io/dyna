import {
  EMPTY_SNAPSHOT,
  type GenerationEvent,
  type GenerationSnapshot,
  foldGenerationEvent,
} from "@/lib/generation-events";

/**
 * In-process registry of running generations.
 *
 * A generation used to live inside the HTTP request that started it: closing
 * the tab cancelled the stream and took the work with it, and there was no way
 * to reattach because the events had only ever been pushed down that one
 * connection.
 *
 * Here the run owns its own lifetime and connections come and go. A subscriber
 * that arrives late — or returns after a dropped connection — is handed a
 * snapshot of everything so far and then continues live.
 *
 * The snapshot is folded as events arrive rather than reconstructed from the
 * retained ones. History is capped, so a page reopened partway through a run
 * would otherwise be caught up from a window that no longer contains the plan
 * or the first files — the very things it needs.
 *
 * Single-process by design. Two replicas would each hold their own registry and
 * a reconnect could land on the wrong one, so the deployment runs one instance;
 * a restart loses in-flight runs, which `reap_stale_generations` settles.
 */

type Subscriber = (event: GenerationEvent, seq: number) => void;

/** Kept after finishing so a reconnect can still read the terminal state. */
const RETAIN_AFTER_FINISH_MS = 5 * 60_000;
/**
 * Cap on retained history. File deltas arrive in the thousands; keeping every
 * one would grow without bound, and a replay only needs enough to rebuild the
 * editor, which the accumulated deltas already provide.
 */
const MAX_RETAINED_EVENTS = 4000;

class Run {
  readonly events: GenerationEvent[] = [];
  snapshot: GenerationSnapshot = EMPTY_SNAPSHOT;
  seq = 0;
  private readonly subscribers = new Set<Subscriber>();
  private evictAt?: ReturnType<typeof setTimeout>;

  get status() {
    return this.snapshot.status;
  }

  emit(event: GenerationEvent) {
    this.seq += 1;
    this.events.push(event);
    if (this.events.length > MAX_RETAINED_EVENTS) {
      this.events.splice(0, this.events.length - MAX_RETAINED_EVENTS);
    }
    this.snapshot = foldGenerationEvent(this.snapshot, event);

    for (const subscriber of this.subscribers) {
      // One failing subscriber must not stop the others, or the run itself.
      try {
        subscriber(event, this.seq);
      } catch {
        this.subscribers.delete(subscriber);
      }
    }
  }

  subscribe(subscriber: Subscriber) {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  /** Everything after `afterSeq`, so a reconnect does not replay what it saw. */
  since(afterSeq: number) {
    const dropped = this.seq - this.events.length;
    const from = Math.max(0, afterSeq - dropped);
    return this.events.slice(from);
  }

  scheduleEviction(onEvict: () => void) {
    clearTimeout(this.evictAt);
    this.evictAt = setTimeout(onEvict, RETAIN_AFTER_FINISH_MS);
    // Never hold the process open just to expire a finished run.
    this.evictAt.unref?.();
  }
}

const runs = new Map<string, Run>();

export function startRun(jobId: string) {
  const run = new Run();
  runs.set(jobId, run);
  return {
    emit: (event: GenerationEvent) => {
      run.emit(event);
      if (event.type === "done" || event.type === "error") {
        run.scheduleEviction(() => runs.delete(jobId));
      }
    },
  };
}

export function getRun(jobId: string) {
  const run = runs.get(jobId);
  if (!run) return undefined;
  return {
    status: run.status,
    seq: run.seq,
    /** Everything so far, for a subscriber with nothing to resume from. */
    snapshot: () => run.snapshot,
    since: (afterSeq: number) => run.since(afterSeq),
    subscribe: (subscriber: Subscriber) => run.subscribe(subscriber),
  };
}

/** Test seam. Production never needs to forget a run early. */
export function resetRegistry() {
  runs.clear();
}
