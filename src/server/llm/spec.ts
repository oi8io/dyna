import { z } from "zod";

import type { GeneratedWorkspace } from "@/server/workspace/schema";

/**
 * The intent spec that travels with a project.
 *
 * Source code records *what the project does*; this records *what it is meant
 * to do and why*. Without it every edit re-derives intent from the code alone,
 * so any decision that is not visible in the source — "three lives because it
 * should feel forgiving" — is lost the next time the agent touches the file.
 *
 * Deliberately intent-only. Directory trees, file inventories and tech stacks
 * are mechanically derivable and go stale the moment someone forgets to update
 * them, at which point they mislead rather than inform.
 */

export const SPEC_PATH = "SPEC.md";

const CHANGELOG_HEADING = "## 改动记录";

export const projectSpecSchema = z.object({
  /** The experience the project is going for, not its feature list. */
  goal: z.string().min(1).max(600),
  /** What the player actually does, moment to moment. */
  coreLoop: z.string().min(1).max(600),
  /** Things the user stated explicitly and that must survive later edits. */
  constraints: z.array(z.string().min(1).max(200)).max(20).default([]),
  /** Decisions worth remembering, each with the reason it was made. */
  decisions: z
    .array(
      z.object({
        decision: z.string().min(1).max(200),
        why: z.string().min(1).max(300),
      }),
    )
    .max(20)
    .default([]),
  /** Known unknowns the agent chose not to block on. */
  openQuestions: z.array(z.string().min(1).max(200)).max(10).default([]),
});

export type ProjectSpec = z.infer<typeof projectSpecSchema>;

function bullets(items: string[]) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- 暂无";
}

/**
 * Renders the spec deterministically on the server.
 *
 * The model supplies the content but never the formatting: letting it write the
 * markdown directly means the document slowly drifts into whatever shape the
 * model felt like that day, which makes the next turn harder to read.
 */
export function renderSpecMarkdown(
  spec: ProjectSpec,
  changelog: string[],
): string {
  const decisions = spec.decisions.length
    ? spec.decisions
        .map((entry) => `- ${entry.decision}\n  - 原因：${entry.why}`)
        .join("\n")
    : "- 暂无";

  return `# 项目意图

> 这份文件记录这个作品「想成为什么」，而不是「现在是什么」。
> 代码由构建产物负责说明；目录结构和技术栈可以机械推导，因此不写在这里。

## 目标体验

${spec.goal}

## 核心循环

${spec.coreLoop}

## 硬性约束

${bullets(spec.constraints)}

## 已做的决定

${decisions}

## 待确认

${bullets(spec.openQuestions)}

${CHANGELOG_HEADING}

${changelog.length ? changelog.join("\n") : "- 暂无"}
`;
}

/** Pulls the accumulated changelog out of a previously rendered spec. */
export function extractChangelog(markdown: string): string[] {
  const index = markdown.indexOf(CHANGELOG_HEADING);
  if (index === -1) return [];
  return markdown
    .slice(index + CHANGELOG_HEADING.length)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- ") && line !== "- 暂无");
}

export function appendChangelog(
  existing: string[],
  entry: string,
  limit = 40,
) {
  const line = `- ${entry.replace(/\s+/g, " ").trim()}`;
  // Newest last, matching how the sections above read top to bottom.
  return [...existing, line].slice(-limit);
}

export function readSpecMarkdown(
  workspace: GeneratedWorkspace | undefined,
): string | undefined {
  return workspace?.files.find((file) => file.path === SPEC_PATH)?.content;
}
