"use client";

import { useCallback, useState } from "react";

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
  /** True when the current phase was inherited from an earlier attempt. */
  phaseResumed: boolean;
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
  /** False while the browser is retrying a dropped stream. The run continues. */
  connected: boolean;
  /** Paths in the order the agent opened them. */
  order: string[];
  /** Text written so far, keyed by path. */
  drafts: Record<string, string>;
  /** The file currently being written, if any. */
  activePath?: string;
  logs: string[];
  /** A key into the dictionary's `errors` table, not a sentence. */
  errorCode?: string;
}

const IDLE: GenerationStreamState = {
  busy: false,
  phaseResumed: false,
  changes: [],
  assumptions: [],
  questions: [],
  thinkingChars: 0,
  connected: true,
  order: [],
  drafts: {},
  logs: [],
};

export function useGenerationStream() {
  const [state, setState] = useState<GenerationStreamState>(IDLE);

  const apply = useCallback((event: GenerationEvent) => {
    setState((current) => {
      switch (event.type) {
        case "phase":
          return {
            ...current,
            phase: event.phase,
            phaseResumed: event.resumed ?? false,
          };
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
          return { ...current, errorCode: event.code, activePath: undefined };
        case "done":
          return { ...current, activePath: undefined };
      }
    });
  }, []);

  const start = useCallback(
    async (projectId: string, prompt: string, kind: "create" | "edit") => {
      setState({ ...IDLE, busy: true });

      const result = await runGeneration({
        projectId,
        prompt,
        kind,
        onEvent: apply,
        onConnectionChange: (connected) =>
          setState((current) => ({ ...current, connected })),
      });

      setState((current) => ({
        ...current,
        busy: false,
        connected: true,
        errorCode: result.ok
          ? undefined
          : (result.errorCode ?? current.errorCode),
      }));
      return result;
    },
    [apply],
  );

  const reset = useCallback(() => setState(IDLE), []);

  return { state, start, reset };
}
