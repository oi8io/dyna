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
  | { type: "error"; code: string };

/** The subset a provider can emit while the model is still producing tokens. */
export type StreamDelta = Extract<
  GenerationEvent,
  { type: "thinking" | "file-open" | "file-delta" | "file-close" }
>;
