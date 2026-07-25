import type { StreamDelta } from "@/lib/generation-events";

/**
 * Extracts per-file progress from a partially received agent response.
 *
 * The agent returns one JSON document:
 *
 *   {"title":"…","summary":"…","files":[{"path":"…","content":"…"}, …]}
 *
 * Waiting for the closing brace before showing anything means the user stares
 * at a blank editor for the whole generation. This scanner walks the bytes as
 * they arrive and emits open/delta/close events per file.
 *
 * It is deliberately a targeted scanner rather than a general JSON parser: it
 * only looks for the `"path"` and `"content"` keys it knows the schema has.
 *
 * IMPORTANT: this drives the live preview only. The authoritative parse is
 * still a single `JSON.parse` over the complete response, so a bug here can
 * garble what the user watches but can never corrupt what gets saved.
 */

type Phase = "seek-path" | "read-path" | "seek-content" | "read-content";

/** Longest lookbehind needed to re-match a key split across two chunks. */
const KEY_LOOKBEHIND = 24;

const PATH_KEY = /"path"\s*:\s*"/g;
const CONTENT_KEY = /"content"\s*:\s*"/g;

interface StringScan {
  /** Decoded text produced by this pass. */
  text: string;
  /** How many characters of the input were consumed. */
  consumed: number;
  /** True when the closing quote was reached. */
  closed: boolean;
}

/**
 * Reads as much of a JSON string body as is unambiguously complete.
 * Stops before a truncated escape sequence so the caller can retry with more
 * input rather than emitting a mangled character.
 */
function scanStringBody(input: string): StringScan {
  let text = "";
  let index = 0;

  while (index < input.length) {
    const char = input[index];

    if (char === '"') {
      return { text, consumed: index + 1, closed: true };
    }

    if (char !== "\\") {
      text += char;
      index += 1;
      continue;
    }

    // Escape sequence. Bail out if it is not fully present yet.
    if (index + 1 >= input.length) break;
    const escape = input[index + 1];

    if (escape === "u") {
      if (index + 6 > input.length) break;
      const hex = input.slice(index + 2, index + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
        // Malformed. Pass it through literally instead of throwing: the
        // authoritative parse will surface the real error.
        text += input.slice(index, index + 6);
        index += 6;
        continue;
      }
      text += String.fromCharCode(Number.parseInt(hex, 16));
      index += 6;
      continue;
    }

    const simple: Record<string, string> = {
      '"': '"',
      "\\": "\\",
      "/": "/",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
    };
    text += simple[escape] ?? escape;
    index += 2;
  }

  return { text, consumed: index, closed: false };
}

export class AgentStreamParser {
  private buffer = "";
  private phase: Phase = "seek-path";
  private path = "";

  /** Feeds a chunk of raw model output and returns whatever became knowable. */
  push(chunk: string): StreamDelta[] {
    this.buffer += chunk;
    const deltas: StreamDelta[] = [];

    for (;;) {
      if (this.phase === "seek-path" || this.phase === "seek-content") {
        const pattern = this.phase === "seek-path" ? PATH_KEY : CONTENT_KEY;
        pattern.lastIndex = 0;
        const match = pattern.exec(this.buffer);
        if (!match) {
          // Keep just enough tail to re-match a key straddling the boundary.
          if (this.buffer.length > KEY_LOOKBEHIND) {
            this.buffer = this.buffer.slice(-KEY_LOOKBEHIND);
          }
          return deltas;
        }
        this.buffer = this.buffer.slice(match.index + match[0].length);
        this.phase = this.phase === "seek-path" ? "read-path" : "read-content";
        continue;
      }

      const scan = scanStringBody(this.buffer);

      if (this.phase === "read-path") {
        this.path += scan.text;
        this.buffer = this.buffer.slice(scan.consumed);
        if (!scan.closed) return deltas;
        deltas.push({ type: "file-open", path: this.path });
        this.phase = "seek-content";
        continue;
      }

      // read-content
      this.buffer = this.buffer.slice(scan.consumed);
      if (scan.text) {
        deltas.push({ type: "file-delta", path: this.path, text: scan.text });
      }
      if (!scan.closed) return deltas;
      deltas.push({ type: "file-close", path: this.path });
      this.path = "";
      this.phase = "seek-path";
    }
  }

  /** Closes an unterminated file so the UI never shows a dangling cursor. */
  end(): StreamDelta[] {
    if (this.phase === "read-content" || this.phase === "seek-content") {
      const path = this.path;
      this.path = "";
      this.phase = "seek-path";
      return [{ type: "file-close", path }];
    }
    return [];
  }
}
