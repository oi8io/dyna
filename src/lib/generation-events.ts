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
  | { type: "phase"; phase: GenerationPhase; message: string }
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
  | { type: "log"; level: "info" | "error"; message: string }
  | { type: "done"; versionNumber: number; provider: string }
  | { type: "error"; message: string };

/** The subset a provider can emit while the model is still producing tokens. */
export type StreamDelta = Extract<
  GenerationEvent,
  { type: "thinking" | "file-open" | "file-delta" | "file-close" }
>;

export const PHASE_LABELS: Record<GenerationPhase, string> = {
  reserving: "正在确认额度",
  planning: "正在理解需求",
  writing: "正在写代码",
  building: "正在打包",
  repairing: "出了点问题，正在修",
  saving: "正在保存",
};
