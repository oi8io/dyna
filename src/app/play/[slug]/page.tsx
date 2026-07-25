import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { RemixButton } from "@/components/gallery/remix-button";
import { SourceBrowser } from "@/components/gallery/source-browser";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/server";
import type { PublishedGame, PublishedSourceFile } from "@/types/database";

async function loadPublication(slug: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("published_games")
    .select("id, owner_id, project_id, title, artifact_html, visibility, published_at")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  return data as Pick<
    PublishedGame,
    | "id"
    | "owner_id"
    | "project_id"
    | "title"
    | "artifact_html"
    | "visibility"
    | "published_at"
  > | null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const work = await loadPublication(slug);
  return { title: work?.title ?? "作品" };
}

export default async function PublishedWorkPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const work = await loadPublication(slug);
  if (!work) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isOwner = user?.id === work.owner_id;
  const isPublic = work.visibility === "public";

  // Reads the frozen snapshot, not the author's live project files. Returns
  // nothing when the publication is private.
  const { data: sourceData } = isPublic
    ? await supabase.rpc("get_published_source", { p_slug: slug })
    : { data: null };
  const files = (sourceData ?? []) as PublishedSourceFile[];

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-5 py-8 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/" className="flex w-fit items-baseline gap-1.5">
            <span className="font-serif text-base tracking-tight text-ink">
              Dyna
            </span>
            <span className="text-xs text-ink-faint">Studio</span>
          </Link>
          <h1 className="mt-3 font-serif text-2xl tracking-tight text-ink">
            {work.title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-faint">
              发布于 {new Date(work.published_at).toLocaleDateString("zh-CN")}
            </span>
            {isPublic ? <Badge>可 Remix</Badge> : <Badge variant="outline">仅试玩</Badge>}
            {isOwner && <Badge variant="outline">你的作品</Badge>}
          </div>
        </div>

        {isOwner ? (
          <Link
            href={`/builder/${work.project_id}`}
            className="inline-flex h-10 items-center rounded-lg border border-line-strong bg-surface px-4 text-sm text-ink hover:bg-canvas-sunken"
          >
            继续编辑
          </Link>
        ) : (
          isPublic && <RemixButton slug={slug} signedIn={Boolean(user)} />
        )}
      </div>

      {/* Height tracks the viewport instead of a fixed 600px so the canvas has
          room on a laptop and does not overflow on a phone. */}
      <div className="mt-6 overflow-hidden rounded-xl border border-line bg-surface">
        <iframe
          title={`${work.title} 公开试玩`}
          srcDoc={work.artifact_html}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          className="h-[min(70vh,640px)] min-h-[420px] w-full border-0 bg-canvas-sunken"
        />
      </div>

      {isPublic ? (
        <SourceBrowser files={files} />
      ) : (
        <p className="mt-6 rounded-lg border border-line bg-canvas-sunken px-4 py-3 text-sm leading-6 text-ink-soft">
          作者没有公开这个作品的源码，所以它可以试玩但不能 Remix。
        </p>
      )}
    </main>
  );
}
