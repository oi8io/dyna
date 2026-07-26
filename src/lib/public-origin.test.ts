import { afterEach, describe, expect, it } from "vitest";

import { resolvePublicOrigin } from "@/lib/public-origin";

const original = process.env.NEXT_PUBLIC_APP_URL;

afterEach(() => {
  if (original === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = original;
});

function requestWith(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { headers });
}

describe("resolvePublicOrigin", () => {
  it("prefers the configured public URL over the internal listener", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://dyna.example.com";
    expect(
      resolvePublicOrigin(requestWith("http://localhost:8080/auth/callback")),
    ).toBe("https://dyna.example.com");
  });

  it("ignores a path on the configured URL and keeps only the origin", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://dyna.example.com/some/path";
    expect(
      resolvePublicOrigin(requestWith("http://localhost:8080/x")),
    ).toBe("https://dyna.example.com");
  });

  it("falls back to forwarding headers when nothing is configured", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(
      resolvePublicOrigin(
        requestWith("http://localhost:8080/auth/callback", {
          "x-forwarded-host": "dyna.up.railway.app",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe("https://dyna.up.railway.app");
  });

  it("takes the client-most entry when proxies chained the header", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(
      resolvePublicOrigin(
        requestWith("http://localhost:8080/x", {
          "x-forwarded-host": "dyna.example.com, internal.proxy",
          "x-forwarded-proto": "https, http",
        }),
      ),
    ).toBe("https://dyna.example.com");
  });

  it("assumes https when a forwarded host arrives without a scheme", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(
      resolvePublicOrigin(
        requestWith("http://localhost:8080/x", {
          "x-forwarded-host": "dyna.example.com",
        }),
      ),
    ).toBe("https://dyna.example.com");
  });

  it("uses the request itself in local development", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(resolvePublicOrigin(requestWith("http://localhost:3000/x"))).toBe(
      "http://localhost:3000",
    );
  });

  it("does not let a malformed configured value break sign-in", () => {
    process.env.NEXT_PUBLIC_APP_URL = "not a url";
    expect(resolvePublicOrigin(requestWith("http://localhost:3000/x"))).toBe(
      "http://localhost:3000",
    );
  });

  it("is not influenced by a forwarded header once a URL is configured", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://dyna.example.com";
    expect(
      resolvePublicOrigin(
        requestWith("http://localhost:8080/x", {
          "x-forwarded-host": "attacker.example.net",
        }),
      ),
    ).toBe("https://dyna.example.com");
  });
});
