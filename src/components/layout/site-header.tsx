import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export async function SiteHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
            作品
          </Link>
          <Link
            href="/#how"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          >
            怎么用
          </Link>
          {user ? (
            <Link
              href="/builder"
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
            >
              进入工作台
            </Link>
          ) : (
            <Link
              href="/login"
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
            >
              登录
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
