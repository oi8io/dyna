import { z } from "zod";

import { projectSpecSchema } from "@/server/llm/spec";

export const clarifyingQuestionSchema = z.object({
  question: z.string().min(1).max(300),
  options: z.array(z.string().min(1).max(120)).min(2).max(4),
});

/** As many as the prompt asks for; more is trimmed, never fatal. */
export const MAX_QUESTIONS = 6;
const MAX_OPTIONS = 4;

/**
 * One question, repaired where it can be and dropped where it cannot.
 *
 * Too many options are trimmed and over-long text is cut. Only a question with
 * fewer than two usable options is unusable: it cannot be answered by picking.
 */
const lenientQuestionSchema = z.object({
  question: z
    .string()
    .trim()
    .min(1)
    .transform((text) => text.slice(0, 300)),
  options: z
    .array(z.unknown())
    .transform((options) =>
      options
        .filter((option): option is string => typeof option === "string")
        .map((option) => option.trim().slice(0, 120))
        .filter(Boolean)
        .slice(0, MAX_OPTIONS),
    )
    .pipe(z.array(z.string()).min(2)),
});

/**
 * Questions are kept one by one.
 *
 * The array used to be validated as a whole with `.max(4).catch([])`, so a
 * model that asked five questions — or got one option list wrong — lost all
 * of them without a trace. The plan then had neither questions nor changes,
 * and a request that explicitly said "ask me first" went to the answer step,
 * which replied with prose questions about platforms the project cannot use.
 */
const questionsSchema = z
  .array(z.unknown())
  .catch([])
  .transform((items) =>
    items
      .flatMap((item) => {
        const parsed = lenientQuestionSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      })
      .slice(0, MAX_QUESTIONS),
  );

/**
 * Only `understanding` is required.
 *
 * Everything else has a fallback because a plan that is 90% right is far more
 * useful than a hard failure: a model that omits one field would otherwise sink
 * the whole generation with a generic "生成失败", and the user has no way to
 * see, let alone fix, a schema mismatch.
 */
/**
 * Stands in when the model returns no summary at all.
 *
 * A sentinel rather than a sentence: the schema is parsed with no idea who is
 * reading or what language they wrote in, and the run replaces this with copy
 * that matches the request before anyone sees it.
 */
export const FALLBACK_CHANGE_SUMMARY = "__no_change_summary__";

/**
 * What kind of turn this is.
 *
 * Without it every turn was a build: a plan could only list files to rewrite or
 * ask a question, so "how far along is it?" was answered by rewriting five
 * files — and reported as a change.
 */
export const turnIntentSchema = z.enum(["change", "answer", "clarify"]);
export type TurnIntent = z.infer<typeof turnIntentSchema>;

export const generationPlanSchema = z.object({
  /** Absent on older plans and from models that skip it; see `planIntent`. */
  intent: turnIntentSchema.optional().catch(undefined),
  understanding: z.string().min(1).max(800),
  changes: z
    .array(
      z.object({
        path: z.string().min(1).max(240),
        intent: z.string().min(1).max(300).default(""),
      }),
    )
    .max(16)
    .catch([])
    .default([]),
  assumptions: z.array(z.string().min(1).max(300)).max(10).catch([]).default([]),
  questions: questionsSchema,
  /** Absent means "carry the previous spec forward unchanged". */
  spec: projectSpecSchema.optional().catch(undefined),
  changeSummary: z.string().min(1).max(300).catch(FALLBACK_CHANGE_SUMMARY),
});

export type ClarifyingQuestion = z.infer<typeof clarifyingQuestionSchema>;
export type GenerationPlan = z.infer<typeof generationPlanSchema>;

/**
 * A plan that asks anything is a plan that builds nothing. Enforced here rather
 * than trusted to the prompt, so a model that both asks and proposes changes
 * still stops and waits.
 */
export function planNeedsClarification(plan: GenerationPlan) {
  return plan.questions.length > 0;
}

/**
 * Decides what the run does with a plan.
 *
 * Questions win, as before. Then the model's own classification — and when it
 * says "answer", that holds even if it also listed files: a turn that asked
 * something gets an answer and the user can ask for the fix, whereas an
 * unwanted rewrite cannot be taken back. A plan that names nothing to change
 * is answered rather than failed: there is no build to run, and an answer is
 * more useful than "plan_named_no_files".
 */
export function planIntent(plan: GenerationPlan): TurnIntent {
  if (planNeedsClarification(plan)) return "clarify";
  if (plan.intent === "answer" || !plan.changes.length) return "answer";
  return "change";
}
