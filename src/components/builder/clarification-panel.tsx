"use client";

import { useState } from "react";

import type { ClarifyingQuestion } from "@/lib/generation-events";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";

interface ClarificationPanelProps {
  understanding: string;
  questions: ClarifyingQuestion[];
  onAnswer: (answer: string) => void;
}

/**
 * Shown when the agent stopped to ask instead of guessing. Answers are folded
 * back into a single follow-up message so the next turn reads them as ordinary
 * conversation — no separate answer-storage path to keep in sync.
 */
export function ClarificationPanel({
  understanding,
  questions,
  onAnswer,
}: ClarificationPanelProps) {
  const t = useT();
  const [picked, setPicked] = useState<Record<number, string>>({});
  const answered = questions.every((_, index) => picked[index]);

  function submit() {
    const answer = questions
      .map((item, index) => `${item.question} → ${picked[index]}`)
      .join("\n");
    onAnswer(answer);
  }

  return (
    <div className="mr-6 space-y-3 rounded-lg border border-accent/25 bg-accent-soft p-3">
      <p className="text-sm leading-6 text-ink">{understanding}</p>
      <p className="text-xs text-ink-soft">{t.clarify.note}</p>

      {questions.map((item, index) => (
        <div key={item.question} className="space-y-1.5">
          <p className="text-sm text-ink">{item.question}</p>
          <div className="flex flex-wrap gap-1.5">
            {item.options.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() =>
                  setPicked((current) => ({ ...current, [index]: option }))
                }
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  picked[index] === option
                    ? "border-accent bg-accent text-white"
                    : "border-line-strong bg-surface text-ink-soft hover:text-ink"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      ))}

      <Button size="sm" className="w-full" disabled={!answered} onClick={submit}>
        {t.clarify.submit}
      </Button>
    </div>
  );
}
