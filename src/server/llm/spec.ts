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
 *
 * The scaffolding — headings, placeholders, the changelog anchor — is English
 * and stays English in every locale. The content inside it is whatever language
 * the user wrote in. That split is what keeps `extractChangelog` working: a
 * translated heading would be a different anchor, so switching languages would
 * silently drop the history of a project rather than translate it.
 */

export const SPEC_PATH = "SPEC.md";

const CHANGELOG_HEADING = "## Changelog";

/**
 * Anchors that have ever marked the changelog.
 *
 * The Chinese heading is what projects created before the split still carry,
 * and their history has to survive the first edit made after it.
 */
const CHANGELOG_HEADINGS = [CHANGELOG_HEADING, "## 改动记录"];

const EMPTY_BULLET = "- None yet";
/** The same placeholder as written by earlier versions. */
const EMPTY_BULLETS = new Set([EMPTY_BULLET, "- 暂无"]);

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
  return items.length ? items.map((item) => `- ${item}`).join("\n") : EMPTY_BULLET;
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
        .map((entry) => `- ${entry.decision}\n  - Why: ${entry.why}`)
        .join("\n")
    : EMPTY_BULLET;

  return `# Project intent

> What this project is trying to be, not what it currently is.
> The build output speaks for the code; directory structure and tech stack are
> mechanically derivable and are deliberately not recorded here.

## Target experience

${spec.goal}

## Core loop

${spec.coreLoop}

## Hard constraints

${bullets(spec.constraints)}

## Decisions made

${decisions}

## Open questions

${bullets(spec.openQuestions)}

${CHANGELOG_HEADING}

${changelog.length ? changelog.join("\n") : EMPTY_BULLET}
`;
}

/** Pulls the accumulated changelog out of a previously rendered spec. */
export function extractChangelog(markdown: string): string[] {
  for (const heading of CHANGELOG_HEADINGS) {
    const index = markdown.indexOf(heading);
    if (index === -1) continue;
    return markdown
      .slice(index + heading.length)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- ") && !EMPTY_BULLETS.has(line));
  }
  return [];
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
