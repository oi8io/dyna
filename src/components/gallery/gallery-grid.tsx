import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { intlLocale } from "@/lib/i18n/dictionary";
import { getI18n } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import type { GalleryItem } from "@/types/database";

export async function GalleryGrid({ limit = 12 }: { limit?: number }) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_gallery", {
    p_limit: limit,
    p_offset: 0,
  });
  const items = (data ?? []) as GalleryItem[];
  const { locale, t } = await getI18n();
  // Titles and author names are user content and stay exactly as written. Only
  // the chrome around them follows the reader's language, so a mixed-language
  // gallery is the expected result rather than a bug.
  const intl = intlLocale(locale);

  if (!items.length) {
    return (
      <p className="rounded-xl border border-dashed border-line-strong px-5 py-8 text-center text-sm text-ink-soft">
        {t.gallery.empty}
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
                <Badge>{t.common.remixable}</Badge>
              ) : (
                <Badge variant="outline">{t.common.playOnly}</Badge>
              )}
              <span className="ml-auto text-xs text-ink-faint">
                {new Date(item.published_at).toLocaleDateString(intl)}
              </span>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}
