/**
 * Events streamed from `POST /api/projects/[id]/generate` to the builder UI.
 *
 * Shared by client and server, so this module must stay free of `server-only`
 * imports and of anything Node-specific.
 */

export type GenerationPhase =
  | "reserving"
  | "planning"
  | "writing"
  | "building"
  | "repairing"
  | "saving";

export interface PlannedChange {
  path: string;
  intent: string;
}

export interface ClarifyingQuestion {
  question: string;
  options: string[];
}

export type GenerationEvent =
  /**
   * `resumed` marks a stage inherited from an earlier attempt rather than
   * performed now. The label itself lives in the client's dictionary: the run
   * is detached from any request, so it cannot know the reader's language.
   */
  | { type: "phase"; phase: GenerationPhase; resumed?: boolean }
  | {
      type: "plan";
      understanding: string;
      changes: PlannedChange[];
      assumptions: string[];
    }
  /** Terminal: the agent stopped to ask rather than guess. Nothing was built. */
  | {
      type: "question";
      understanding: string;
      questions: ClarifyingQuestion[];
    }
  /** Chain-of-thought is streaming. Progress, even with no answer text yet. */
  | { type: "thinking"; chars: number }
  | { type: "file-open"; path: string }
  | { type: "file-delta"; path: string; text: string }
  | { type: "file-close"; path: string }
  /** Build output. Already redacted, and English by design — it sits beside
   *  compiler output that is English regardless of interface language. */
  | { type: "log"; level: "info" | "error"; message: string }
  | { type: "done"; versionNumber: number; provider: string }
  | { type: "error"; code: string }
  /**
   * Everything so far, folded into one frame.
   *
   * Produced by the stream route, never by a run. A subscriber that arrives
   * partway through cannot be caught up by replaying raw events: history is
   * capped, and file deltas arrive in the thousands, so the oldest — including
   * the plan and the first `file-open` — are long gone by the time anyone
   * reopens the page. This carries the folded result instead, which is what a
   * replay was only ever a means of reconstructing.
   */
  | { type: "snapshot"; state: GenerationSnapshot };

/** The subset a provider can emit while the model is still producing tokens. */
export type StreamDelta = Extract<
  GenerationEvent,
  { type: "thinking" | "file-open" | "file-delta" | "file-close" }
>;

/**
 * A run's progress, independent of how many events it took to get there.
 *
 * The server keeps one of these per run and the client keeps one per stream, so
 * both are built by the same fold below rather than by two switch statements
 * that would drift apart the first time an event type is added.
 */
export interface GenerationSnapshot {
  status: "running" | "done" | "error";
  phase?: GenerationPhase;
  /** The current phase was inherited from an earlier attempt. */
  phaseResumed: boolean;
  /** What the agent understood the request to mean. */
  understanding?: string;
  /** Files the plan said it would touch. */
  changes: PlannedChange[];
  /** Decisions the agent made rather than asking about. */
  assumptions: string[];
  /** Non-empty when the agent stopped to ask instead of guessing. */
  questions: ClarifyingQuestion[];
  /** Chain-of-thought produced so far. Proof of life during a silent stretch. */
  thinkingChars: number;
  /** Paths in the order the agent opened them. */
  order: string[];
  /** Text written so far, keyed by path. */
  drafts: Record<string, string>;
  /** The file currently being written, if any. */
  activePath?: string;
  logs: string[];
  versionNumber?: number;
  provider?: string;
  /** A key into the dictionary's `errors` table, not a sentence. */
  errorCode?: string;
}

export const EMPTY_SNAPSHOT: GenerationSnapshot = {
  status: "running",
  phaseResumed: false,
  changes: [],
  assumptions: [],
  questions: [],
  thinkingChars: 0,
  order: [],
  drafts: {},
  logs: [],
};

/**
 * Applies one event to a snapshot, returning a new one.
 *
 * Immutable so React can use it as a state reducer directly; the server just
 * reassigns. The copies are shallow and the objects small — a handful of file
 * paths — so the cost is nothing against the thousands of deltas that flow
 * through it.
 */
export function foldGenerationEvent(
  state: GenerationSnapshot,
  event: GenerationEvent,
): GenerationSnapshot {
  switch (event.type) {
    case "snapshot":
      // Replaces everything: it *is* the folded history.
      return event.state;
    case "phase":
      return { ...state, phase: event.phase, phaseResumed: event.resumed ?? false };
    case "plan":
      return {
        ...state,
        understanding: event.understanding,
        changes: event.changes,
        assumptions: event.assumptions,
      };
    case "question":
      return {
        ...state,
        understanding: event.understanding,
        questions: event.questions,
        activePath: undefined,
      };
    case "thinking":
      return { ...state, thinkingChars: event.chars };
    case "file-open":
      return {
        ...state,
        activePath: event.path,
        order: state.order.includes(event.path)
          ? state.order
          : [...state.order, event.path],
        drafts: { ...state.drafts, [event.path]: "" },
      };
    case "file-delta":
      return {
        ...state,
        activePath: event.path,
        drafts: {
          ...state.drafts,
          [event.path]: (state.drafts[event.path] ?? "") + event.text,
        },
      };
    case "file-close":
      return { ...state, activePath: undefined };
    case "log":
      return { ...state, logs: [...state.logs, event.message] };
    case "done":
      return {
        ...state,
        status: "done",
        versionNumber: event.versionNumber,
        provider: event.provider,
        activePath: undefined,
      };
    case "error":
      return {
        ...state,
        status: "error",
        errorCode: event.code,
        activePath: undefined,
      };
  }
}
