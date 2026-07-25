import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase/migrations");

const files = readdirSync(MIGRATIONS_DIR)
  .filter((file) => file.endsWith(".sql"))
  .sort();
const migration = files
  .map((file) => readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"))
  .join("\n");

function functionBody(name: string) {
  const start = migration.lastIndexOf(
    `create or replace function public.${name}(`,
  );
  expect(start, `${name} is not defined in any migration`).toBeGreaterThan(-1);
  return migration.slice(start, migration.indexOf("$$;", start));
}

describe("stale generation reaper", () => {
  it("releases the reserved budget it frees", () => {
    const body = functionBody("reap_stale_generations");
    expect(body).toContain("update public.app_budget");
    expect(body).toContain("reserved_usd = greatest(0, reserved_usd - released)");
  });

  it("only reaps jobs that were never settled", () => {
    expect(functionBody("reap_stale_generations")).toContain(
      "where status in ('queued', 'running')",
    );
  });

  it("clears projects left mid-generation", () => {
    expect(functionBody("reap_stale_generations")).toContain(
      "where p.status = 'generating'",
    );
  });
});

describe("reserve_generation after the reaper was added", () => {
  const body = functionBody("reserve_generation");

  // A later migration redefines this function wholesale. Rebuilding it is an
  // easy way to silently drop a guard, so each one is pinned here.
  it("still short-circuits on a replayed idempotency key", () => {
    expect(body).toContain("where user_id = caller and idempotency_key = p_idempotency_key");
    expect(body).toContain("return existing;");
  });

  it("still bounds the reservation amount", () => {
    expect(body).toContain("p_reserved_usd <= 0 or p_reserved_usd > 1");
  });

  it("still rate-limits to two reservations per minute", () => {
    expect(body).toContain("interval '1 minute'");
    expect(body).toContain(") >= 2 then");
  });

  it("still refuses when the global budget or credits are exhausted", () => {
    expect(body).toContain("global_budget_exhausted");
    expect(body).toContain("create_credit_exhausted");
    expect(body).toContain("edit_credit_exhausted");
    expect(body).toContain("generation_disabled");
  });

  it("reaps after the idempotency check, so replays keep their job", () => {
    const replayAt = body.indexOf("return existing;");
    const reapAt = body.indexOf("perform public.reap_stale_generations()");
    expect(reapAt).toBeGreaterThan(replayAt);
  });
});
