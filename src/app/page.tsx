import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { GalleryGrid } from "@/components/gallery/gallery-grid";
import { SiteHeader } from "@/components/layout/site-header";
import { buttonVariants } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

const examples = [
  "做一个霓虹风格的打砖块，加入连击和粒子效果",
  "生成一个 2048，但数字是不同等级的行星",
  "做一个反应力小游戏：躲开红色方块，坚持 30 秒",
];

const steps = [
  {
    step: "01",
    title: "描述你想要的东西",
    text: "用日常语言写清玩法或画面，不需要懂任何技术名词。",
  },
  {
    step: "02",
    title: "拿到一份真实工程",
    text: "生成的是完整的 React / TypeScript 源码，通过类型检查和生产构建才算数。",
  },
  {
    step: "03",
    title: "边玩边改，然后分享",
    text: "在隔离环境里直接试玩，继续对话调整细节，满意后发布成一条链接。",
  },
];

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="min-h-screen">
      <SiteHeader />

      <section className="mx-auto max-w-3xl px-5 pb-20 pt-20 text-center lg:px-8 lg:pt-28">
        <h1 className="font-serif text-4xl leading-[1.15] tracking-tight text-ink sm:text-5xl">
          把脑子里的想法，
          <br className="hidden sm:block" />
          做成一个能玩的东西
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-[15px] leading-7 text-ink-soft">
          写一句话，Dyna 生成真实的前端工程并完成构建，你可以立刻打开来玩、
          接着改，然后把链接发给任何人。
        </p>

        <form
          action="/builder/new"
          className="mt-10 rounded-xl border border-line-strong bg-surface text-left"
        >
          <label htmlFor="prompt" className="sr-only">
            描述你想创建的作品
          </label>
          <textarea
            id="prompt"
            name="prompt"
            required
            maxLength={800}
            defaultValue={examples[0]}
            className="min-h-24 w-full resize-none bg-transparent px-4 pt-4 text-[15px] leading-7 text-ink outline-none placeholder:text-ink-faint"
          />
          <div className="flex flex-wrap items-center justify-between gap-3 px-3 pb-3">
            <p className="pl-1 text-xs text-ink-faint">
              轻量 2D 单人游戏 · 无需上传素材
            </p>
            <button className={cn(buttonVariants())}>
              开始制作
              <ArrowRight className="size-4" />
            </button>
          </div>
        </form>

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {examples.slice(1).map((example) => (
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
              大家做的东西
            </h2>
            <p className="text-sm text-ink-soft">
              点开就能玩，公开源码的作品可以 Remix 成你自己的
            </p>
          </div>
          <Suspense
            fallback={<p className="text-sm text-ink-faint">加载中…</p>}
          >
            <GalleryGrid />
          </Suspense>
        </div>
      </section>

      <section id="how" className="border-t border-line bg-canvas-sunken">
        <div className="mx-auto max-w-5xl px-5 py-20 lg:px-8">
          <h2 className="font-serif text-2xl tracking-tight text-ink sm:text-3xl">
            它是怎么工作的
          </h2>
          <div className="mt-10 grid gap-10 sm:grid-cols-3">
            {steps.map((item) => (
              <div key={item.step}>
                <span className="font-serif text-sm text-accent">{item.step}</span>
                <h3 className="mt-3 font-medium text-ink">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-ink-soft">{item.text}</p>
              </div>
            ))}
          </div>

          <div className="mt-14 border-t border-line pt-10">
            {user ? (
              <Link href="/builder" className={cn(buttonVariants({ size: "lg" }))}>
                进入我的工作台
                <ArrowRight className="size-4" />
              </Link>
            ) : (
              <Link href="/login" className={cn(buttonVariants({ size: "lg" }))}>
                登录后开始
                <ArrowRight className="size-4" />
              </Link>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
