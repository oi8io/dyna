import { ArrowRight, Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { intlLocale } from "@/lib/i18n/dictionary";
import { getI18n } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { Project } from "@/types/database";

export default async function BuilderDashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/builder");

  const { data: projects } = await supabase
    .from("projects")
    .select("*")
    .neq("status", "archived")
    .order("updated_at", { ascending: false });
  const rows = (projects ?? []) as Project[];
  const { locale, t } = await getI18n();
  const intl = intlLocale(locale);

  return (
    // Credits, account and mode now live in the sidebar's user card; repeating
    // them here would give the same number two places to disagree.
    <div className="mx-auto max-w-5xl px-5 py-12 lg:px-8">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-5 border-b border-line pb-8">
        <div>
          <h1 className="font-serif text-3xl tracking-tight text-ink">
            {t.projects.title}
          </h1>
          <p className="mt-2 text-sm leading-6 text-ink-soft">
            {t.projects.subtitle}
          </p>
        </div>
        <Link href="/builder/new" className={cn(buttonVariants())}>
          <Plus className="size-4" />
          {t.nav.newProject}
        </Link>
      </div>

      {rows.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((project) => (
            <Link key={project.id} href={`/builder/${project.id}`}>
              <Card className="group flex h-full flex-col justify-between p-5 transition-colors hover:border-line-strong hover:bg-canvas-sunken">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="line-clamp-2 font-medium leading-6 text-ink">
                    {project.title}
                  </h2>
                  <Badge variant="outline">{project.status}</Badge>
                </div>
                <div className="mt-8 flex items-center gap-2 text-xs text-ink-faint">
                  {project.forked_from && <Badge variant="outline">Remix</Badge>}
                  <span className="ml-auto">
                    {new Date(project.updated_at).toLocaleDateString(intl)}
                  </span>
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-line-strong p-8 text-center">
          <div>
            <h2 className="font-serif text-lg text-ink">
              {t.projects.emptyTitle}
            </h2>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-ink-soft">
              {t.projects.emptyText}
            </p>
            <Link
              href="/builder/new"
              className={cn(buttonVariants({ size: "sm" }), "mt-5")}
            >
              {t.projects.emptyAction}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
