import { describe, expect, it } from "vitest";

import { escapeHtml, escapeLines, langForPath } from "@/components/code/highlighter";

describe("escapeHtml", () => {
  it("escapes the characters that can open a tag", () => {
    expect(escapeHtml("<span>")).toBe("&lt;span&gt;");
    expect(escapeHtml("a && b")).toBe("a &amp;&amp; b");
  });

  it("escapes the ampersand before it can be reintroduced", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });
});

describe("escapeLines", () => {
  it("returns one entry per line and keeps blank lines", () => {
    expect(escapeLines("a\n\nb")).toEqual(["a", "", "b"]);
  });

  /**
   * The bug this guards: these lines are handed to `dangerouslySetInnerHTML`,
   * and the project template's own `index.html` contains a closing script tag.
   * Emitting it raw closed the inline script carrying the RSC payload, so React
   * never hydrated the builder and every control on the page was inert.
   */
  it("never emits a sequence that can close a script element", () => {
    const indexHtml = `<script>console.log(1)<\/script>`;
    for (const line of escapeLines(indexHtml)) {
      expect(line.toLowerCase()).not.toContain("</script");
      expect(line).not.toContain("<!--");
    }
  });

  it("neutralises an html comment that would otherwise be swallowed", () => {
    expect(escapeLines("<!-- DYNA_STYLE -->")).toEqual([
      "&lt;!-- DYNA_STYLE --&gt;",
    ]);
  });
});

describe("langForPath", () => {
  it("maps the file types the template allows", () => {
    expect(langForPath("src/App.tsx")).toBe("tsx");
    expect(langForPath("src/game/engine.ts")).toBe("typescript");
    expect(langForPath("src/styles.css")).toBe("css");
    expect(langForPath("package.json")).toBe("json");
  });

  it("falls back to plain text, which is escaped rather than highlighted", () => {
    expect(langForPath("index.html")).toBe("text");
    expect(langForPath("build.mjs")).toBe("text");
  });
});
