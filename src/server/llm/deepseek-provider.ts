import type { StreamDelta } from "@/lib/generation-events";
import type {
  GameGenerationProvider,
  PlanInput,
  PlanResult,
  WriteInput,
  WriteResult,
} from "@/server/llm/types";
import { generationPlanSchema } from "@/server/llm/plan";
import {
  NAME_PROMPT,
  PLAN_PROMPT,
  REPAIR_PROMPT,
  WRITE_PROMPT,
  describeManifest,
} from "@/server/llm/prompts";
import { AgentStreamParser } from "@/server/llm/stream-parser";
import { SPEC_PATH } from "@/server/llm/spec";
import { getServerEnv } from "@/server/env";
import type { AgentFile } from "@/server/workspace/schema";
import {
  extractAgentFiles,
  generatedFileSchema,
  isEditableAgentPath,
  validateAgentFiles,
} from "@/server/workspace/schema";
import { z } from "zod";

/**
 * Tolerant on purpose.
 *
 * The step asks for one file, and the caller picks the requested path out of
 * whatever comes back — so a model that returns the whole project is merely
 * verbose, not wrong. A tight bound here turned that into a hard failure and
 * threw away a response that contained exactly what was needed.
 *
 * Also accepts a bare `{path, content}`, which is the other shape models reach
 * for when asked for a single file.
 */
const writeResponseSchema = z.union([
  z.object({ files: z.array(z.unknown()).min(1).max(32) }),
  z
    .object({ path: z.string(), content: z.string() })
    .transform((file) => ({ files: [file] as unknown[] })),
]);

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
 * How much source to inline before falling back to the manifest.
 *
 * Context is a budget, not a dumping ground. Every turn used to inline every
 * file in full, so the prompt grew with the project and the oldest, least
 * relevant code crowded out the request being answered.
 */
const SOURCE_BUDGET_CHARS = 60_000;

/** Older turns are summarised down to their first line. */
const RECENT_TURNS_IN_FULL = 6;
const OLDER_TURN_CHARS = 120;

function transcriptOf(history: PlanInput["history"]) {
  const older = history.slice(0, -RECENT_TURNS_IN_FULL);
  const recent = history.slice(-RECENT_TURNS_IN_FULL);
  const line = (turn: PlanInput["history"][number], limit?: number) => {
    const who = turn.role === "user" ? "User" : "Agent";
    const text = limit
      ? turn.content.replace(/\s+/g, " ").slice(0, limit)
      : turn.content;
    return `${who}: ${text}`;
  };
  return [
    ...older.map((turn) => line(turn, OLDER_TURN_CHARS)),
    ...recent.map((turn) => line(turn)),
  ].join("\n");
}

/**
 * Builds the shared context block.
 *
 * `focusPaths` are the files the current step is about; they are worth their
 * space. Everything else fills the remaining budget, and whatever does not fit
 * appears in the manifest only — a name and a size is enough for the model to
 * know a file exists and ask for nothing from it.
 */
function contextBlock(
  input: PlanInput,
  options: { includeSource: boolean; focusPaths?: string[] },
) {
  const parts: string[] = [];

  parts.push(`Original brief:\n${input.originalPrompt}`);

  if (input.specMarkdown) {
    // The distilled memory of the project: what it is for and what has already
    // been decided. Always worth its space, however long the conversation gets.
    parts.push(`Recorded intent (${SPEC_PATH}):\n${input.specMarkdown}`);
  }

  if (input.history.length) {
    parts.push(`Conversation so far:\n${transcriptOf(input.history)}`);
  }

  const agentFiles = (
    input.previousWorkspace ? extractAgentFiles(input.previousWorkspace) : []
  ).filter((file) => file.path !== SPEC_PATH);

  if (agentFiles.length) {
    parts.push(`Current editable files:\n${describeManifest(agentFiles)}`);

    if (options.includeSource) {
      const focus = new Set(options.focusPaths ?? []);
      const ordered = [
        ...agentFiles.filter((file) => focus.has(file.path)),
        ...agentFiles.filter((file) => !focus.has(file.path)),
      ];

      const included: string[] = [];
      const omitted: string[] = [];
      let spent = 0;
      for (const file of ordered) {
        const block = `--- ${file.path} ---\n${file.content}`;
        // A focused file goes in whatever it costs: the step cannot do its job
        // without it, and a truncated source file is worse than none.
        if (focus.has(file.path) || spent + block.length <= SOURCE_BUDGET_CHARS) {
          included.push(block);
          spent += block.length;
        } else {
          omitted.push(file.path);
        }
      }

      if (included.length) {
        parts.push(`Current source:\n${included.join("\n\n")}`);
      }
      if (omitted.length) {
        parts.push(
          `Not shown to save space (unchanged, ask before assuming their contents):\n${omitted.join("\n")}`,
        );
      }
    }
  }

  return parts.join("\n\n");
}

const nameResponseSchema = z.object({ name: z.string().min(1).max(60) });

export class DeepSeekGameProvider implements GameGenerationProvider {
  async nameProject(prompt: string): Promise<string> {
    const env = getServerEnv();
    // Naming is comprehension of a single sentence: the fast model, no
    // reasoning, and a short leash so project creation stays quick.
    const { content } = await callDeepSeek(
      [
        { role: "system", content: NAME_PROMPT },
        { role: "user", content: prompt },
      ],
      {
        temperature: 0.2,
        model: env.DEEPSEEK_PLAN_MODEL,
        thinking: false,
        timeoutMs: 15_000,
      },
    );
    return nameResponseSchema.parse(
      JSON.parse(stripCodeFence(content)) as unknown,
    ).name;
  }


  async plan(input: PlanInput): Promise<PlanResult> {
    const env = getServerEnv();
    const { content, usage } = await callDeepSeek(
      [
        { role: "system", content: PLAN_PROMPT },
        {
          role: "user",
          content: `${contextBlock(input, { includeSource: false })}\n\nUser request (${input.kind}):\n${input.prompt}`,
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

  async write(input: WriteInput): Promise<WriteResult> {
    const env = getServerEnv();

    const wanted = input.plan.changes
      .map((change) => `${change.path} — ${change.intent}`)
      .join("\n");

    const messages: ChatMessage[] = [
      { role: "system", content: WRITE_PROMPT },
      {
        role: "user",
        content: [
          contextBlock(input, {
            includeSource: true,
            focusPaths: input.plan.changes.map((change) => change.path),
          }),
          `Agreed plan:\n${JSON.stringify(input.plan, null, 2)}`,
          `Write exactly these files:\n${wanted}`,
          `User request (${input.kind}):\n${input.prompt}`,
        ].join("\n\n"),
      },
    ];

    if (input.repair) {
      messages.push(
        {
          role: "assistant",
          content: JSON.stringify({ files: input.repair.attempted }),
        },
        {
          role: "user",
          content: `${REPAIR_PROMPT}\n\nBuild error:\n${input.repair.error}`,
        },
      );
    }

    // One call for the whole set. Imports, export names and prop shapes have to
    // agree across these files, and deciding them in one context is what makes
    // them agree — writing a file at a time left each one guessing about the
    // others and produced import paths that pointed at nothing.
    const { content, usage } = await callDeepSeek(messages, {
      temperature: input.kind === "edit" ? 0.2 : 0.6,
      model: env.DEEPSEEK_MODEL,
      thinking: env.DEEPSEEK_WRITE_THINKING,
      onProgress: input.onProgress,
      timeoutMs: input.timeoutMs,
    });

    const parsed = writeResponseSchema.safeParse(
      JSON.parse(stripCodeFence(content)) as unknown,
    );
    if (!parsed.success) {
      throw new Error(
        `模型返回的结构无法解析：${parsed.error.issues[0]?.message ?? "unknown"}`,
      );
    }

    // Keep what the plan asked for and drop the rest. The model occasionally
    // echoes platform-owned files back unchanged; validateAgentFiles is the
    // hard backstop either way.
    const planned = new Set(input.plan.changes.map((change) => change.path));
    const files = validateAgentFiles(
      parsed.data.files
        .map((file) => generatedFileSchema.safeParse(file))
        .flatMap((result) => (result.success ? [result.data] : []))
        .filter(
          (file) =>
            planned.has(file.path) &&
            isEditableAgentPath(file.path) &&
            file.path !== SPEC_PATH,
        ),
    ) as AgentFile[];

    if (!files.length) {
      throw new Error("模型没有返回计划里的任何文件");
    }

    return {
      files,
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
