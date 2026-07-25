"use client";

import { useCallback, useRef, useState } from "react";

import type {
  ClarifyingQuestion,
  GenerationEvent,
  GenerationPhase,
  PlannedChange,
} from "@/lib/generation-events";
import { runGeneration } from "@/lib/run-generation";

export interface GenerationStreamState {
  busy: boolean;
  phase?: GenerationPhase;
  phaseLabel?: string;
  /** What the agent understood the request to mean. */
  understanding?: string;
  /** Files the plan said it would touch. */
  changes: PlannedChange[];
  /** Decisions the agent made rather than asking about. */
  assumptions: string[];
  /** Non-empty when the agent stopped to ask instead of guessing. */
  questions: ClarifyingQuestion[];
  /** Chain-of-thought produced so far. Proof of life during a silent stretch. */
  thinkingChars: number;
  /** Paths in the order the agent opened them. */
  order: string[];
  /** Text written so far, keyed by path. */
  drafts: Record<string, string>;
  /** The file currently being written, if any. */
  activePath?: string;
  logs: string[];
  error?: string;
}

const IDLE: GenerationStreamState = {
  busy: false,
  changes: [],
  assumptions: [],
  questions: [],
  thinkingChars: 0,
  order: [],
  drafts: {},
  logs: [],
};

export function useGenerationStream() {
  const [state, setState] = useState<GenerationStreamState>(IDLE);
  const abortRef = useRef<AbortController>(null);

  const apply = useCallback((event: GenerationEvent) => {
    setState((current) => {
      switch (event.type) {
        case "phase":
          return { ...current, phase: event.phase, phaseLabel: event.message };
        case "plan":
          return {
            ...current,
            understanding: event.understanding,
            changes: event.changes,
            assumptions: event.assumptions,
          };
        case "question":
          return {
            ...current,
            understanding: event.understanding,
            questions: event.questions,
            activePath: undefined,
          };
        case "thinking":
          return { ...current, thinkingChars: event.chars };
        case "file-open":
          return {
            ...current,
            activePath: event.path,
            order: current.order.includes(event.path)
              ? current.order
              : [...current.order, event.path],
            drafts: { ...current.drafts, [event.path]: "" },
          };
        case "file-delta":
          return {
            ...current,
            activePath: event.path,
            drafts: {
              ...current.drafts,
              [event.path]: (current.drafts[event.path] ?? "") + event.text,
            },
          };
        case "file-close":
          return { ...current, activePath: undefined };
        case "log":
          return { ...current, logs: [...current.logs, event.message] };
        case "error":
          return { ...current, error: event.message, activePath: undefined };
        case "done":
          return { ...current, activePath: undefined };
      }
    });
  }, []);

  const start = useCallback(
    async (projectId: string, prompt: string, kind: "create" | "edit") => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setState({ ...IDLE, busy: true });

      const result = await runGeneration({
        projectId,
        prompt,
        kind,
        onEvent: apply,
        signal: controller.signal,
      });

      setState((current) => ({
        ...current,
        busy: false,
        error: result.ok ? undefined : (result.error ?? current.error),
      }));
      return result;
    },
    [apply],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(IDLE);
  }, []);

  return { state, start, reset };
}
