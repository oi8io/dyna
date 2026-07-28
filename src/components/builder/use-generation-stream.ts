"use client";

import { useCallback, useState } from "react";

import {
  EMPTY_SNAPSHOT,
  type GenerationEvent,
  type GenerationSnapshot,
  foldGenerationEvent,
} from "@/lib/generation-events";
import {
  type GenerationOutcome,
  runGeneration,
  watchGeneration,
} from "@/lib/run-generation";

/**
 * The run's own progress, plus the two facts that belong to this connection
 * rather than to the run.
 */
export interface GenerationStreamState extends GenerationSnapshot {
  busy: boolean;
  /** False while the browser is retrying a dropped stream. The run continues. */
  connected: boolean;
}

const IDLE: GenerationStreamState = {
  ...EMPTY_SNAPSHOT,
  busy: false,
  connected: true,
};

export function useGenerationStream() {
  const [state, setState] = useState<GenerationStreamState>(IDLE);

  // The fold is shared with the server, so a snapshot assembled there and the
  // state built here from live events cannot drift apart.
  const apply = useCallback((event: GenerationEvent) => {
    setState((current) => ({
      ...current,
      ...foldGenerationEvent(current, event),
    }));
  }, []);

  const onConnectionChange = useCallback(
    (connected: boolean) => setState((current) => ({ ...current, connected })),
    [],
  );

  const settle = useCallback((result: GenerationOutcome) => {
    setState((current) => ({
      ...current,
      busy: false,
      connected: true,
      errorCode: result.ok ? undefined : (result.errorCode ?? current.errorCode),
    }));
    return result;
  }, []);

  const start = useCallback(
    async (projectId: string, prompt: string, kind: "create" | "edit") => {
      setState({ ...IDLE, busy: true });
      return settle(
        await runGeneration({
          projectId,
          prompt,
          kind,
          onEvent: apply,
          onConnectionChange,
        }),
      );
    },
    [apply, onConnectionChange, settle],
  );

  /**
   * Attaches to a run that was already going when the page opened.
   *
   * The same stream and the same events; the only difference is that there is
   * no POST in front of it, because the request that started the work returned
   * long ago.
   */
  const resume = useCallback(
    async (projectId: string, runId: string) => {
      setState({ ...IDLE, busy: true });
      return settle(
        await watchGeneration({
          projectId,
          runId,
          onEvent: apply,
          onConnectionChange,
        }),
      );
    },
    [apply, onConnectionChange, settle],
  );

  const reset = useCallback(() => setState(IDLE), []);

  return { state, start, resume, reset };
}
