import { describe, expect, it } from "vitest";

import { validateStandaloneHtml } from "./validation";

const safeHtml = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; base-uri 'none'"><script>console.log('ok')</script>`;

describe("standalone preview policy", () => {
  it("accepts a self-contained artifact", () => {
    expect(() => validateStandaloneHtml(safeHtml)).not.toThrow();
  });

  it.each([
    "<script src='https://evil.example/x.js'></script>",
    "<img src='http://evil.example/a.png'>",
    "<link href='https://evil.example/x.css'>",
  ])("rejects a remote resource: %s", (resource) => {
    expect(() => validateStandaloneHtml(`${safeHtml}${resource}`)).toThrow(
      "may not load remote resources",
    );
  });

  it("rejects a relative external script", () => {
    expect(() =>
      validateStandaloneHtml(`${safeHtml}<script src='src/game.js'></script>`),
    ).toThrow("must be a single file");
  });

  it("rejects a misleading none directive that also allows network", () => {
    expect(() =>
      validateStandaloneHtml(
        safeHtml.replace(
          "connect-src 'none'",
          "connect-src 'none' https:",
        ),
      ),
    ).toThrow("connect-src");
  });
});
