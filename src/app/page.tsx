import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { GalleryGrid } from "@/components/gallery/gallery-grid";
import { HeroPromptField } from "@/components/home/hero-prompt-field";
import { SiteHeader } from "@/components/layout/site-header";
import { buttonVariants } from "@/components/ui/button";
import { getDictionary } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

/** Fixed across locales; only the copy beside each one is translated. */
const STEP_NUMBERS = ["01", "02", "03"];

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const t = await getDictionary();

  return (
    <main className="min-h-screen">
      <SiteHeader />

      <section className="mx-auto max-w-3xl px-5 pb-20 pt-20 text-center lg:px-8 lg:pt-28">
        <h1 className="font-serif text-4xl leading-[1.15] tracking-tight text-ink sm:text-5xl">
          {t.home.headlineTop}
          <br className="hidden sm:block" />
          {t.home.headlineBottom}
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-[15px] leading-7 text-ink-soft">
          {t.home.subtitle}
        </p>

        <form
          action="/builder/new"
          className="mt-10 rounded-xl border border-line-strong bg-surface text-left"
        >
          <label htmlFor="prompt" className="sr-only">
            {t.home.promptLabel}
          </label>
          <HeroPromptField />
          <div className="flex flex-wrap items-center justify-between gap-3 px-3 pb-3">
            <p className="pl-1 text-xs text-ink-faint">{t.home.promptHint}</p>
            <button className={cn(buttonVariants())}>
              {t.home.start}
              <ArrowRight className="size-4" />
            </button>
          </div>
        </form>

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {t.home.examples.slice(1).map((example) => (
            <span
              key={example}
              className="rounded-full border border-line bg-canvas-sunken px-3 py-1.5 text-xs text-ink-soft"
            >
              {example}
            </span>
          ))}
        </div>
      </section>

      <section id="gallery" className="border-t border-line">
        <div className="mx-auto max-w-6xl px-5 py-16 lg:px-8">
          <div className="mb-8 flex items-baseline justify-between gap-4">
            <h2 className="font-serif text-2xl tracking-tight text-ink">
              {t.home.galleryTitle}
            </h2>
            <p className="text-sm text-ink-soft">{t.home.gallerySubtitle}</p>
          </div>
          <Suspense
            fallback={<p className="text-sm text-ink-faint">{t.common.loading}</p>}
          >
            <GalleryGrid />
          </Suspense>
        </div>
      </section>

      <section id="how" className="border-t border-line bg-canvas-sunken">
        <div className="mx-auto max-w-5xl px-5 py-20 lg:px-8">
          <h2 className="font-serif text-2xl tracking-tight text-ink sm:text-3xl">
            {t.home.howTitle}
          </h2>
          <div className="mt-10 grid gap-10 sm:grid-cols-3">
            {t.home.steps.map((item, index) => (
              <div key={item.title}>
                <span className="font-serif text-sm text-accent">
                  {STEP_NUMBERS[index]}
                </span>
                <h3 className="mt-3 font-medium text-ink">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-ink-soft">{item.text}</p>
              </div>
            ))}
          </div>

          <div className="mt-14 border-t border-line pt-10">
            {user ? (
              <Link href="/builder" className={cn(buttonVariants({ size: "lg" }))}>
                {t.home.enterWorkbench}
                <ArrowRight className="size-4" />
              </Link>
            ) : (
              <Link href="/login" className={cn(buttonVariants({ size: "lg" }))}>
                {t.home.signInToStart}
                <ArrowRight className="size-4" />
              </Link>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
