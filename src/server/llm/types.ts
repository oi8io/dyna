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

export interface WriteFileInput extends PlanInput {
  plan: GenerationPlan;
  /** The one file this call is responsible for. */
  path: string;
  intent: string;
  /** Files already written in this run, path to content. */
  drafts: Record<string, string>;
  onProgress?: (delta: StreamDelta) => void;
  /** Present on a second pass after the build rejected this file. */
  repair?: {
    attempted: string;
    error: string;
  };
}

export interface WriteFileResult {
  file: AgentFile;
  provider: "fake" | "deepseek";
  model: string;
  usage: GenerationUsage;
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

export interface GameGenerationProvider {
  /** Stage one: decide what to do, or ask. Writes no code. */
  plan(input: PlanInput): Promise<PlanResult>;
  /** Stage two, once per planned file. */
  writeFile(input: WriteFileInput): Promise<WriteFileResult>;
  /**
   * A ready-made artifact, when the provider has one and no build is needed.
   * Only demo mode does; live generation always goes through a real build.
   */
  prebuiltArtifactHtml?(input: PlanInput): string | undefined;
}
