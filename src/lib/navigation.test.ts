import { describe, expect, it } from "vitest";

import { toSafeInternalPath } from "./navigation";

describe("toSafeInternalPath", () => {
  it("keeps a local route", () => {
    expect(toSafeInternalPath("/builder/123?tab=code")).toBe(
      "/builder/123?tab=code",
    );
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "builder",
    null,
  ])("rejects an external or malformed redirect: %s", (value) => {
    expect(toSafeInternalPath(value)).toBe("/builder");
  });
});
