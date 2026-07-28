import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { LoginForm } from "@/components/auth/login-form";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { Card } from "@/components/ui/card";
import { getDictionary } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getDictionary();
  return { title: t.metadata.login };
}

export default async function LoginPage() {
  const t = await getDictionary();

  return (
    <main className="grid min-h-screen place-items-center px-5 py-16">
      <div className="w-full max-w-md">
        <Link href="/" className="mx-auto flex w-fit items-baseline gap-2">
          <span className="font-serif text-2xl tracking-tight text-ink">Dyna</span>
          <span className="text-sm text-ink-faint">Studio</span>
        </Link>
        <Card className="mt-7 p-7">
          <h1 className="font-serif text-2xl tracking-tight text-ink">
            {t.login.title}
          </h1>
          <p className="mt-2 text-sm leading-6 text-ink-soft">{t.login.subtitle}</p>
          <div className="mt-7">
            <Suspense
              fallback={<p className="text-sm text-ink-faint">{t.common.loading}</p>}
            >
              <LoginForm />
            </Suspense>
          </div>
        </Card>
        <p className="mt-5 text-center text-xs text-ink-faint">{t.login.footnote}</p>
        {/* Sign-in is where someone lands from a shared link, and it is the one
            page with no header — so the switcher has to live here too. It opens
            upward: the card sits low enough that a downward list would be cut
            off on a short viewport. */}
        <div className="mt-4 flex justify-center">
          <LocaleSwitcher side="top" align="start" />
        </div>
      </div>
    </main>
  );
}
