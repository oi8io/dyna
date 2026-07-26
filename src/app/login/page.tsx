import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { LoginForm } from "@/components/auth/login-form";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = { title: "登录" };

export default function LoginPage() {
  return (
    <main className="grid min-h-screen place-items-center px-5 py-16">
      <div className="w-full max-w-md">
        <Link href="/" className="mx-auto flex w-fit items-baseline gap-2">
          <span className="font-serif text-2xl tracking-tight text-ink">Dyna</span>
          <span className="text-sm text-ink-faint">Studio</span>
        </Link>
        <Card className="mt-7 p-7">
          <h1 className="font-serif text-2xl tracking-tight text-ink">
            登录后开始创作
          </h1>
          <p className="mt-2 text-sm leading-6 text-ink-soft">
            作品、对话、源码和可运行版本都会保存在你的账户里。
          </p>
          <div className="mt-7">
            <Suspense fallback={<p className="text-sm text-ink-faint">加载中…</p>}>
              <LoginForm />
            </Suspense>
          </div>
        </Card>
        <p className="mt-5 text-center text-xs text-ink-faint">
          登录后作品会存在你的账户里
        </p>
      </div>
    </main>
  );
}
