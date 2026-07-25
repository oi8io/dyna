import type { StreamDelta } from "@/lib/generation-events";
import type {
  BuildInput,
  GameGenerationProvider,
  GenerateGameResult,
  PlanInput,
  PlanResult,
} from "@/server/llm/types";
import { generationPlanSchema } from "@/server/llm/plan";
import {
  BUILD_PROMPT,
  PLAN_PROMPT,
  REPAIR_PROMPT,
  describeManifest,
} from "@/server/llm/prompts";
import { AgentStreamParser } from "@/server/llm/stream-parser";
import { SPEC_PATH } from "@/server/llm/spec";
import { getServerEnv } from "@/server/env";
import { createGameWorkspace } from "@/server/template/game-template";
import type { AgentFile } from "@/server/workspace/schema";
import {
  extractAgentFiles,
  generatedFileSchema,
  isEditableAgentPath,
  mergeAgentFiles,
  validateAgentFiles,
} from "@/server/workspace/schema";
import { z } from "zod";

const buildResponseSchema = z.object({
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(500),
  files: z.array(z.unknown()).min(1).max(16),
  deleted: z.array(z.string().min(1).max(240)).max(8).default([]),
});

function stripCodeFence(value: string) {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
}

interface DeepSeekStreamChunk {
  choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Reads DeepSeek's OpenAI-compatible SSE stream, forwarding per-file progress
 * as it goes and returning the fully reassembled response.
 *
 * The reassembled text — not the streamed fragments — is what gets validated
 * and persisted, so a hiccup in progress reporting cannot affect the result.
 */
async function consumeStream(
  response: Response,
  onProgress?: (delta: StreamDelta) => void,
  onAlive?: () => void,
) {
  if (!response.body) throw new Error("DeepSeek returned no response body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new AgentStreamParser();
  let wire = "";
  let content = "";
  let reasoningChars = 0;
  let usage = { prompt_tokens: 0, completion_tokens: 0 };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // Any byte counts as liveness, including chain-of-thought.
      onAlive?.();
      wire += decoder.decode(value, { stream: true });

      let separator = wire.indexOf("\n\n");
      while (separator !== -1) {
        const frame = wire.slice(0, separator);
        wire = wire.slice(separator + 2);
        separator = wire.indexOf("\n\n");

        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("");
        if (!data || data === "[DONE]") continue;

        let chunk: DeepSeekStreamChunk;
        try {
          chunk = JSON.parse(data) as DeepSeekStreamChunk;
        } catch {
          continue;
        }

        if (chunk.usage) {
          usage = {
            prompt_tokens: chunk.usage.prompt_tokens ?? usage.prompt_tokens,
            completion_tokens:
              chunk.usage.completion_tokens ?? usage.completion_tokens,
          };
        }

        const reasoning = chunk.choices?.[0]?.delta?.reasoning_content;
        if (reasoning) {
          reasoningChars += reasoning.length;
          onProgress?.({ type: "thinking", chars: reasoningChars });
        }

        const text = chunk.choices?.[0]?.delta?.content;
        if (!text) continue;
        content += text;
        if (onProgress) for (const delta of parser.push(text)) onProgress(delta);
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (onProgress) for (const delta of parser.end()) onProgress(delta);
  return { content, usage };
}

async function callDeepSeek(
  messages: ChatMessage[],
  options: {
    temperature: number;
    model: string;
    /**
     * Chain-of-thought costs a long silent warm-up before any answer text.
     * Worth it when writing a game; pure overhead when emitting a short plan.
     */
    thinking: boolean;
    onProgress?: (delta: StreamDelta) => void;
    /** Remaining wall clock for the whole request, if the caller tracks one. */
    timeoutMs?: number;
  },
) {
  const env = getServerEnv();
  const budget = Math.min(
    env.DEEPSEEK_TIMEOUT_MS,
    options.timeoutMs ?? env.DEEPSEEK_TIMEOUT_MS,
  );
  if (budget <= 0) throw new Error("generation_deadline_exceeded");

  const controller = new AbortController();
  // Two clocks: a hard ceiling from the caller's budget, and an idle timer that
  // only fires when nothing at all has arrived. Reasoning tokens keep the idle
  // timer alive, so a model that thinks for two minutes is no longer mistaken
  // for a stalled request.
  const ceiling = setTimeout(() => controller.abort(), budget);
  let idle: ReturnType<typeof setTimeout> | undefined;
  const keepAlive = () => {
    clearTimeout(idle);
    idle = setTimeout(
      () => controller.abort(),
      Math.min(env.DEEPSEEK_IDLE_TIMEOUT_MS, budget),
    );
  };
  keepAlive();

  try {
    const response = await fetch(
      `${env.DEEPSEEK_BASE_URL.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: options.model,
          // Ignored by the API in thinking mode, so only sent when it applies.
          ...(options.thinking ? {} : { temperature: options.temperature }),
          thinking: { type: options.thinking ? "enabled" : "disabled" },
          max_tokens: env.DEEPSEEK_MAX_OUTPUT_TOKENS,
          response_format: { type: "json_object" },
          stream: true,
          stream_options: { include_usage: true },
          messages,
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      throw new Error(
        `DeepSeek request failed (${response.status}) for ${options.model}`,
      );
    }

    const { content, usage } = await consumeStream(
      response,
      options.onProgress,
      keepAlive,
    );
    if (!content) throw new Error("DeepSeek returned an empty response");
    return { content, usage };
  } finally {
    clearTimeout(ceiling);
    clearTimeout(idle);
  }
}

/**
 * Builds the shared context block.
 *
 * The previous project used to be inlined as `JSON.stringify(...).slice(0, 60_000)`,
 * which cut the document mid-token and handed the model malformed JSON. Files
 * are listed as a manifest and included whole or not at all.
 */
function contextBlock(input: PlanInput, includeSource: boolean) {
  const parts: string[] = [];

  parts.push(`Original brief:\n${input.originalPrompt}`);

  if (input.specMarkdown) {
    parts.push(`Recorded intent (${SPEC_PATH}):\n${input.specMarkdown}`);
  }

  if (input.history.length) {
    const transcript = input.history
      .map((turn) => `${turn.role === "user" ? "User" : "Agent"}: ${turn.content}`)
      .join("\n");
    parts.push(`Conversation so far:\n${transcript}`);
  }

  const agentFiles = input.previousWorkspace
    ? extractAgentFiles(input.previousWorkspace)
    : [];
  if (agentFiles.length) {
    parts.push(`Current editable files:\n${describeManifest(agentFiles)}`);
    if (includeSource) {
      const source = agentFiles
        .filter((file) => file.path !== SPEC_PATH)
        .map((file) => `--- ${file.path} ---\n${file.content}`)
        .join("\n\n");
      parts.push(`Current source:\n${source}`);
    }
  }

  return parts.join("\n\n");
}

export class DeepSeekGameProvider implements GameGenerationProvider {
  async plan(input: PlanInput): Promise<PlanResult> {
    const env = getServerEnv();
    const { content, usage } = await callDeepSeek(
      [
        { role: "system", content: PLAN_PROMPT },
        {
          role: "user",
          content: `${contextBlock(input, false)}\n\nUser request (${input.kind}):\n${input.prompt}`,
        },
      ],
      // Comprehension plus a short JSON. Chain-of-thought buys nothing here and
      // costs the warm-up that was timing this stage out, and disabling it also
      // makes `temperature` take effect again.
      {
        temperature: 0.1,
        model: env.DEEPSEEK_PLAN_MODEL,
        thinking: false,
        timeoutMs: input.timeoutMs,
      },
    );

    const plan = generationPlanSchema.parse(
      JSON.parse(stripCodeFence(content)) as unknown,
    );

    return {
      plan,
      provider: "deepseek" as const,
      model: env.DEEPSEEK_MODEL,
      usage: {
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        estimatedCostUsd: 0.01,
      },
    };
  }

  async generate(input: BuildInput): Promise<GenerateGameResult> {
    const env = getServerEnv();
    const previousAgentFiles = input.previousWorkspace
      ? extractAgentFiles(input.previousWorkspace)
      : [];

    const messages: ChatMessage[] = [
      { role: "system", content: BUILD_PROMPT },
      {
        role: "user",
        content: [
          contextBlock(input, true),
          `Agreed plan:\n${JSON.stringify(input.plan, null, 2)}`,
          `User request (${input.kind}):\n${input.prompt}`,
        ].join("\n\n"),
      },
    ];

    if (input.repair) {
      messages.push(
        {
          role: "assistant",
          content: JSON.stringify({ files: input.repair.attemptedFiles }),
        },
        {
          role: "user",
          content: `${REPAIR_PROMPT}\n\nBuild error:\n${input.repair.error}`,
        },
      );
    }

    // Writing a whole game is where reasoning can pay for itself — and also
    // where it costs the most time, against a fixed serverless wall clock.
    const { content, usage } = await callDeepSeek(messages, {
      temperature: input.kind === "edit" ? 0.2 : 0.6,
      model: env.DEEPSEEK_MODEL,
      thinking: env.DEEPSEEK_WRITE_THINKING,
      onProgress: input.onProgress,
      timeoutMs: input.timeoutMs,
    });

    const generated = buildResponseSchema.parse(
      JSON.parse(stripCodeFence(content)) as unknown,
    );

    // The model is told not to touch platform-owned files but occasionally
    // echoes them back. Drop those instead of failing the whole edit;
    // validateAgentFiles still enforces the boundary as a hard backstop.
    const changed = validateAgentFiles(
      generated.files.filter((file) => {
        const parsed = generatedFileSchema.safeParse(file);
        return (
          parsed.success &&
          isEditableAgentPath(parsed.data.path) &&
          // SPEC.md is rendered by the platform from the plan, never by the model.
          parsed.data.path !== SPEC_PATH
        );
      }),
    ) as AgentFile[];

    const merged = mergeAgentFiles(previousAgentFiles, changed, generated.deleted);
    const workspace = createGameWorkspace({
      title: generated.title,
      summary: generated.summary,
      agentFiles: merged,
    });

    return {
      workspace,
      changedPaths: changed.map((file) => file.path),
      provider: "deepseek" as const,
      model: env.DEEPSEEK_MODEL,
      usage: {
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        // Conservative flat reservation until provider billing metadata is
        // available. This keeps the public budget from under-counting.
        estimatedCostUsd: 0.05,
      },
    };
  }
}
