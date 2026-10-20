/**
 * Types shared by the offline evaluation harness.
 *
 * The harness lives outside `src/` on purpose: it is a development tool, not
 * part of the deployed app, and nothing in `src/` may import from here.
 */

export type EvalKind = "create" | "edit";

/** One row of a dataset file. */
export interface EvalCase {
  id: string;
  kind: EvalKind;
  /** The request under test. */
  prompt: string;
  /**
   * For `edit` cases: the create request that produces the version being
   * edited. Run first, and its result is the previous workspace.
   */
  seedPrompt?: string;
  /**
   * Whether a correct agent should stop and ask instead of building.
   *
   * This is the label for the clarification classifier: an ambiguous request
   * that gets built anyway is a false negative, and a clear request that gets
   * questioned is a false positive that costs the user a round trip.
   */
  expectClarification: boolean;
  /** Free-form tags for slicing the report: genre, language, difficulty. */
  tags: string[];
  /**
   * Substrings that must appear somewhere in the generated source, lowercased
   * before comparison. Use sparingly — this is a spec-compliance smoke test,
   * not a way to pin the model to one implementation.
   */
  mustMention?: string[];
  notes?: string;
}

export interface StageTiming {
  plan: number;
  write: number;
  build: number;
  total: number;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** A hard gate: it either held or it did not, and the run is judged on it. */
export interface GateResult {
  id: string;
  label: string;
  passed: boolean;
  detail?: string;
}

/** A soft craft check derived from the rules GAME_CRAFT asks the model for. */
export interface CraftResult {
  id: string;
  label: string;
  passed: boolean;
  /** Weight in the craft score. Defaults to 1. */
  weight: number;
  detail?: string;
}

export type CaseOutcome =
  | "built"
  | "clarified"
  | "failed";

export interface CaseAttempt {
  caseId: string;
  attempt: number;
  outcome: CaseOutcome;
  /** True when the outcome matches what the dataset expected. */
  correct: boolean;
  /** The stage that ended the run, for failure-attribution histograms. */
  failedStage?: "plan" | "write" | "assemble" | "imports" | "build" | "score";
  errorCode?: string;
  errorDetail?: string;
  /** True when the first build failed and the repair pass rescued it. */
  repaired: boolean;
  gates: GateResult[];
  craft: CraftResult[];
  craftScore: number;
  timings: StageTiming;
  usage: UsageTotals;
  /** Directory under the run folder holding the source and artifact. */
  artifactDir?: string;
}

export interface SuiteSummary {
  cases: number;
  attempts: number;
  /** Attempts whose outcome matched the label. */
  correct: number;
  /** Cases where every attempt matched the label. */
  stableCases: number;
  buildPassRate: number;
  firstPassBuildRate: number;
  clarificationAccuracy: number;
  meanCraftScore: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  totalCostUsd: number;
  gateRates: Record<string, number>;
  craftRates: Record<string, number>;
  failuresByStage: Record<string, number>;
}

export interface RunReport {
  startedAt: string;
  finishedAt: string;
  provider: "fake" | "deepseek";
  model: string;
  dataset: string;
  repeat: number;
  concurrency: number;
  summary: SuiteSummary;
  attempts: CaseAttempt[];
}
