import type {
  CaseAttempt,
  EvalCase,
  RunReport,
  SuiteSummary,
} from "./types";

function percentile(values: number[], fraction: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(fraction * sorted.length) - 1),
  );
  return sorted[index] ?? 0;
}

function rate(passed: number, total: number) {
  return total ? Number((passed / total).toFixed(4)) : 0;
}

export function summarize(
  cases: EvalCase[],
  attempts: CaseAttempt[],
): SuiteSummary {
  const byId = new Map(cases.map((item) => [item.id, item]));
  const buildable = attempts.filter(
    (attempt) => byId.get(attempt.caseId)?.expectClarification === false,
  );
  const built = attempts.filter((attempt) => attempt.outcome === "built");

  const gateRates: Record<string, number> = {};
  const gateTotals = new Map<string, { passed: number; total: number }>();
  for (const attempt of attempts) {
    for (const gate of attempt.gates) {
      const entry = gateTotals.get(gate.id) ?? { passed: 0, total: 0 };
      entry.total += 1;
      if (gate.passed) entry.passed += 1;
      gateTotals.set(gate.id, entry);
    }
  }
  for (const [id, entry] of gateTotals) {
    gateRates[id] = rate(entry.passed, entry.total);
  }

  const craftRates: Record<string, number> = {};
  const craftTotals = new Map<string, { passed: number; total: number }>();
  for (const attempt of built) {
    for (const probe of attempt.craft) {
      const entry = craftTotals.get(probe.id) ?? { passed: 0, total: 0 };
      entry.total += 1;
      if (probe.passed) entry.passed += 1;
      craftTotals.set(probe.id, entry);
    }
  }
  for (const [id, entry] of craftTotals) {
    craftRates[id] = rate(entry.passed, entry.total);
  }

  const failuresByStage: Record<string, number> = {};
  for (const attempt of attempts) {
    if (attempt.outcome !== "failed") continue;
    const stage = attempt.failedStage ?? "unknown";
    failuresByStage[stage] = (failuresByStage[stage] ?? 0) + 1;
  }

  const perCase = new Map<string, CaseAttempt[]>();
  for (const attempt of attempts) {
    perCase.set(attempt.caseId, [...(perCase.get(attempt.caseId) ?? []), attempt]);
  }
  const stableCases = [...perCase.values()].filter((list) =>
    list.every((attempt) => attempt.correct),
  ).length;

  const latencies = attempts.map((attempt) => attempt.timings.total);

  return {
    cases: perCase.size,
    attempts: attempts.length,
    correct: attempts.filter((attempt) => attempt.correct).length,
    stableCases,
    buildPassRate: rate(
      buildable.filter((attempt) => attempt.outcome === "built").length,
      buildable.length,
    ),
    firstPassBuildRate: rate(
      buildable.filter((attempt) => attempt.outcome === "built" && !attempt.repaired)
        .length,
      buildable.length,
    ),
    clarificationAccuracy: rate(
      attempts.filter(
        (attempt) =>
          (attempt.outcome === "clarified") ===
          Boolean(byId.get(attempt.caseId)?.expectClarification),
      ).length,
      attempts.length,
    ),
    meanCraftScore: built.length
      ? Number(
          (
            built.reduce((sum, attempt) => sum + attempt.craftScore, 0) /
            built.length
          ).toFixed(4),
        )
      : 0,
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    totalCostUsd: Number(
      attempts.reduce((sum, attempt) => sum + attempt.usage.costUsd, 0).toFixed(6),
    ),
    gateRates,
    craftRates,
    failuresByStage,
  };
}

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function ms(value: number) {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`;
}

const OUTCOME_LABEL: Record<string, string> = {
  built: "构建通过",
  clarified: "停下反问",
  failed: "失败",
};

export function renderMarkdown(
  report: RunReport,
  cases: EvalCase[],
  baseline?: RunReport,
): string {
  const { summary } = report;
  const byId = new Map(cases.map((item) => [item.id, item]));
  const lines: string[] = [];

  lines.push(`# 评测报告 — ${report.dataset}`);
  lines.push("");
  lines.push(
    `Provider **${report.provider}** / 模型 \`${report.model}\` · ${report.startedAt} · ${summary.cases} 个用例 × ${report.repeat} 轮 = ${summary.attempts} 次运行`,
  );
  lines.push("");

  if (report.provider === "fake") {
    lines.push(
      "> ⚠️ 这是 **fake** 模式的结果。fake provider 返回固定工程且从不反问，所以「澄清判断准确率」和标注为 ambiguous 的切片必然是红的 —— 这一轮验证的是链路是否跑通，不是模型好不好。要看模型质量请用 `--mode=live`。",
    );
    lines.push("");
  }

  const delta = (current: number, previous: number | undefined, format: (value: number) => string) => {
    if (previous === undefined) return format(current);
    const diff = current - previous;
    if (Math.abs(diff) < 1e-9) return `${format(current)} (=)`;
    const sign = diff > 0 ? "+" : "−";
    return `${format(current)} (${sign}${format(Math.abs(diff))})`;
  };
  const base = baseline?.summary;

  lines.push("## 总览");
  lines.push("");
  lines.push("| 指标 | 值 | 说明 |");
  lines.push("| --- | --- | --- |");
  lines.push(
    `| 判定正确率 | ${delta(rate(summary.correct, summary.attempts), base ? rate(base.correct, base.attempts) : undefined, pct)} | 行为与数据集标注一致的比例 |`,
  );
  lines.push(
    `| 构建通过率 | ${delta(summary.buildPassRate, base?.buildPassRate, pct)} | 仅统计标注为「应当直接开工」的用例 |`,
  );
  lines.push(
    `| 首轮构建通过率 | ${delta(summary.firstPassBuildRate, base?.firstPassBuildRate, pct)} | 未经修复回合即通过 |`,
  );
  lines.push(
    `| 澄清判断准确率 | ${delta(summary.clarificationAccuracy, base?.clarificationAccuracy, pct)} | 该问的问了、不该问的没问 |`,
  );
  lines.push(
    `| 稳定用例 | ${summary.stableCases}/${summary.cases} | 多轮重复中每次都判定正确 |`,
  );
  lines.push(
    `| 平均工艺分 | ${delta(summary.meanCraftScore, base?.meanCraftScore, pct)} | 提示词明确要求过的规则的加权通过率 |`,
  );
  lines.push(`| 时延 P50 / P95 | ${ms(summary.p50LatencyMs)} / ${ms(summary.p95LatencyMs)} | 单次完整运行 |`);
  lines.push(`| 总成本 | $${summary.totalCostUsd.toFixed(4)} | 按 token 实算 |`);
  lines.push("");

  if (Object.keys(summary.failuresByStage).length) {
    lines.push("## 失败归因");
    lines.push("");
    lines.push("| 阶段 | 次数 |");
    lines.push("| --- | --- |");
    for (const [stage, count] of Object.entries(summary.failuresByStage).sort(
      (a, b) => b[1] - a[1],
    )) {
      lines.push(`| ${stage} | ${count} |`);
    }
    lines.push("");
  }

  const craftEntries = Object.entries(summary.craftRates).sort((a, b) => a[1] - b[1]);
  if (craftEntries.length) {
    const labels = new Map(
      report.attempts
        .flatMap((attempt) => attempt.craft)
        .map((probe) => [probe.id, probe.label]),
    );
    lines.push("## 工艺检查（按通过率升序，排在最前的是最该改提示词的地方）");
    lines.push("");
    lines.push("| 检查项 | 通过率 | 基线 |");
    lines.push("| --- | --- | --- |");
    for (const [id, value] of craftEntries) {
      const previous = baseline?.summary.craftRates[id];
      lines.push(
        `| ${labels.get(id) ?? id} | ${pct(value)} | ${previous === undefined ? "—" : pct(previous)} |`,
      );
    }
    lines.push("");
  }

  const tags = new Map<string, { correct: number; total: number }>();
  for (const attempt of report.attempts) {
    for (const tag of byId.get(attempt.caseId)?.tags ?? []) {
      const entry = tags.get(tag) ?? { correct: 0, total: 0 };
      entry.total += 1;
      if (attempt.correct) entry.correct += 1;
      tags.set(tag, entry);
    }
  }
  if (tags.size) {
    lines.push("## 分切片");
    lines.push("");
    lines.push("| 标签 | 判定正确率 | 样本 |");
    lines.push("| --- | --- | --- |");
    for (const [tag, entry] of [...tags].sort(
      (a, b) => rate(a[1].correct, a[1].total) - rate(b[1].correct, b[1].total),
    )) {
      lines.push(`| ${tag} | ${pct(rate(entry.correct, entry.total))} | ${entry.total} |`);
    }
    lines.push("");
  }

  lines.push("## 逐用例");
  lines.push("");
  lines.push("| 用例 | 期望 | 结果 | 工艺分 | 耗时 | 备注 |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  const grouped = new Map<string, CaseAttempt[]>();
  for (const attempt of report.attempts) {
    grouped.set(attempt.caseId, [...(grouped.get(attempt.caseId) ?? []), attempt]);
  }
  for (const [caseId, list] of grouped) {
    const item = byId.get(caseId);
    const expectation = item?.expectClarification ? "反问" : "构建";
    const outcomes = list
      .map((attempt) => `${attempt.correct ? "✅" : "❌"}${OUTCOME_LABEL[attempt.outcome] ?? attempt.outcome}`)
      .join(" · ");
    const scores = list
      .filter((attempt) => attempt.outcome === "built")
      .map((attempt) => pct(attempt.craftScore))
      .join(" · ");
    const worst = list.find((attempt) => !attempt.correct);
    const note = worst?.errorDetail
      ? worst.errorDetail.replace(/\s+/g, " ").slice(0, 110)
      : list.some((attempt) => attempt.repaired)
        ? "经修复回合通过"
        : "";
    lines.push(
      `| \`${caseId}\` | ${expectation} | ${outcomes} | ${scores || "—"} | ${ms(
        Math.round(
          list.reduce((sum, attempt) => sum + attempt.timings.total, 0) / list.length,
        ),
      )} | ${note} |`,
    );
  }
  lines.push("");

  if (baseline) {
    const baseOutcomes = new Map(
      baseline.attempts.map((attempt) => [`${attempt.caseId}#${attempt.attempt}`, attempt]),
    );
    const regressions: string[] = [];
    const fixes: string[] = [];
    for (const attempt of report.attempts) {
      const previous = baseOutcomes.get(`${attempt.caseId}#${attempt.attempt}`);
      if (!previous) continue;
      if (previous.correct && !attempt.correct) {
        regressions.push(`\`${attempt.caseId}\` #${attempt.attempt} — ${attempt.errorDetail ?? attempt.outcome}`);
      }
      if (!previous.correct && attempt.correct) {
        fixes.push(`\`${attempt.caseId}\` #${attempt.attempt}`);
      }
    }
    lines.push("## 与基线对比");
    lines.push("");
    lines.push(`基线：${baseline.startedAt}（${baseline.provider} / \`${baseline.model}\`）`);
    lines.push("");
    lines.push(`- 回归 ${regressions.length} 项${regressions.length ? "：" : ""}`);
    for (const entry of regressions) lines.push(`  - ${entry}`);
    lines.push(`- 修复 ${fixes.length} 项${fixes.length ? "：" : ""}`);
    for (const entry of fixes) lines.push(`  - ${entry}`);
    lines.push("");
  }

  return lines.join("\n");
}

export function renderConsoleSummary(report: RunReport) {
  const { summary } = report;
  return [
    "",
    `  用例 ${summary.cases} × ${report.repeat} 轮 = ${summary.attempts} 次运行`,
    `  判定正确率      ${pct(rate(summary.correct, summary.attempts))}`,
    `  构建通过率      ${pct(summary.buildPassRate)}  (首轮 ${pct(summary.firstPassBuildRate)})`,
    `  澄清判断准确率  ${pct(summary.clarificationAccuracy)}`,
    `  平均工艺分      ${pct(summary.meanCraftScore)}`,
    `  时延 P50 / P95  ${ms(summary.p50LatencyMs)} / ${ms(summary.p95LatencyMs)}`,
    `  总成本          $${summary.totalCostUsd.toFixed(4)}`,
    "",
  ].join("\n");
}
