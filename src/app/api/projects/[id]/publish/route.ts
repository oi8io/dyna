import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api-error";
import { createClient } from "@/lib/supabase/server";

const paramsSchema = z.object({ id: z.uuid() });
const bodySchema = z.object({
  visibility: z.enum(["public", "private"]).default("public"),
});

function slugify(title: string) {
  const stem = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
  return `${stem || "work"}-${crypto.randomUUID().slice(0, 7)}`;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) {
    return apiError("invalid_project_id", 400);
  }
  const body = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) {
    return apiError("invalid_request", 400);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return apiError("not_authenticated", 401);
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, user_id, title, status, current_version_id")
    .eq("id", params.data.id)
    .single();
  if (
    !project ||
    project.user_id !== user.id ||
    !project.current_version_id ||
    project.status !== "ready"
  ) {
    return apiError("no_publishable_version", 409);
  }

  const { data: version } = await supabase
    .from("project_versions")
    .select("id, artifact_html")
    .eq("id", project.current_version_id)
    .single();
  if (!version?.artifact_html) {
    return apiError("artifact_missing", 409);
  }

  // Earlier snapshots stay active on purpose: a shared /play link must keep
  // working forever. The gallery collapses them to one card per project.
  const { data: published, error } = await supabase
    .from("published_games")
    .insert({
      owner_id: user.id,
      project_id: project.id,
      version_id: version.id,
      slug: slugify(project.title),
      title: project.title,
      artifact_html: version.artifact_html,
      visibility: body.data.visibility,
    })
    .select("slug, visibility, version_id")
    .single();
  if (error || !published) {
    return apiError("publish_failed", 500);
  }

  // `versionId` lets the panel tell "published" from "published, then edited"
  // without a reload, which is what decides whether the button is live.
  return NextResponse.json(
    {
      slug: published.slug,
      visibility: published.visibility,
      versionId: published.version_id,
    },
    { status: 201 },
  );
}
