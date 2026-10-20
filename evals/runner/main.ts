import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { getServerEnv } from "@/server/env";
import { DeepSeekGameProvider } from "@/server/llm/deepseek-provider";
import { FakeGameProvider } from "@/server/llm/fake-provider";
import type { GameGenerationProvider } from "@/server/llm/types";
import type { GeneratedWorkspace } from "@/server/workspace/schema";

import { filterCases, loadDataset } from "./dataset";
import { runPipeline, type PipelineResult } from "./pipeline";
import { renderConsoleSummary, renderMarkdown, summarize } from "./report";
import { checkMustMention, craftScore, scoreCraft } from "./scorers";
import type {
  CaseAttempt,
  EvalCase,
  GateResult,
  RunReport,
  UsageTotals,
} from "./types";

interface Options {
  dataset: string;
  filters: string[];
  repeat: number;
  concurrency: number;
  mode: "fake" | "live";
  out: string;
  baseline?: string;
  limit?: number;
  keepArtifacts: boolean;
  failUnder?: number;
  priceIn: number;
  priceOut: number;
  planTimeoutMs: number;
  writeTimeoutMs: number;
}

const DEFAULTS: Options = {
  dataset: "evals/datasets/games.v1.jsonl",
  filters: [],
  repeat: 1,
  concurrency: 2,
  mode: "fake",
  out: "evals/results",
  keepArtifacts: false,
  // DeepSeek list prices per million tokens at the time of writing. They are
  // flags rather than constants because the point of the number is comparing
  // two runs, and a stale hard-coded price makes that comparison silently wrong.
  priceIn: 0.28,
  priceOut: 0.42,
  planTimeoutMs: 180_000,
  writeTimeoutMs: 240_000,
};

function parseArgs(argv: string[]): Options {
  const options: Options = { ...DEFAULTS };
  for (const arg of argv) {
    const [rawKey, rawValue] = arg.replace(/^--/, "").split("=");
    const value = rawValue ?? "true";
    switch (rawKey) {
      case "dataset":
        options.dataset = value;
        break;
      case "filter":
        options.filters.push(...value.split(",").filter(Boolean));
        break;
      case "repeat":
        options.repeat = Math.max(1, Number(value));
        break;
      case "concurrency":
        options.concurrency = Math.max(1, Number(value));
        break;
      case "mode":
        if (value !== "fake" && value !== "live") {
          throw new Error("--mode must be fake or live");
        }
        options.mode = value;
        break;
      case "out":
        options.out = value;
        break;
      case "baseline":
        options.baseline = value;
        break;
      case "limit":
        options.limit = Number(value);
        break;
      case "keep-artifacts":
        options.keepArtifacts = value !== "false";
        break;
      case "fail-under":
        options.failUnder = Number(value);
        break;
      case "price-in":
        options.priceIn = Number(value);
        break;
      case "price-out":
        options.priceOut = Number(value);
        break;
      case "plan-timeout-ms":
        options.planTimeoutMs = Number(value);
        break;
      case "write-timeout-ms":
        options.writeTimeoutMs = Number(value);
        break;
      case "help":
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown flag: --${rawKey}`);
    }
  }
  return options;
}

function printHelp() {
  process.stdout.write(
    [
      "",
      "  离线评测：node evals/run.mjs [flags]",
      "",
      "  --mode=fake|live         默认 fake，零成本跑通全链路",
      "  --dataset=<path>         JSONL 数据集（默认 evals/datasets/games.v1.jsonl）",
      "  --filter=<id|tag>[,...]  只跑匹配的用例，可重复传",
      "  --repeat=<n>             每个用例跑 n 轮，用于看稳定性",
      "  --concurrency=<n>        并发数（默认 2）",
      "  --baseline=<report.json> 与上一次结果对比，输出回归/修复清单",
      "  --fail-under=<0-1>       构建通过率低于阈值时以非零码退出（CI 用）",
      "  --keep-artifacts         保留所有产物，而不只是失败用例的",
      "  --price-in / --price-out 每百万 token 单价，用于折算成本",
      "",
    ].join("\n"),
  );
}

function providerFor(mode: "fake" | "live"): {
  provider: GameGenerationProvider;
  name: "fake" | "deepseek";
  model: string;
} {
  if (mode === "live") {
    // `getServerEnv` parses on first call, not on import, so a fake run never
    // pays for live-only variables it does not have.
    return {
      provider: new DeepSeekGameProvider(),
      name: "deepseek",
      model: getServerEnv().DEEPSEEK_MODEL,
    };
  }
  return { provider: new FakeGameProvider(), name: "fake", model: "fake" };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index] as T, index);
    }
  });
  await Promise.all(runners);
  return results;
}

function gate(id: string, label: string, passed: boolean, detail?: string): GateResult {
  return { id, label, passed, detail };
}

function addUsage(a: UsageTotals, b: UsageTotals): UsageTotals {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costUsd: Number((a.costUsd + b.costUsd).toFixed(6)),
  };
}

async function evaluateOnce(
  item: EvalCase,
  attempt: number,
  provider: GameGenerationProvider,
  options: Options,
  runDir: string,
): Promise<CaseAttempt> {
  const pipelineOptions = {
    provider,
    price: { input: options.priceIn, output: options.priceOut },
    planTimeoutMs: options.planTimeoutMs,
    writeTimeoutMs: options.writeTimeoutMs,
    usePrebuiltArtifact: false,
  };

  let usage: UsageTotals = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  let previousWorkspace: GeneratedWorkspace | undefined;
  const title = item.prompt.replace(/\s+/g, " ").slice(0, 30) || item.id;

  // An edit needs something to edit. The seed runs through the same pipeline,
  // so an edit case that fails at the seed is reported as a seed failure rather
  // than being silently scored as an edit the model never got to attempt.
  if (item.kind === "edit" && item.seedPrompt) {
    const seed = await runPipeline(
      {
        kind: "create",
        prompt: item.seedPrompt,
        originalPrompt: item.seedPrompt,
        title,
      },
      pipelineOptions,
    );
    usage = addUsage(usage, seed.usage);
    if (seed.status !== "built") {
      return {
        caseId: item.id,
        attempt,
        outcome: "failed",
        correct: false,
        failedStage: seed.status === "failed" ? seed.stage : "plan",
        errorCode: "seed_failed",
        errorDetail: `seed: ${seed.status === "failed" ? seed.detail : "seed 请求被反问，无法构造被编辑的版本"}`,
        repaired: false,
        gates: [gate("seed", "edit 用例的种子版本可构建", false)],
        craft: [],
        craftScore: 0,
        timings: seed.timings,
        usage,
        };
    }
    previousWorkspace = seed.workspace;
  }

  const result: PipelineResult = await runPipeline(
    {
      kind: item.kind,
      prompt: item.prompt,
      originalPrompt: item.seedPrompt ?? item.prompt,
      previousWorkspace,
      title,
    },
    pipelineOptions,
  );
  usage = addUsage(usage, result.usage);

  const clarified = result.status === "clarified";
  const gates: GateResult[] = [
    gate(
      "clarification",
      "该问的问了、不该问的没问",
      clarified === item.expectClarification,
      clarified
        ? "停下反问"
        : result.status === "built"
          ? "直接开工"
          : "运行失败",
    ),
  ];

  if (result.status === "clarified") {
    return {
      caseId: item.id,
      attempt,
      outcome: "clarified",
      correct: item.expectClarification,
      errorCode: item.expectClarification ? undefined : "unexpected_clarification",
      errorDetail: item.expectClarification
        ? undefined
        : `本应直接开工，却反问：${result.questions.map((q) => q.question).join(" / ")}`,
      repaired: false,
      gates,
      craft: [],
      craftScore: 0,
      timings: result.timings,
      usage,
    };
  }

  if (result.status === "failed") {
    return {
      caseId: item.id,
      attempt,
      outcome: "failed",
      correct: false,
      failedStage: result.stage,
      errorCode: `${result.stage}_failed`,
      errorDetail: result.detail,
      repaired: result.repaired,
      gates: [
        ...gates,
        gate("built", "构建出可运行产物", false, result.detail.slice(0, 200)),
      ],
      craft: [],
      craftScore: 0,
      timings: result.timings,
      usage,
    };
  }

  const scoring = {
    agentFiles: result.agentFiles,
    artifactHtml: result.artifactHtml,
  };
  const craft = scoreCraft(scoring);
  const mention = checkMustMention(scoring, item.mustMention);

  gates.push(
    gate("built", "构建出可运行产物", true),
    gate("first-pass", "首轮即通过，未动用修复回合", !result.repaired),
    gate(
      "must-mention",
      "覆盖了用例点名要求的内容",
      mention.passed,
      mention.missing.length ? `缺少：${mention.missing.join("、")}` : undefined,
    ),
  );

  const correct = !item.expectClarification && mention.passed;
  const failure = item.expectClarification
    ? {
        code: "missed_clarification",
        detail: "本应停下反问，却直接开工了",
      }
    : mention.passed
      ? undefined
      : {
          code: "must_mention_missing",
          detail: `生成的源码里没有出现：${mention.missing.join("、")}`,
        };
  const attemptDir = path.join(runDir, "cases", item.id, `attempt-${attempt}`);
  const keep = options.keepArtifacts || !correct || attempt === 1;
  if (keep) {
    await mkdir(attemptDir, { recursive: true });
    await Promise.all([
      ...result.workspace.files.map(async (file) => {
        const destination = path.join(attemptDir, "workspace", file.path);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, file.content, "utf8");
      }),
      writeFile(path.join(attemptDir, "artifact.html"), result.artifactHtml, "utf8"),
    ]);
  }

  return {
    caseId: item.id,
    attempt,
    outcome: "built",
    correct,
    errorCode: failure?.code,
    errorDetail: failure?.detail,
    repaired: result.repaired,
    gates,
    craft,
    craftScore: craftScore(craft),
    timings: result.timings,
    usage,
    artifactDir: keep ? path.relative(runDir, attemptDir) : undefined,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const all = await loadDataset(options.dataset);
  let cases = filterCases(all, options.filters);
  if (options.limit) cases = cases.slice(0, options.limit);
  if (!cases.length) throw new Error("过滤条件没有匹配到任何用例");

  const { provider, name, model } = providerFor(options.mode);
  const startedAt = new Date();
  const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
  const runDir = path.join(options.out, `${stamp}-${name}`);
  await mkdir(runDir, { recursive: true });

  const jobs = cases.flatMap((item) =>
    Array.from({ length: options.repeat }, (_, index) => ({
      item,
      attempt: index + 1,
    })),
  );

  process.stderr.write(
    `\n  ${options.mode} 模式 · ${cases.length} 用例 × ${options.repeat} 轮 · 并发 ${options.concurrency}\n\n`,
  );

  let done = 0;
  const attempts = await mapWithConcurrency(jobs, options.concurrency, async (job) => {
    const attempt = await evaluateOnce(
      job.item,
      job.attempt,
      provider,
      options,
      runDir,
    ).catch(
      (error: unknown): CaseAttempt => ({
        caseId: job.item.id,
        attempt: job.attempt,
        outcome: "failed",
        correct: false,
        failedStage: "score",
        errorCode: "harness_error",
        errorDetail: error instanceof Error ? error.message : String(error),
        repaired: false,
        gates: [],
        craft: [],
        craftScore: 0,
        timings: { plan: 0, write: 0, build: 0, total: 0 },
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      }),
    );
    done += 1;
    process.stderr.write(
      `  [${String(done).padStart(3)}/${jobs.length}] ${attempt.correct ? "✅" : "❌"} ${job.item.id}#${job.attempt} · ${attempt.outcome}${
        attempt.errorDetail ? ` · ${attempt.errorDetail.replace(/\s+/g, " ").slice(0, 80)}` : ""
      }\n`,
    );
    return attempt;
  });

  const report: RunReport = {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    provider: name,
    model,
    dataset: options.dataset,
    repeat: options.repeat,
    concurrency: options.concurrency,
    summary: summarize(cases, attempts),
    attempts,
  };

  let baseline: RunReport | undefined;
  if (options.baseline) {
    baseline = JSON.parse(await readFile(options.baseline, "utf8")) as RunReport;
  }

  await Promise.all([
    writeFile(
      path.join(runDir, "report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(runDir, "report.md"),
      `${renderMarkdown(report, cases, baseline)}\n`,
      "utf8",
    ),
  ]);

  process.stderr.write(renderConsoleSummary(report));
  process.stderr.write(`  报告：${path.join(runDir, "report.md")}\n\n`);

  if (options.failUnder !== undefined && report.summary.buildPassRate < options.failUnder) {
    process.stderr.write(
      `  构建通过率 ${report.summary.buildPassRate} 低于阈值 ${options.failUnder}\n\n`,
    );
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`\n  评测失败：${error instanceof Error ? error.stack : String(error)}\n\n`);
  process.exitCode = 1;
});
