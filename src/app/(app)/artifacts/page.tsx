import { ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { PublishedGame } from "@/types/database";

export const metadata: Metadata = { title: "已发布" };

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

  return (
    <div className="mx-auto max-w-5xl px-5 py-12 lg:px-8">
      <div className="mb-10 border-b border-line pb-8">
        <h1 className="font-serif text-3xl tracking-tight text-ink">已发布</h1>
        <p className="mt-2 text-sm leading-6 text-ink-soft">
          发出去的链接永久有效，之后怎么改都不会影响它。首页只展示每个作品最新的那一版。
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
                    <Badge>可 Remix</Badge>
                  ) : (
                    <Badge variant="outline">仅试玩</Badge>
                  )}
                  <span className="text-xs text-ink-faint">
                    {new Date(artifact.published_at).toLocaleDateString("zh-CN")}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/builder/${artifact.project_id}`}
                    className={cn(
                      buttonVariants({ variant: "secondary", size: "sm" }),
                    )}
                  >
                    编辑
                  </Link>
                  <Link
                    href={`/play/${artifact.slug}`}
                    target="_blank"
                    className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                  >
                    打开
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
            <h2 className="font-serif text-lg text-ink">还没有发布过东西</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-ink-soft">
              作品在发布之前完全私有，不会出现在任何公共列表里。
            </p>
            <Link
              href="/builder"
              className={cn(buttonVariants({ size: "sm" }), "mt-5")}
            >
              去我的作品
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
