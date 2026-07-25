import { notFound, redirect } from "next/navigation";

import { BuilderShell } from "@/components/builder/builder-shell";
import { createClient } from "@/lib/supabase/server";
import type {
  Message,
  Project,
  ProjectFile,
  ProjectVersion,
} from "@/types/database";

export default async function BuilderProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/builder/${id}`);

  const { data: projectData } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();
  const project = projectData as Project | null;
  if (!project || project.user_id !== user.id) {
    notFound();
  }

  // A project without a runnable version still renders the full builder: the
  // conversation is where the failure was explained, and hiding it behind a
  // standalone recovery card is what made these projects look inexplicably
  // broken with no way to find the cause.
  const [
    { data: versionData },
    { data: filesData },
    { data: messagesData },
    { data: publishedData },
    { data: failedJob },
  ] = await Promise.all([
    project.current_version_id
      ? supabase
          .from("project_versions")
          .select("*")
          .eq("id", project.current_version_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("project_files")
      .select("*")
      .eq("project_id", project.id)
      .order("path"),
    supabase
      .from("messages")
      .select("*")
      .eq("project_id", project.id)
      .order("created_at"),
    supabase
      .from("published_games")
      .select("slug, visibility")
      .eq("project_id", project.id)
      .eq("is_active", true)
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("generation_jobs")
      .select("error_code")
      .eq("project_id", project.id)
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const version = versionData as ProjectVersion | null;

  return (
    <BuilderShell
      project={project}
      artifactHtml={version?.artifact_html ?? undefined}
      versionNumber={version?.version_number}
      files={(filesData ?? []) as ProjectFile[]}
      messages={(messagesData ?? []) as Message[]}
      buildLog={version?.build_log}
      publishedSlug={publishedData?.slug}
      publishedVisibility={publishedData?.visibility}
      lastErrorCode={failedJob?.error_code ?? undefined}
    />
  );
}
