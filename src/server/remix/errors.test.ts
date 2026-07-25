import { describe, expect, it } from "vitest";

import { remixErrorResponse } from "@/server/remix/errors";

describe("remixErrorResponse", () => {
  it("refuses to remix a private project with 403", () => {
    const result = remixErrorResponse(
      "new row violates ... source_is_private ...",
    );
    expect(result.status).toBe(403);
    expect(result.error).toContain("源码");
  });

  it("maps a missing runnable version to 409", () => {
    expect(remixErrorResponse("source_not_remixable").status).toBe(409);
  });

  it("maps the abuse guard to 429", () => {
    expect(remixErrorResponse("remix_rate_limit_exceeded").status).toBe(429);
  });

  it("maps an anonymous caller to 401", () => {
    expect(remixErrorResponse("not_authenticated").status).toBe(401);
  });

  it("never leaks the raw database message", () => {
    const raw =
      "permission denied for relation project_files at character 42, key=sb_secret_abc";
    const result = remixErrorResponse(raw);
    expect(result.status).toBe(500);
    expect(result.error).not.toContain("sb_secret_abc");
    expect(result.error).not.toContain("project_files");
  });
});
