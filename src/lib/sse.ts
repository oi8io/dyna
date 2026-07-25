/**
 * Minimal server-sent-events framing.
 *
 * `EventSource` cannot issue a POST, so the builder reads the response body
 * with `fetch` instead and decodes frames here. Only the `data:` field is used.
 */

export function encodeSseFrame(payload: unknown): string {
  // A literal newline inside the JSON would split the frame; JSON.stringify
  // already escapes them, but line separators are not escaped by every runtime.
  const json = JSON.stringify(payload)
    .replaceAll(" ", "\\u2028")
    .replaceAll(" ", "\\u2029");
  return `data: ${json}\n\n`;
}

/**
 * Returns a stateful decoder. Chunks may split a frame anywhere, so leftovers
 * are carried until the blank-line terminator arrives.
 */
export function createSseDecoder<T>() {
  let buffer = "";

  return function decode(chunk: string): T[] {
    buffer += chunk;
    const frames: T[] = [];
    let separator = buffer.indexOf("\n\n");

    while (separator !== -1) {
      const frame = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      separator = buffer.indexOf("\n\n");

      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data) continue;

      try {
        frames.push(JSON.parse(data) as T);
      } catch {
        // A frame we cannot parse is dropped rather than killing the stream;
        // the terminal `done`/`error` event is what the caller acts on.
      }
    }

    return frames;
  };
}
