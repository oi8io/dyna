import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase/migrations");
const migration = readdirSync(MIGRATIONS_DIR)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"))
  .join("\n");

function functionBody(name: string) {
  const start = migration.lastIndexOf(
    `create or replace function public.${name}(`,
  );
  expect(start, `${name} is not defined in any migration`).toBeGreaterThan(-1);
  return migration.slice(start, migration.indexOf("$$;", start));
}

/**
 * A generation now spans several requests, so its intermediate state lives on
 * a row that the client knows the id of. These guards keep that row from
 * becoming a way to write into someone else's run.
 */
describe("cross-request generation state", () => {
  it("scopes plan writes to the caller's own running job", () => {
    const body = functionBody("save_generation_plan");
    expect(body).toContain("user_id = caller");
    expect(body).toContain("status = 'running'");
    expect(body).toContain("job_not_found");
  });

  it("scopes draft writes the same way", () => {
    const body = functionBody("save_generation_draft");
    expect(body).toContain("user_id = caller");
    expect(body).toContain("status = 'running'");
    expect(body).toContain("job_not_found");
  });

  it("requires authentication for both writers", () => {
    for (const name of ["save_generation_plan", "save_generation_draft"]) {
      expect(functionBody(name)).toContain("authentication_required");
    }
  });

  it("merges drafts rather than replacing the whole map", () => {
    // Replacing would drop every file written by the preceding steps.
    expect(functionBody("save_generation_draft")).toContain(
      "coalesce(draft_files, '{}'::jsonb)",
    );
  });

  it("bounds a single draft so one step cannot bloat the row", () => {
    expect(functionBody("save_generation_draft")).toContain("draft_too_large");
  });

  it("does not grant the writers to anonymous callers", () => {
    expect(migration).toContain(
      "grant execute on function public.save_generation_draft(uuid, text, text) to authenticated;",
    );
    expect(migration).not.toContain(
      "grant execute on function public.save_generation_draft(uuid, text, text) to anon",
    );
  });

  it("pins an empty search_path on both writers", () => {
    for (const name of ["save_generation_plan", "save_generation_draft"]) {
      expect(functionBody(name)).toContain("set search_path = ''");
    }
  });
});
