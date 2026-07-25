import { describe, expect, it } from "vitest";

import type { StreamDelta } from "@/lib/generation-events";
import { AgentStreamParser } from "@/server/llm/stream-parser";

function collect(chunks: string[]) {
  const parser = new AgentStreamParser();
  const deltas: StreamDelta[] = [];
  for (const chunk of chunks) deltas.push(...parser.push(chunk));
  deltas.push(...parser.end());
  return deltas;
}

/** Reconstructs each file's text from the emitted deltas. */
function assemble(deltas: StreamDelta[]) {
  const files: Record<string, string> = {};
  for (const delta of deltas) {
    if (delta.type === "file-open") files[delta.path] ??= "";
    if (delta.type === "file-delta") files[delta.path] += delta.text;
  }
  return files;
}

const workspace = {
  title: "Neon Breaker",
  summary: "一个打砖块",
  files: [
    {
      path: "src/App.tsx",
      content:
        'export default function App() {\n  return <main className="shell">你好</main>;\n}\n',
    },
    { path: "src/styles.css", content: "body { margin: 0; }\n" },
    { path: "README.md", content: "# Neon\\Breaker\t\"quoted\"\n" },
  ],
};
const payload = JSON.stringify(workspace);

describe("AgentStreamParser", () => {
  it("recovers every file when fed as one chunk", () => {
    const files = assemble(collect([payload]));
    expect(Object.keys(files)).toEqual([
      "src/App.tsx",
      "src/styles.css",
      "README.md",
    ]);
    for (const file of workspace.files) {
      expect(files[file.path]).toBe(file.content);
    }
  });

  it("recovers every file at every possible chunk boundary", () => {
    for (let split = 1; split < payload.length; split += 1) {
      const files = assemble(
        collect([payload.slice(0, split), payload.slice(split)]),
      );
      for (const file of workspace.files) {
        expect(files[file.path], `split at ${split}`).toBe(file.content);
      }
    }
  });

  it("survives single-character chunking", () => {
    const files = assemble(collect([...payload]));
    for (const file of workspace.files) {
      expect(files[file.path]).toBe(file.content);
    }
  });

  it("decodes unicode escapes split across chunks", () => {
    const raw = '{"files":[{"path":"a.ts","content":"\\u4f60\\u597d"}]}';
    for (let split = 1; split < raw.length; split += 1) {
      const files = assemble(collect([raw.slice(0, split), raw.slice(split)]));
      expect(files["a.ts"], `split at ${split}`).toBe("你好");
    }
  });

  it("tolerates a markdown code fence around the payload", () => {
    const files = assemble(collect(["```json\n", payload, "\n```"]));
    expect(files["src/styles.css"]).toBe("body { margin: 0; }\n");
  });

  it("emits open before delta and close after, in order, per file", () => {
    const deltas = collect([payload]);
    const shape = deltas
      .filter((delta) => delta.path === "src/styles.css")
      .map((delta) => delta.type);
    expect(shape[0]).toBe("file-open");
    expect(shape.at(-1)).toBe("file-close");
    expect(shape.filter((type) => type === "file-open")).toHaveLength(1);
    expect(shape.filter((type) => type === "file-close")).toHaveLength(1);
  });

  it("does not resynchronise on a \"path\" string inside file content", () => {
    const tricky = JSON.stringify({
      files: [
        { path: "a.ts", content: 'const x = {"path": "not-a-file"};' },
        { path: "b.ts", content: "ok" },
      ],
    });
    const files = assemble(collect([tricky]));
    expect(Object.keys(files)).toEqual(["a.ts", "b.ts"]);
    expect(files["a.ts"]).toBe('const x = {"path": "not-a-file"};');
  });

  it("closes a file that the stream truncates mid-write", () => {
    const truncated = '{"files":[{"path":"a.ts","content":"half w';
    const deltas = collect([truncated]);
    expect(assemble(deltas)["a.ts"]).toBe("half w");
    expect(deltas.at(-1)).toEqual({ type: "file-close", path: "a.ts" });
  });

  it("emits nothing for a stream that never reaches the files array", () => {
    expect(collect(['{"title":"x","summary":"y"'])).toEqual([]);
  });

  it("does not grow its buffer without bound while seeking", () => {
    const parser = new AgentStreamParser();
    for (let i = 0; i < 500; i += 1) parser.push("x".repeat(1000));
    // Nothing matched, so the retained tail must stay tiny.
    expect(parser.push('"path":"a.ts","content":"z"')).toEqual([
      { type: "file-open", path: "a.ts" },
      { type: "file-delta", path: "a.ts", text: "z" },
      { type: "file-close", path: "a.ts" },
    ]);
  });
});
