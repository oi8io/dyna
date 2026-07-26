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
 * A run has to be resumable from wherever it stopped, and the state at that
 * point has to be readable. Losing a finished plan because a later stage failed
 * costs the user a paid call and returns different code on the retry.
 */
describe("resumable generations", () => {
  it("commits the checkpoint and the stage in one write", () => {
    // Two writes would let a crash between them leave a run claiming to have
    // finished work whose output was never stored.
    const body = functionBody("checkpoint_generation");
    expect(body).toContain("update public.generation_jobs");
    expect(body).toContain("stage = p_stage");
    expect(body).toContain("plan = coalesce(p_plan, plan)");
    expect(body).toContain("draft_files = coalesce(p_draft_files, draft_files)");
  });

  it("lets a stage overwrite only what it produced", () => {
    // Every payload is optional; a build checkpoint must not blank the plan.
    const body = functionBody("checkpoint_generation");
    expect(body).toContain("coalesce(p_artifact_html, draft_artifact_html)");
  });

  it("scopes checkpoint writes to the caller's own unfinished run", () => {
    const body = functionBody("checkpoint_generation");
    expect(body).toContain("user_id = caller");
    expect(body).toContain("stage not in ('succeeded', 'failed')");
    expect(body).toContain("job_not_resumable");
  });

  it("counts attempts only when something went wrong", () => {
    const body = functionBody("checkpoint_generation");
    expect(body).toContain(
      "attempts = case when p_error is null then attempts else attempts + 1 end",
    );
  });

  it("only offers a run that still has work left", () => {
    const body = functionBody("find_resumable_generation");
    expect(body).toContain("stage not in ('succeeded', 'failed')");
    expect(body).toContain("j.user_id = (select auth.uid())");
  });

  it("reports enough to describe the checkpoint without opening it", () => {
    const body = functionBody("find_resumable_generation");
    for (const column of ["stage", "attempts", "last_error", "file_count"]) {
      expect(body).toContain(column);
    }
  });

  it("marks reaped runs as finished so they stop being offered", () => {
    // Otherwise an abandoned run stays resumable forever.
    expect(functionBody("reap_stale_generations")).toContain("stage = 'failed'");
  });

  it("still releases the budget a reaped run was holding", () => {
    const body = functionBody("reap_stale_generations");
    expect(body).toContain("reserved_usd = greatest(0, reserved_usd - released)");
  });

  it("pins an empty search_path on the new functions", () => {
    for (const name of ["checkpoint_generation", "find_resumable_generation"]) {
      expect(functionBody(name)).toContain("set search_path = ''");
    }
  });

  it("does not grant the checkpoint writer to anonymous callers", () => {
    expect(migration).not.toMatch(
      /grant execute on function public\.checkpoint_generation[\s\S]{0,120}to anon/,
    );
  });
});
