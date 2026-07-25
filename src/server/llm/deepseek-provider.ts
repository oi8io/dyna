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
  choices?: Array<{ delta?: { content?: string } }>;
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
) {
  if (!response.body) throw new Error("DeepSeek returned no response body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new AgentStreamParser();
  let wire = "";
  let content = "";
  let usage = { prompt_tokens: 0, completion_tokens: 0 };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
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
    onProgress?: (delta: StreamDelta) => void;
  },
) {
  const env = getServerEnv();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.DEEPSEEK_TIMEOUT_MS);

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
          model: env.DEEPSEEK_MODEL,
          temperature: options.temperature,
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
      throw new Error(`DeepSeek request failed (${response.status})`);
    }

    const { content, usage } = await consumeStream(response, options.onProgress);
    if (!content) throw new Error("DeepSeek returned an empty response");
    return { content, usage };
  } finally {
    clearTimeout(timeout);
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
      // Planning is a comprehension task; variance here only produces
      // inconsistent readings of the same request.
      { temperature: 0.1 },
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

    const { content, usage } = await callDeepSeek(messages, {
      temperature: input.kind === "edit" ? 0.2 : 0.6,
      onProgress: input.onProgress,
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
