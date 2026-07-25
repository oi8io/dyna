import { z } from "zod";

import { projectSpecSchema } from "@/server/llm/spec";

export const clarifyingQuestionSchema = z.object({
  question: z.string().min(1).max(300),
  options: z.array(z.string().min(1).max(120)).min(2).max(4),
});

/**
 * Only `understanding` is required.
 *
 * Everything else has a fallback because a plan that is 90% right is far more
 * useful than a hard failure: a model that omits one field would otherwise sink
 * the whole generation with a generic "生成失败", and the user has no way to
 * see, let alone fix, a schema mismatch.
 */
export const generationPlanSchema = z.object({
  understanding: z.string().min(1).max(800),
  /** Names the work. Decided at plan time so no extra call is needed later. */
  title: z.string().min(1).max(120).catch("未命名作品"),
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
  questions: z.array(clarifyingQuestionSchema).max(4).catch([]).default([]),
  /** Absent means "carry the previous spec forward unchanged". */
  spec: projectSpecSchema.optional().catch(undefined),
  changeSummary: z.string().min(1).max(300).catch("更新了这个作品。"),
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
