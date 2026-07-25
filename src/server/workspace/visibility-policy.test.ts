import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase/migrations");

/**
 * Migrations are replayed in filename order, so a later file redefining a
 * function wins. These invariants must be checked against what actually runs,
 * not against whichever file introduced the function first.
 */
const migration = readdirSync(MIGRATIONS_DIR)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"))
  .join("\n");

function functionBody(name: string) {
  // Anchored on the definition keyword: `grant execute on function …` mentions
  // the same name and would otherwise win a plain lastIndexOf.
  const start = migration.lastIndexOf(
    `create or replace function public.${name}(`,
  );
  expect(start, `${name} is not defined in any migration`).toBeGreaterThan(-1);
  const end = migration.indexOf("$$;", start);
  return migration.slice(start, end);
}

describe("gallery listing", () => {
  it("only lists published snapshots, never raw projects", () => {
    const body = functionBody("list_gallery");
    expect(body).toContain("from public.published_games");
    expect(body).toContain("g.is_active = true");
  });

  it("never selects original_prompt or the artifact", () => {
    const body = functionBody("list_gallery");
    expect(body).not.toContain("original_prompt");
    expect(body).not.toContain("artifact_html");
  });

  it("collapses repeat publishes to one card per project", () => {
    expect(functionBody("list_gallery")).toContain("distinct on (g.project_id)");
  });

  it("is capped so a caller cannot request the whole table", () => {
    expect(functionBody("list_gallery")).toContain("least(");
  });
});

describe("published source", () => {
  it("reads the frozen snapshot rather than the author's live files", () => {
    const body = functionBody("get_published_source");
    expect(body).toContain("v.source_snapshot");
    expect(body).not.toContain("from public.project_files");
  });

  it("returns nothing for a private publication", () => {
    expect(functionBody("get_published_source")).toContain(
      "g.visibility = 'public'",
    );
  });
});

describe("remix", () => {
  it("refuses private publications", () => {
    const body = functionBody("remix_publication");
    expect(body).toContain("v_pub.visibility <> 'public'");
    expect(body).toContain("source_is_private");
  });

  it("requires an authenticated caller", () => {
    expect(functionBody("remix_publication")).toContain("not_authenticated");
  });

  it("carries its own rate guard because it bypasses the credit system", () => {
    expect(functionBody("remix_publication")).toContain(
      "remix_rate_limit_exceeded",
    );
  });

  it("clones the published snapshot, not the author's live project_files", () => {
    const body = functionBody("remix_publication");
    expect(body).toContain("v_version.source_snapshot");
    expect(body).not.toContain("from public.project_files");
  });

  it("does not copy the source project's conversation", () => {
    expect(functionBody("remix_publication")).not.toContain(
      "from public.messages",
    );
  });

  it("does not copy the author's original prompt", () => {
    expect(functionBody("remix_publication")).not.toContain(
      "v_pub.original_prompt",
    );
  });

  it("seeds the fork's brief from the spec goal rather than the title", () => {
    const body = functionBody("remix_publication");
    expect(body).toContain("'SPEC.md'");
    expect(body).toContain("## 目标体验");
    // Falls back to the title only when the snapshot predates SPEC.md.
    expect(body).toContain("coalesce(nullif(v_goal, ''), 'Remix of '");
  });
});

describe("definer functions", () => {
  it("pin an empty search_path", () => {
    for (const name of [
      "list_gallery",
      "get_published_source",
      "remix_publication",
    ]) {
      expect(functionBody(name)).toContain("set search_path = ''");
    }
  });

  it("does not grant remix to anonymous callers", () => {
    expect(migration).toContain(
      "grant execute on function public.remix_publication(text) to authenticated;",
    );
    expect(migration).not.toContain(
      "grant execute on function public.remix_publication(text) to anon",
    );
  });
});

describe("live project files", () => {
  it("stay owner-only — no public read policy is introduced", () => {
    expect(migration).not.toContain("on public.project_files for select");
  });
});
