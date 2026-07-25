import { NextResponse } from "next/server";
import { z } from "zod";

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
    return NextResponse.json({ error: "作品参数无效。" }, { status: 400 });
  }
  const body = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: "请求参数无效。" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
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
    return NextResponse.json(
      { error: "作品尚未生成可发布版本。" },
      { status: 409 },
    );
  }

  const { data: version } = await supabase
    .from("project_versions")
    .select("id, artifact_html")
    .eq("id", project.current_version_id)
    .single();
  if (!version?.artifact_html) {
    return NextResponse.json({ error: "预览产物不存在。" }, { status: 409 });
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
    .select("slug, visibility")
    .single();
  if (error || !published) {
    return NextResponse.json({ error: "发布失败，请重试。" }, { status: 500 });
  }

  return NextResponse.json(
    { slug: published.slug, visibility: published.visibility },
    { status: 201 },
  );
}
