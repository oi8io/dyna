import { ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { intlLocale } from "@/lib/i18n/dictionary";
import { getI18n } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { PublishedGame } from "@/types/database";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.metadata.published };
}

export default async function ArtifactsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/artifacts");

  const { data } = await supabase
    .from("published_games")
    .select("id, project_id, slug, title, visibility, is_active, published_at")
    .eq("owner_id", user.id)
    .eq("is_active", true)
    .order("published_at", { ascending: false });
  const artifacts = (data ?? []) as Array<
    Pick<
      PublishedGame,
      | "id"
      | "project_id"
      | "slug"
      | "title"
      | "visibility"
      | "is_active"
      | "published_at"
    >
  >;
  const { locale, t } = await getI18n();
  const intl = intlLocale(locale);

  return (
    <div className="mx-auto max-w-5xl px-5 py-12 lg:px-8">
      <div className="mb-10 border-b border-line pb-8">
        <h1 className="font-serif text-3xl tracking-tight text-ink">
          {t.artifacts.title}
        </h1>
        <p className="mt-2 text-sm leading-6 text-ink-soft">
          {t.artifacts.subtitle}
        </p>
      </div>

      {artifacts.length ? (
        <ul className="space-y-3">
          {artifacts.map((artifact) => (
            <li key={artifact.id}>
              <Card className="flex flex-wrap items-center gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">{artifact.title}</p>
                  <p className="mt-1 truncate font-mono text-xs text-ink-faint">
                    /play/{artifact.slug}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {artifact.visibility === "public" ? (
                    <Badge>{t.common.remixable}</Badge>
                  ) : (
                    <Badge variant="outline">{t.common.playOnly}</Badge>
                  )}
                  <span className="text-xs text-ink-faint">
                    {new Date(artifact.published_at).toLocaleDateString(intl)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/builder/${artifact.project_id}`}
                    className={cn(
                      buttonVariants({ variant: "secondary", size: "sm" }),
                    )}
                  >
                    {t.artifacts.edit}
                  </Link>
                  <Link
                    href={`/play/${artifact.slug}`}
                    target="_blank"
                    className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                  >
                    {t.artifacts.open}
                    <ArrowUpRight className="size-3.5" />
                  </Link>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <div className="grid min-h-56 place-items-center rounded-xl border border-dashed border-line-strong p-8 text-center">
          <div>
            <h2 className="font-serif text-lg text-ink">
              {t.artifacts.emptyTitle}
            </h2>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-ink-soft">
              {t.artifacts.emptyText}
            </p>
            <Link
              href="/builder"
              className={cn(buttonVariants({ size: "sm" }), "mt-5")}
            >
              {t.artifacts.emptyAction}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
