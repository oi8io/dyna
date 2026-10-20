import type { CraftResult } from "./types";

export interface ScoringInput {
  /** Only what the agent wrote. Template files would pass every check for it. */
  agentFiles: Array<{ path: string; content: string }>;
  artifactHtml: string;
}

interface Probe {
  id: string;
  label: string;
  weight: number;
  /** Returns true when the rule holds, or a string explaining why it does not. */
  check: (context: ScoringContext) => true | string;
}

interface ScoringContext {
  /** Every agent-written file, concatenated. */
  source: string;
  /** Just the TypeScript, for rules that would false-positive on CSS. */
  code: string;
  /** Just the stylesheets. */
  styles: string;
  artifactHtml: string;
}

function has(text: string, pattern: RegExp) {
  return pattern.test(text);
}

/**
 * The craft probes.
 *
 * Every one of these corresponds to a rule the write prompt explicitly asks the
 * model to follow (see `GAME_CRAFT` in `src/server/llm/prompts.ts`). That is the
 * whole basis for scoring them automatically: a probe that fails is a rule the
 * prompt stated and the model ignored, which is exactly the signal a prompt
 * change is trying to move. Probes that would need to judge whether a game is
 * *fun* are deliberately absent — a static checker cannot, and pretending
 * otherwise would produce a number nobody should trust.
 */
const PROBES: Probe[] = [
  {
    id: "raf-loop",
    label: "用 requestAnimationFrame 驱动动画",
    weight: 2,
    check: (context) =>
      has(context.code, /requestAnimationFrame/) ||
      "源码中没有出现 requestAnimationFrame",
  },
  {
    id: "no-interval-gameplay",
    label: "没有用 setInterval 驱动玩法",
    weight: 2,
    check: (context) =>
      !has(context.code, /setInterval\s*\(/) ||
      has(context.code, /requestAnimationFrame/) ||
      "只用 setInterval 推进状态，帧率随机器变化",
  },
  {
    id: "delta-time",
    label: "按经过时间推进状态，而非按帧数",
    weight: 2,
    check: (context) =>
      has(context.code, /\b(dt|delta|deltaTime|elapsed|deltaMs)\b/i) ||
      has(context.code, /performance\.now\(\)/) ||
      "没有任何时间增量的痕迹",
  },
  {
    id: "delta-clamp",
    label: "对时间增量做了钳制（后台标签页返回不瞬移）",
    weight: 1,
    check: (context) =>
      has(
        context.code,
        /Math\.min\s*\([^)]*\b(dt|delta|deltaTime|elapsed|deltaMs)\b/i,
      ) ||
      has(
        context.code,
        /\b(dt|delta|deltaTime|elapsed|deltaMs)\b[^;\n]*Math\.min/i,
      ) ||
      "时间增量没有上限",
  },
  {
    id: "cleanup",
    label: "卸载时取消帧请求并移除监听",
    weight: 2,
    check: (context) => {
      const cancels = has(context.code, /cancelAnimationFrame/);
      const removes = has(context.code, /removeEventListener/);
      if (cancels && removes) return true;
      if (!cancels && !removes) return "既没有 cancelAnimationFrame 也没有 removeEventListener";
      return cancels ? "有 cancelAnimationFrame 但没有 removeEventListener" : "有 removeEventListener 但没有 cancelAnimationFrame";
    },
  },
  {
    id: "prevent-default",
    label: "对使用的按键调用 preventDefault",
    weight: 1,
    check: (context) =>
      has(context.code, /preventDefault\s*\(/) ||
      "方向键和空格会把页面滚走",
  },
  {
    id: "no-modal-dialogs",
    label: "没有使用 alert / confirm / prompt",
    weight: 2,
    check: (context) =>
      !has(context.code, /(?:^|[^.\w])(?:window\.)?(?:alert|confirm)\s*\(/m) &&
      !has(context.code, /window\.prompt\s*\(/) ||
      "用了会冻结循环的模态对话框",
  },
  {
    id: "game-over-state",
    label: "有明确的结束状态",
    weight: 1,
    check: (context) =>
      has(context.source, /game\s*over|gameover|isover|游戏结束|结束画面|你输了|失败/i) ||
      "看不到任何结束状态",
  },
  {
    id: "restart",
    label: "可以一键重开",
    weight: 1,
    check: (context) =>
      has(context.source, /restart|replay|再来一局|重新开始|重开|重来/i) ||
      "没有重开入口，玩一次就得刷新",
  },
  {
    id: "hud",
    label: "界面上有实时状态显示",
    weight: 1,
    check: (context) =>
      has(context.source, /score|lives|分数|得分|生命|关卡|level/i) ||
      "玩家追踪的数值没有显示出来",
  },
  {
    id: "controls-hint",
    label: "首屏说明了操作方式",
    weight: 1,
    check: (context) =>
      has(
        context.source,
        /方向键|←|→|空格|按\s*[a-z]\s*键|arrow key|space|wasd|click to|点击开始/i,
      ) || "没有告诉玩家该按什么",
  },
  {
    id: "responsive-layout",
    label: "用相对单位布局，适配任意尺寸",
    weight: 1,
    check: (context) =>
      // `%` is only meaningful in the stylesheet; in code it is the modulo
      // operator, which every game uses and which proves nothing.
      has(context.styles, /(?:vmin|vmax|vh|vw)\b|clamp\s*\(|\d\s*%/) ||
      has(context.code, /(?:vmin|vmax|vh|vw)\b|clamp\s*\(/) ||
      "全是绝对尺寸，换个容器就溢出",
  },
  {
    id: "no-fixed-playfield",
    label: "没有给容器写死大尺寸像素值",
    weight: 1,
    check: (context) => {
      const match = context.styles.match(
        /(?:^|[\s;{])(?:min-|max-)?(?:width|height)\s*:\s*([3-9]\d{2}|\d{4,})px/m,
      );
      return match ? `样式里写死了 ${match[0].trim()}` : true;
    },
  },
  {
    id: "no-network",
    label: "没有发起网络请求",
    weight: 1,
    check: (context) =>
      !has(context.code, /\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|EventSource/) ||
      "调用了被 CSP 禁止的网络 API",
  },
  {
    id: "no-remote-assets",
    label: "没有引用远程资源",
    weight: 1,
    check: (context) =>
      !has(context.source, /https?:\/\/(?!www\.w3\.org)/) ||
      "引用了远程 URL，产物会被安全校验拦下",
  },
  {
    id: "no-storage",
    label: "没有使用被禁止的存储 API",
    weight: 1,
    check: (context) =>
      !has(context.code, /localStorage|sessionStorage|indexedDB|document\.cookie/) ||
      "用了沙箱里不可用的存储",
  },
  {
    id: "typed",
    label: "没有用 any 逃逸类型系统",
    weight: 1,
    check: (context) =>
      !has(context.code, /:\s*any\b|\bas\s+any\b/) || "出现了 any",
  },
];

export function scoreCraft(input: ScoringInput): CraftResult[] {
  const pick = (test: (path: string) => boolean) =>
    input.agentFiles
      .filter((file) => test(file.path))
      .map((file) => file.content)
      .join("\n");

  const context: ScoringContext = {
    source: input.agentFiles.map((file) => file.content).join("\n"),
    code: pick((path) => /\.(ts|tsx|js|jsx)$/.test(path)),
    styles: pick((path) => path.endsWith(".css")),
    artifactHtml: input.artifactHtml,
  };

  return PROBES.map((probe) => {
    let outcome: true | string;
    try {
      outcome = probe.check(context);
    } catch (error) {
      outcome = `判分器异常：${error instanceof Error ? error.message : String(error)}`;
    }
    return {
      id: probe.id,
      label: probe.label,
      weight: probe.weight,
      passed: outcome === true,
      detail: outcome === true ? undefined : outcome,
    };
  });
}

/** Weighted pass fraction, 0..1. */
export function craftScore(results: CraftResult[]) {
  const total = results.reduce((sum, item) => sum + item.weight, 0);
  if (!total) return 0;
  const earned = results.reduce(
    (sum, item) => sum + (item.passed ? item.weight : 0),
    0,
  );
  return Number((earned / total).toFixed(4));
}

/** Case-level spec compliance: every required substring appears somewhere. */
export function checkMustMention(
  input: ScoringInput,
  mustMention: string[] | undefined,
) {
  if (!mustMention?.length) return { passed: true as const, missing: [] };
  const haystack = input.agentFiles
    .map((file) => file.content)
    .join("\n")
    .toLowerCase();
  const missing = mustMention.filter(
    (needle) => !haystack.includes(needle.toLowerCase()),
  );
  return { passed: missing.length === 0, missing };
}

export const PROBE_IDS = PROBES.map((probe) => probe.id);
