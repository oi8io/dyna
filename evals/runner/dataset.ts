import { readFile } from "node:fs/promises";

import { z } from "zod";

import type { EvalCase } from "./types";

const evalCaseSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .regex(/^[a-z0-9-]+$/, "ids are used as directory names"),
    kind: z.enum(["create", "edit"]),
    prompt: z.string().min(1),
    seedPrompt: z.string().min(1).optional(),
    expectClarification: z.boolean(),
    tags: z.array(z.string().min(1)).default([]),
    mustMention: z.array(z.string().min(1)).optional(),
    notes: z.string().optional(),
  })
  .refine((value) => value.kind !== "edit" || Boolean(value.seedPrompt), {
    message: "an edit case needs a seedPrompt to have something to edit",
  });

/**
 * Reads a JSONL dataset.
 *
 * One JSON object per line rather than one big array, so a case can be added,
 * reviewed or reverted as a single-line diff — the file is meant to grow, and a
 * pretty-printed array turns every addition into an unreadable reflow.
 */
export async function loadDataset(path: string): Promise<EvalCase[]> {
  const text = await readFile(path, "utf8");
  const cases: EvalCase[] = [];
  const seen = new Set<string>();

  text.split("\n").forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) return;

    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(
        `${path}:${index + 1} is not valid JSON — ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const parsed = evalCaseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `${path}:${index + 1} is not a valid case — ${parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; ")}`,
      );
    }
    if (seen.has(parsed.data.id)) {
      throw new Error(`${path}:${index + 1} repeats the id ${parsed.data.id}`);
    }
    seen.add(parsed.data.id);
    cases.push(parsed.data);
  });

  if (!cases.length) throw new Error(`${path} contains no cases`);
  return cases;
}

/** Keeps the cases whose id or tags match every one of the given filters. */
export function filterCases(cases: EvalCase[], filters: string[]) {
  if (!filters.length) return cases;
  return cases.filter((item) =>
    filters.every(
      (filter) => item.id === filter || item.id.includes(filter) || item.tags.includes(filter),
    ),
  );
}
