import type { StreamDelta } from "@/lib/generation-events";
import type {
  AnswerResult,
  GameGenerationProvider,
  PlanInput,
  PlanResult,
  WriteInput,
  WriteResult,
} from "@/server/llm/types";
import { generationPlanSchema } from "@/server/llm/plan";
import {
  ANSWER_PROMPT,
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

/**
 * The model's own output ceiling — 384K for every current DeepSeek V4 model —
 * sent on every request.
 *
 * Deliberately not a setting. A lower cap saves nothing, since billing follows
 * what was produced rather than what was allowed; all it decides is where an
 * answer gets cut off. In thinking mode the cap covers the chain-of-thought as
 * well, so the old 16K value let a long deliberation use up the entire budget
 * and come back with no answer at all — reported as "DeepSeek returned an
 * empty response" on every attempt at a detailed request. What bounds a call
 * now is the run's wall-clock deadline.
 *
 * Sent explicitly because the API does not document what it uses by default.
 */
const MAX_OUTPUT_TOKENS = 384_000;

/**
 * Time held back from a reasoning attempt so that, if it runs out, the same
 * request can still be answered without reasoning.
 *
 * Reasoning is the one part of a call whose length nobody controls. A write
 * that thinks until the deadline produces nothing; a write that thinks for
 * most of the budget and then falls back still produces a game.
 */
const NO_THINKING_RESERVE_MS = 150_000;
const NO_THINKING_RESERVE_SHARE = 0.4;
/** Below this, reasoning would be cut off before it got anywhere. */
const MIN_THINKING_MS = 90_000;

interface DeepSeekStreamChunk {
  choices?: Array<{
    delta?: { content?: string; reasoning_content?: string };
    finish_reason?: string | null;
  }>;
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
 *
 * `finishReason` is kept because "the stream ended" is not one outcome: `stop`
 * is an answer, `length` is an answer cut off by the token cap — possibly
 * before it began — and the two need different handling.
 */
export async function consumeStream(
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
  let finishReason: string | undefined;
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

        const finished = chunk.choices?.[0]?.finish_reason;
        if (finished) finishReason = finished;

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
  return { content, usage, finishReason, reasoningChars };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
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
  /**
   * The caller's budget wins outright; the env var is the default for callers
   * that do not track one.
   *
   * It used to be a `Math.min` of the two, which quietly made
   * `DEEPSEEK_TIMEOUT_MS` a ceiling over every caller — so raising the design
   * step's allowance to three minutes did nothing at all while that variable
   * sat at two. The run already bounds itself against
   * `GENERATION_DEADLINE_MS`, and the idle timer below is what actually catches
   * a hung connection, so a second ceiling here bought nothing and hid the
   * setting that was supposed to matter.
   */
  const budget = options.timeoutMs ?? env.DEEPSEEK_TIMEOUT_MS;
  if (budget <= 0) throw new Error("generation_deadline_exceeded");

  const controller = new AbortController();
  const startedAt = Date.now();
  // Which clock fired, so the error says whether the model was slow or silent.
  let abortedBy: "deadline" | "idle" | undefined;
  // Two clocks: a hard ceiling from the caller's budget, and an idle timer that
  // only fires when nothing at all has arrived. Reasoning tokens keep the idle
  // timer alive, so a model that thinks for two minutes is no longer mistaken
  // for a stalled request.
  const ceiling = setTimeout(() => {
    abortedBy = "deadline";
    controller.abort();
  }, budget);
  let idle: ReturnType<typeof setTimeout> | undefined;
  const keepAlive = () => {
    clearTimeout(idle);
    idle = setTimeout(
      () => {
        abortedBy ??= "idle";
        controller.abort();
      },
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
          max_tokens: MAX_OUTPUT_TOKENS,
          response_format: { type: "json_object" },
          stream: true,
          stream_options: { include_usage: true },
          messages,
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      // The body says why — a rejected parameter, an exhausted balance — and a
      // bare status code sent every one of those to the same dead end.
      const body = await response.text().catch(() => "");
      throw new Error(
        `DeepSeek request failed (${response.status}) for ${options.model}: ${body.slice(0, 300)}`,
      );
    }

    const { content, usage, finishReason, reasoningChars } =
      await consumeStream(response, options.onProgress, keepAlive);

    if (finishReason === "length") {
      throw new Error(
        content
          ? `output_truncated: ${options.model} hit the ${MAX_OUTPUT_TOKENS}-token output cap mid-answer`
          : `reasoning_exhausted: ${options.model} reasoned for ${reasoningChars} chars and hit the output cap before writing an answer`,
      );
    }
    if (!content) {
      throw new Error(
        `DeepSeek returned an empty response (finish_reason=${finishReason ?? "none"}, reasoning=${reasoningChars} chars)`,
      );
    }
    return { content, usage };
  } catch (error) {
    if (abortedBy) {
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      throw new Error(
        `deepseek_${abortedBy}_timed_out: ${options.model} ${options.thinking ? "with" : "without"} reasoning, after ${seconds}s`,
      );
    }
    throw error;
  } finally {
    clearTimeout(ceiling);
    clearTimeout(idle);
  }
}

/**
 * Whether a failed reasoning attempt is worth repeating without reasoning.
 *
 * Only failures that reasoning itself causes: running out of budget while
 * thinking, or running out of time. A rejected request or malformed answer
 * would fail the same way again.
 */
function isReasoningFailure(error: unknown) {
  return /reasoning_exhausted|deepseek_(deadline|idle)_timed_out/.test(
    errorMessage(error),
  );
}

/**
 * Calls the model with reasoning when there is time for it, and falls back to
 * answering without reasoning when that attempt fails.
 *
 * The reasoning attempt gets the budget minus a reserve; the reserve is what
 * the fallback runs in. Without it, a long deliberation consumed the entire
 * run and the user got an error instead of a game.
 */
async function callWithReasoningFallback(
  messages: ChatMessage[],
  options: {
    temperature: number;
    model: string;
    thinking: boolean;
    onProgress?: (delta: StreamDelta) => void;
    timeoutMs?: number;
  },
) {
  const env = getServerEnv();
  const startedAt = Date.now();
  const budget = options.timeoutMs ?? env.DEEPSEEK_TIMEOUT_MS;
  const reserve = Math.max(
    NO_THINKING_RESERVE_MS,
    budget * NO_THINKING_RESERVE_SHARE,
  );

  if (options.thinking && budget - reserve >= MIN_THINKING_MS) {
    try {
      return await callDeepSeek(messages, {
        ...options,
        thinking: true,
        timeoutMs: budget - reserve,
      });
    } catch (error) {
      if (!isReasoningFailure(error)) throw error;
      console.warn("[deepseek_reasoning_fallback]", errorMessage(error));
      // The counter would otherwise sit at the abandoned attempt's total.
      options.onProgress?.({ type: "thinking", chars: 0 });
    }
  }

  return callDeepSeek(messages, {
    ...options,
    thinking: false,
    timeoutMs: budget - (Date.now() - startedAt),
  });
}

const answerResponseSchema = z.object({ reply: z.string().min(1).max(8000) });

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
      // Two different jobs behind one method.
      //
      // An EDIT is comprehension plus a short JSON: work out which files have
      // to differ and say so. Chain-of-thought buys nothing there, costs the
      // warm-up that was timing this stage out, and disabling it also makes
      // `temperature` take effect again.
      //
      // A CREATE designs the game. Its spec is the only thing that survives the
      // run — every later turn reads it and nothing else remembers why the game
      // is the way it is — so it gets the stronger model, reasoning, and enough
      // temperature to make a choice rather than average over the obvious ones.
      // It was previously done by the small model with reasoning off at 0.1,
      // which is tuned to do the opposite of design, and it showed.
      input.kind === "create"
        ? {
            temperature: 0.8,
            model: env.DEEPSEEK_MODEL,
            thinking: true,
            timeoutMs: input.timeoutMs,
          }
        : {
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

  /**
   * Answers a question about the project without changing it.
   *
   * Gets the source, which planning never sees: "is the merge logic right
   * now?" can only be answered by reading the merge logic, and an answer
   * built from what earlier turns *said* they did repeats their mistakes.
   * The stronger model and reasoning, because checking code against a list of
   * rules is exactly the work reasoning is for.
   */
  async answer(input: PlanInput): Promise<AnswerResult> {
    const env = getServerEnv();
    const { content, usage } = await callWithReasoningFallback(
      [
        { role: "system", content: ANSWER_PROMPT },
        {
          role: "user",
          content: `${contextBlock(input, { includeSource: true })}\n\nUser question:\n${input.prompt}`,
        },
      ],
      {
        temperature: 0.3,
        model: env.DEEPSEEK_MODEL,
        thinking: true,
        timeoutMs: input.timeoutMs,
      },
    );

    const raw = stripCodeFence(content);
    let reply: string;
    try {
      reply = answerResponseSchema.parse(JSON.parse(raw) as unknown).reply;
    } catch {
      // A reply that ignored the JSON envelope is still a reply. Showing it
      // beats failing a question over packaging.
      reply = raw.slice(0, 8000);
    }

    return {
      reply,
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
    const { content, usage } = await callWithReasoningFallback(messages, {
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
        `The model returned an unparseable structure: ${parsed.error.issues[0]?.message ?? "unknown"}`,
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
      throw new Error("The model returned none of the files in the plan");
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
