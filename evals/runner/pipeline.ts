import { buildWorkspaceLocally } from "@/server/build/local-esbuild";
import {
  describeUnresolvedImports,
  findUnresolvedImports,
  isRepairableByAgent,
} from "@/server/build/imports";
import { generationPlanSchema, planNeedsClarification } from "@/server/llm/plan";
import { SPEC_PATH, renderSpecMarkdown } from "@/server/llm/spec";
import type {
  GameGenerationProvider,
  GenerationKind,
  PlanInput,
} from "@/server/llm/types";
import { createGameWorkspace } from "@/server/template/game-template";
import type { AgentFile, GeneratedWorkspace } from "@/server/workspace/schema";
import {
  extractAgentFiles,
  mergeAgentFiles,
  validateAgentFiles,
} from "@/server/workspace/schema";

import type { StageTiming, UsageTotals } from "./types";

/**
 * The generation pipeline, minus everything that needs a server.
 *
 * `executeGeneration` in `src/server/generation/run.ts` is the production path,
 * and it takes a Supabase client, writes checkpoints, reserves credit and emits
 * SSE. None of that is what an eval measures, and all of it would make the
 * harness need a database. What is reproduced here is the part under test: the
 * same provider, the same plan schema, the same clarification rule, the same
 * whitelist, the same import check, the same builder and the same artifact
 * validation, in the same order.
 *
 * The duplication is deliberate and bounded: every step below calls the real
 * module rather than reimplementing it, so the only thing this file owns is the
 * ordering — and if the ordering in `run.ts` changes, the eval should be
 * updated to match rather than silently keep measuring the old shape.
 */

export interface PricePerMillionTokens {
  input: number;
  output: number;
}

export interface PipelineOptions {
  provider: GameGenerationProvider;
  price: PricePerMillionTokens;
  planTimeoutMs: number;
  writeTimeoutMs: number;
  /**
   * Demo mode can hand back a canned artifact and skip the bundler. An eval
   * wants the build exercised, so the harness ignores it by default.
   */
  usePrebuiltArtifact: boolean;
}

export interface PipelineRequest {
  kind: GenerationKind;
  prompt: string;
  originalPrompt: string;
  previousWorkspace?: GeneratedWorkspace;
  title: string;
}

export type PipelineResult =
  | {
      status: "clarified";
      questions: Array<{ question: string; options: string[] }>;
      understanding: string;
      timings: StageTiming;
      usage: UsageTotals;
    }
  | {
      status: "built";
      workspace: GeneratedWorkspace;
      agentFiles: AgentFile[];
      artifactHtml: string;
      repaired: boolean;
      timings: StageTiming;
      usage: UsageTotals;
    }
  | {
      status: "failed";
      stage: "plan" | "write" | "assemble" | "imports" | "build";
      detail: string;
      repaired: boolean;
      timings: StageTiming;
      usage: UsageTotals;
    };

const ZERO_USAGE: UsageTotals = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

function detail(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function runPipeline(
  request: PipelineRequest,
  options: PipelineOptions,
): Promise<PipelineResult> {
  const startedAt = Date.now();
  const timings: StageTiming = { plan: 0, write: 0, build: 0, total: 0 };
  const usage: UsageTotals = { ...ZERO_USAGE };
  let repaired = false;

  const account = (tokens: { inputTokens: number; outputTokens: number }) => {
    usage.inputTokens += tokens.inputTokens;
    usage.outputTokens += tokens.outputTokens;
    // Cost is recomputed from tokens rather than taken from the provider's
    // own estimate, which is a constant placeholder in the app.
    usage.costUsd = Number(
      (
        (usage.inputTokens / 1_000_000) * options.price.input +
        (usage.outputTokens / 1_000_000) * options.price.output
      ).toFixed(6),
    );
  };
  const finish = <T extends PipelineResult>(result: T): T => {
    timings.total = Date.now() - startedAt;
    return result;
  };

  const input: PlanInput = {
    kind: request.kind,
    prompt: request.prompt,
    originalPrompt: request.originalPrompt,
    specMarkdown: request.previousWorkspace
      ? request.previousWorkspace.files.find((file) => file.path === SPEC_PATH)
          ?.content
      : undefined,
    history: [],
    previousWorkspace: request.previousWorkspace,
    timeoutMs: options.planTimeoutMs,
  };

  // ---- Stage one: understand, or ask ------------------------------------
  const planStartedAt = Date.now();
  let plan;
  try {
    const planned = await options.provider.plan(input);
    account(planned.usage);
    plan = generationPlanSchema.parse(planned.plan);
  } catch (error) {
    timings.plan = Date.now() - planStartedAt;
    return finish({
      status: "failed",
      stage: "plan",
      detail: detail(error),
      repaired,
      timings,
      usage,
    });
  }
  timings.plan = Date.now() - planStartedAt;

  if (planNeedsClarification(plan)) {
    return finish({
      status: "clarified",
      questions: plan.questions,
      understanding: plan.understanding,
      timings,
      usage,
    });
  }

  if (!plan.changes.length) {
    return finish({
      status: "failed",
      stage: "plan",
      detail: "plan_named_no_files",
      repaired,
      timings,
      usage,
    });
  }

  // ---- Stage two: write every planned file in one pass -------------------
  const writeStartedAt = Date.now();
  let changed: AgentFile[];
  try {
    const written = await options.provider.write({
      ...input,
      plan,
      timeoutMs: options.writeTimeoutMs,
    });
    account(written.usage);
    changed = validateAgentFiles(written.files) as AgentFile[];
  } catch (error) {
    timings.write = Date.now() - writeStartedAt;
    return finish({
      status: "failed",
      stage: "write",
      detail: detail(error),
      repaired,
      timings,
      usage,
    });
  }
  timings.write = Date.now() - writeStartedAt;

  // ---- Assemble on top of the locked template ---------------------------
  const previousAgentFiles = request.previousWorkspace
    ? extractAgentFiles(request.previousWorkspace)
    : [];
  const specContent = plan.spec
    ? renderSpecMarkdown(plan.spec, [])
    : input.specMarkdown;

  const assemble = (files: AgentFile[]): GeneratedWorkspace => {
    const merged = mergeAgentFiles(previousAgentFiles, files);
    const workspace = createGameWorkspace({
      title: request.title,
      summary: plan.changeSummary,
      agentFiles: merged,
    });
    return {
      ...workspace,
      files: [
        ...workspace.files.filter((file) => file.path !== SPEC_PATH),
        ...(specContent ? [{ path: SPEC_PATH, content: specContent }] : []),
      ],
    };
  };

  let workspace: GeneratedWorkspace;
  try {
    workspace = assemble(changed);
  } catch (error) {
    return finish({
      status: "failed",
      stage: "assemble",
      detail: detail(error),
      repaired,
      timings,
      usage,
    });
  }

  // ---- Build, with the one repair pass production also allows -----------
  const prebuilt = options.usePrebuiltArtifact
    ? options.provider.prebuiltArtifactHtml?.(input)
    : undefined;

  const buildStartedAt = Date.now();
  const compile = async (candidate: GeneratedWorkspace) => {
    const unresolved = findUnresolvedImports(candidate);
    if (unresolved.length) {
      throw new Error(`import_unresolved: ${describeUnresolvedImports(unresolved)}`);
    }
    if (prebuilt) {
      const { validateStandaloneHtml } = await import("@/server/build/validation");
      validateStandaloneHtml(prebuilt);
      return { artifactHtml: prebuilt };
    }
    return buildWorkspaceLocally(candidate);
  };

  let artifactHtml: string;
  try {
    artifactHtml = (await compile(workspace)).artifactHtml;
  } catch (firstError) {
    const firstDetail = detail(firstError);
    const paths = changed.map((file) => file.path);
    if (!isRepairableByAgent(firstDetail, paths)) {
      timings.build = Date.now() - buildStartedAt;
      return finish({
        status: "failed",
        stage: firstDetail.startsWith("import_unresolved") ? "imports" : "build",
        detail: firstDetail,
        repaired,
        timings,
        usage,
      });
    }

    repaired = true;
    try {
      const fixed = await options.provider.write({
        ...input,
        plan,
        timeoutMs: options.writeTimeoutMs,
        repair: { attempted: changed, error: firstDetail },
      });
      account(fixed.usage);
      workspace = assemble(validateAgentFiles(fixed.files) as AgentFile[]);
      artifactHtml = (await compile(workspace)).artifactHtml;
    } catch (repairError) {
      timings.build = Date.now() - buildStartedAt;
      return finish({
        status: "failed",
        stage: "build",
        detail: `repair failed after: ${firstDetail}\n---\n${detail(repairError)}`,
        repaired,
        timings,
        usage,
      });
    }
  }
  timings.build = Date.now() - buildStartedAt;

  return finish({
    status: "built",
    workspace,
    agentFiles: extractAgentFiles(workspace),
    artifactHtml,
    repaired,
    timings,
    usage,
  });
}
