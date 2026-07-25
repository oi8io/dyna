"use client";

import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

/**
 * A single shiki instance shared by every code view.
 *
 * Fine-grained bundle on purpose: importing `shiki` wholesale pulls in ~200
 * grammars. This project only ever renders the file types its own template
 * allows, so only those grammars are loaded.
 *
 * The JavaScript regex engine is used instead of the oniguruma WASM build so
 * nothing has to be fetched at runtime — the app's CSP allows scripts from
 * 'self' only, and a WASM download would be one more thing to get right.
 */

const THEME = "github-light";

let instance: Promise<HighlighterCore> | undefined;

function loadHighlighter() {
  instance ??= createHighlighterCore({
    themes: [import("@shikijs/themes/github-light")],
    langs: [
      import("@shikijs/langs/tsx"),
      import("@shikijs/langs/typescript"),
      import("@shikijs/langs/css"),
      import("@shikijs/langs/json"),
    ],
    engine: createJavaScriptRegexEngine(),
  });
  return instance;
}

export type SupportedLang = "tsx" | "typescript" | "css" | "json" | "text";

export function langForPath(path: string): SupportedLang {
  if (path.endsWith(".tsx") || path.endsWith(".jsx")) return "tsx";
  if (path.endsWith(".ts")) return "typescript";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".json")) return "json";
  return "text";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Returns one HTML string per line. Lines are kept separate so the caller can
 * pair them with a gutter without shiki's own `<pre>` wrapper getting involved.
 */
export async function highlightLines(
  code: string,
  lang: SupportedLang,
): Promise<string[]> {
  const lines = code.split("\n");
  if (lang === "text") return lines.map(escapeHtml);

  try {
    const highlighter = await loadHighlighter();
    const html = highlighter.codeToHtml(code, {
      lang,
      theme: THEME,
      structure: "inline",
    });
    return html.split("\n");
  } catch {
    // A grammar failure must never blank out the editor.
    return lines.map(escapeHtml);
  }
}
