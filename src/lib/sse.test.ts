import { describe, expect, it } from "vitest";

import { createSseDecoder, encodeSseFrame } from "@/lib/sse";

interface Frame {
  type: string;
  text?: string;
}

describe("sse framing", () => {
  it("round-trips a single event", () => {
    const decode = createSseDecoder<Frame>();
    expect(decode(encodeSseFrame({ type: "phase" }))).toEqual([
      { type: "phase" },
    ]);
  });

  it("reassembles a frame split at every byte", () => {
    const wire = encodeSseFrame({ type: "file-delta", text: "line\nnext" });
    for (let split = 1; split < wire.length; split += 1) {
      const decode = createSseDecoder<Frame>();
      const frames = [
        ...decode(wire.slice(0, split)),
        ...decode(wire.slice(split)),
      ];
      expect(frames, `split at ${split}`).toEqual([
        { type: "file-delta", text: "line\nnext" },
      ]);
    }
  });

  it("decodes several frames arriving in one chunk", () => {
    const decode = createSseDecoder<Frame>();
    const wire = encodeSseFrame({ type: "a" }) + encodeSseFrame({ type: "b" });
    expect(decode(wire)).toEqual([{ type: "a" }, { type: "b" }]);
  });

  it("keeps an incomplete trailing frame buffered", () => {
    const decode = createSseDecoder<Frame>();
    expect(decode('data: {"type":"a"}\n\ndata: {"typ')).toEqual([
      { type: "a" },
    ]);
    expect(decode('e":"b"}\n\n')).toEqual([{ type: "b" }]);
  });

  it("survives code content that contains blank lines", () => {
    const text = "function a() {}\n\nfunction b() {}\n";
    const decode = createSseDecoder<Frame>();
    expect(decode(encodeSseFrame({ type: "file-delta", text }))).toEqual([
      { type: "file-delta", text },
    ]);
  });

  it("drops an unparseable frame without losing the next one", () => {
    const decode = createSseDecoder<Frame>();
    expect(decode(`data: {oops\n\n${encodeSseFrame({ type: "b" })}`)).toEqual([
      { type: "b" },
    ]);
  });
});
