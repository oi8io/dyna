import type { StreamDelta } from "@/lib/generation-events";
import type { GenerationPlan } from "@/server/llm/plan";
import type { AgentFile, GeneratedWorkspace } from "@/server/workspace/schema";

export type GenerationKind = "create" | "edit";

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Everything the agent needs to understand the request.
 *
 * `prompt` alone is not enough: without the original brief, the recorded intent
 * and the turns leading up to this one, "make it faster" has no referent.
 */
export interface PlanInput {
  kind: GenerationKind;
  prompt: string;
  /** The brief the project started from. */
  originalPrompt: string;
  /** Rendered SPEC.md from the previous version, if any. */
  specMarkdown?: string;
  /** Recent turns, oldest first. */
  history: ConversationTurn[];
  previousWorkspace?: GeneratedWorkspace;
  /**
   * Upper bound for this single call, in milliseconds.
   *
   * The route runs several model calls inside one serverless invocation that
   * the platform kills at a fixed wall clock. Each stage is capped by whatever
   * is left of that budget, not by the per-call timeout alone.
   */
  timeoutMs?: number;
}

export interface BuildInput extends PlanInput {
  plan: GenerationPlan;
  onProgress?: (delta: StreamDelta) => void;
  /** Present on a second pass after the build rejected the first attempt. */
  repair?: {
    attemptedFiles: AgentFile[];
    error: string;
  };
}

export interface GenerationUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export interface PlanResult {
  plan: GenerationPlan;
  provider: "fake" | "deepseek";
  model: string;
  usage: GenerationUsage;
}

export interface GenerateGameResult {
  /** Already merged with the previous version's untouched files. */
  workspace: GeneratedWorkspace;
  /** Only the paths this turn actually rewrote. */
  changedPaths: string[];
  prebuiltArtifactHtml?: string;
  provider: "fake" | "deepseek";
  model: string;
  usage: GenerationUsage;
}

export interface GameGenerationProvider {
  /** Stage one: decide what to do, or ask. Writes no code. */
  plan(input: PlanInput): Promise<PlanResult>;
  /** Stage two: implement the agreed plan. */
  generate(input: BuildInput): Promise<GenerateGameResult>;
}
