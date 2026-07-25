import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import type { GalleryItem } from "@/types/database";

export async function GalleryGrid({ limit = 12 }: { limit?: number }) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_gallery", {
    p_limit: limit,
    p_offset: 0,
  });
  const items = (data ?? []) as GalleryItem[];

  if (!items.length) {
    return (
      <p className="rounded-xl border border-dashed border-line-strong px-5 py-8 text-center text-sm text-ink-soft">
        还没有人发布作品。做一个，然后点发布，它就会出现在这里。
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <Link key={item.slug} href={`/play/${item.slug}`}>
          <Card className="group flex h-full flex-col justify-between p-5 text-left transition-colors hover:border-line-strong hover:bg-canvas-sunken">
            <div>
              <h3 className="line-clamp-2 font-medium leading-6 text-ink">
                {item.title}
              </h3>
              <p className="mt-2 text-sm text-ink-soft">{item.author}</p>
            </div>
            <div className="mt-8 flex items-center gap-2">
              {item.is_remix && <Badge variant="outline">Remix</Badge>}
              {item.visibility === "public" ? (
                <Badge>可 Remix</Badge>
              ) : (
                <Badge variant="outline">仅试玩</Badge>
              )}
              <span className="ml-auto text-xs text-ink-faint">
                {new Date(item.published_at).toLocaleDateString("zh-CN")}
              </span>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}
