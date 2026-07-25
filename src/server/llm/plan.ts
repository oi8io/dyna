import { z } from "zod";

import { projectSpecSchema } from "@/server/llm/spec";

export const clarifyingQuestionSchema = z.object({
  question: z.string().min(1).max(300),
  options: z.array(z.string().min(1).max(120)).min(2).max(4),
});

export const generationPlanSchema = z.object({
  understanding: z.string().min(1).max(800),
  changes: z
    .array(
      z.object({
        path: z.string().min(1).max(240),
        intent: z.string().min(1).max(300),
      }),
    )
    .max(16)
    .default([]),
  assumptions: z.array(z.string().min(1).max(300)).max(10).default([]),
  questions: z.array(clarifyingQuestionSchema).max(4).default([]),
  spec: projectSpecSchema,
  changeSummary: z.string().min(1).max(300),
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
