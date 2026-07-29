import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { RemixButton } from "@/components/gallery/remix-button";
import { Badge } from "@/components/ui/badge";
import { intlLocale } from "@/lib/i18n/dictionary";
import { getI18n } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import type { PublishedGame } from "@/types/database";

async function loadPublication(slug: string) {
  const supabase = await createClient();
  // The title is read separately, through a function, because it comes from the
  // project rather than the frozen snapshot — see the migration for why — and
  // `projects` is not readable here: the same row holds `original_prompt`.
  const [{ data }, { data: liveTitle }] = await Promise.all([
    supabase
      .from("published_games")
      .select(
        "id, owner_id, project_id, title, artifact_html, visibility, published_at",
      )
      .eq("slug", slug)
      .eq("is_active", true)
      .maybeSingle(),
    supabase.rpc("get_publication_title", { p_slug: slug }),
  ]);
  if (!data) return null;
  const publication = data as Pick<
    PublishedGame,
    | "id"
    | "owner_id"
    | "project_id"
    | "title"
    | "artifact_html"
    | "visibility"
    | "published_at"
  >;
  return {
    ...publication,
    title:
      typeof liveTitle === "string" && liveTitle ? liveTitle : publication.title,
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const work = await loadPublication(slug);
  const { t } = await getI18n();
  return { title: work?.title ?? t.metadata.work };
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
  // Visibility now gates Remix only. Source is no longer browsable here; a
  // remixer gets it by forking, where it lands in a project of their own.
  const isRemixable = work.visibility === "public";
  const { locale, t } = await getI18n();
  const intl = intlLocale(locale);

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
              {t.play.publishedOn(
                new Date(work.published_at).toLocaleDateString(intl),
              )}
            </span>
            {isRemixable ? (
              <Badge>{t.common.remixable}</Badge>
            ) : (
              <Badge variant="outline">{t.common.playOnly}</Badge>
            )}
            {isOwner && <Badge variant="outline">{t.play.yourWork}</Badge>}
          </div>
        </div>

        {isOwner ? (
          <Link
            href={`/builder/${work.project_id}`}
            className="inline-flex h-10 items-center rounded-lg border border-line-strong bg-surface px-4 text-sm text-ink hover:bg-canvas-sunken"
          >
            {t.play.keepEditing}
          </Link>
        ) : (
          isRemixable && <RemixButton slug={slug} signedIn={Boolean(user)} />
        )}
      </div>

      {/* Height tracks the viewport instead of a fixed 600px so the canvas has
          room on a laptop and does not overflow on a phone. */}
      <div className="mt-6 overflow-hidden rounded-xl border border-line bg-surface">
        <iframe
          title={t.play.frameTitle(work.title)}
          srcDoc={work.artifact_html}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          className="h-[min(70vh,640px)] min-h-[420px] w-full border-0 bg-canvas-sunken"
        />
      </div>

      {!isRemixable && (
        <p className="mt-6 rounded-lg border border-line bg-canvas-sunken px-4 py-3 text-sm leading-6 text-ink-soft">
          {t.play.notRemixable}
        </p>
      )}
    </main>
  );
}
