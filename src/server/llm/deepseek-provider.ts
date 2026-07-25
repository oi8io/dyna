import type { StreamDelta } from "@/lib/generation-events";
import type {
  GameGenerationProvider,
  PlanInput,
  PlanResult,
  WriteFileInput,
  WriteFileResult,
} from "@/server/llm/types";
import { generationPlanSchema } from "@/server/llm/plan";
import {
  PLAN_PROMPT,
  REPAIR_PROMPT,
  WRITE_FILE_PROMPT,
  describeManifest,
} from "@/server/llm/prompts";
import { AgentStreamParser } from "@/server/llm/stream-parser";
import { SPEC_PATH } from "@/server/llm/spec";
import { getServerEnv } from "@/server/env";
import type { AgentFile } from "@/server/workspace/schema";
import {
  extractAgentFiles,
  generatedFileSchema,
  validateAgentFiles,
} from "@/server/workspace/schema";
import { z } from "zod";

const writeResponseSchema = z.object({
  files: z.array(z.unknown()).min(1).max(4),
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

/**
 * The exact specifier one workspace file should use to import another.
 *
 * Counting `../` levels across directories is arithmetic the model gets wrong
 * often enough to be the leading cause of failed builds, and it is arithmetic
 * we can simply do for it.
 */
function relativeSpecifier(fromPath: string, toPath: string) {
  const from = fromPath.split("/").slice(0, -1);
  const to = toPath.split("/");
  const file = to.pop() ?? "";
  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) {
    shared += 1;
  }
  const up = Array.from({ length: from.length - shared }, () => "..");
  const down = to.slice(shared);
  const stem = file.replace(/\.(ts|tsx|js|jsx)$/, "");
  const segments = [...up, ...down, stem];
  const joined = segments.join("/");
  return joined.startsWith(".") ? joined : `./${joined}`;
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

  async writeFile(input: WriteFileInput): Promise<WriteFileResult> {
    const env = getServerEnv();

    const written = Object.entries(input.drafts)
      .map(
        ([path, content]) =>
          `--- ${path} (already written; import it as "${relativeSpecifier(input.path, path)}") ---\n${content}`,
      )
      .join("\n\n");
    const pending = input.plan.changes
      .filter(
        (change) =>
          change.path !== input.path && !(change.path in input.drafts),
      )
      .map((change) => `${change.path} — ${change.intent}`)
      .join("\n");

    const messages: ChatMessage[] = [
      { role: "system", content: WRITE_FILE_PROMPT },
      {
        role: "user",
        content: [
          contextBlock(input, true),
          `Agreed plan:\n${JSON.stringify(input.plan, null, 2)}`,
          written && `Files written so far in this run:\n${written}`,
          pending && `Still to be written after this one:\n${pending}`,
          `User request (${input.kind}):\n${input.prompt}`,
          `Write this file now: ${input.path}\nIts role: ${input.intent}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ];

    if (input.repair) {
      messages.push(
        {
          role: "assistant",
          content: JSON.stringify({
            files: [{ path: input.path, content: input.repair.attempted }],
          }),
        },
        {
          role: "user",
          content: `${REPAIR_PROMPT}\n\nBuild error:\n${input.repair.error}`,
        },
      );
    }

    // One file per call, so the reasoning budget is spent on a focused task
    // rather than on holding an entire game in mind at once.
    const { content, usage } = await callDeepSeek(messages, {
      temperature: input.kind === "edit" ? 0.2 : 0.6,
      model: env.DEEPSEEK_MODEL,
      thinking: env.DEEPSEEK_WRITE_THINKING,
      onProgress: input.onProgress,
      timeoutMs: input.timeoutMs,
    });

    const generated = writeResponseSchema.parse(
      JSON.parse(stripCodeFence(content)) as unknown,
    );

    // The model was asked for one specific path. Take that one if present and
    // ignore anything else it decided to include.
    const candidates = generated.files
      .map((file) => generatedFileSchema.safeParse(file))
      .flatMap((parsed) => (parsed.success ? [parsed.data] : []));
    const chosen =
      candidates.find((file) => file.path === input.path) ?? candidates[0];
    if (!chosen) {
      throw new Error(`模型没有返回 ${input.path} 的内容`);
    }

    // The requested path is authoritative: the plan decided it, not the model.
    const [file] = validateAgentFiles([
      { path: input.path, content: chosen.content },
    ]) as AgentFile[];

    return {
      file,
      provider: "deepseek" as const,
      model: env.DEEPSEEK_MODEL,
      usage: {
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        // Conservative flat reservation until provider billing metadata is
        // available. This keeps the public budget from under-counting.
        estimatedCostUsd: 0.02,
      },
    };
  }
}
