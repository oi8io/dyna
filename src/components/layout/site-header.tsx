import Link from "next/link";

import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { buttonVariants } from "@/components/ui/button";
import { getDictionary } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export async function SiteHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const t = await getDictionary();

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-canvas/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 lg:px-8">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="font-serif text-xl tracking-tight text-ink">Dyna</span>
          <span className="text-[13px] text-ink-faint">Studio</span>
        </Link>

        <nav className="flex items-center gap-1">
          <Link
            href="/#gallery"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          >
            {t.nav.gallery}
          </Link>
          <Link
            href="/#how"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          >
            {t.nav.how}
          </Link>
          {user ? (
            <Link
              href="/builder"
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
            >
              {t.nav.workbench}
            </Link>
          ) : (
            <Link
              href="/login"
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
            >
              {t.nav.signIn}
            </Link>
          )}
          {/* Last: it is settings, not navigation, and putting it ahead of the
              links gave a control nobody touches twice the prominence of the
              ones they came for. */}
          <LocaleSwitcher className="ml-1" />
        </nav>
      </div>
    </header>
  );
}
