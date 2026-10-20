import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { consumeStream } from "@/server/llm/deepseek-provider";

/** An SSE body in DeepSeek's OpenAI-compatible shape. */
function sse(chunks: unknown[]) {
  const body = [...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`), "data: [DONE]\n\n"].join("");
  return new Response(body);
}

const reasoning = (text: string) => ({
  choices: [{ delta: { reasoning_content: text } }],
});
const content = (text: string) => ({ choices: [{ delta: { content: text } }] });
const finish = (reason: string) => ({
  choices: [{ delta: {}, finish_reason: reason }],
});

/**
 * "The stream ended" is not one outcome. A detailed request once reasoned
 * until the token cap and ended with `length` and no answer text, which was
 * reported as a bare "empty response" on every retry.
 */
describe("consumeStream", () => {
  it("reports a normal finish with its answer", async () => {
    const result = await consumeStream(
      sse([reasoning("想一想"), content('{"files":[]}'), finish("stop")]),
    );
    expect(result.content).toBe('{"files":[]}');
    expect(result.finishReason).toBe("stop");
    expect(result.reasoningChars).toBe(3);
  });

  it("tells a budget spent entirely on reasoning apart from an answer", async () => {
    const result = await consumeStream(
      sse([reasoning("a".repeat(500)), reasoning("b".repeat(500)), finish("length")]),
    );
    expect(result.content).toBe("");
    expect(result.finishReason).toBe("length");
    expect(result.reasoningChars).toBe(1000);
  });

  it("forwards reasoning progress to the caller", async () => {
    const seen: number[] = [];
    await consumeStream(
      sse([reasoning("ab"), reasoning("cde"), content("{}"), finish("stop")]),
      (delta) => {
        if (delta.type === "thinking") seen.push(delta.chars);
      },
    );
    expect(seen).toEqual([2, 5]);
  });
});
