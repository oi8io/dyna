"use client";

import { LoaderCircle, Mail } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { toSafeInternalPath } from "@/lib/navigation";

export function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState<"google" | "email" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const safeNext = toSafeInternalPath(params.get("next"));

  async function signInWithGoogle() {
    setPending("google");
    setMessage(null);
    const supabase = createClient();
    const redirectTo = new URL("/auth/callback", window.location.origin);
    redirectTo.searchParams.set("next", safeNext);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirectTo.toString() },
    });
    if (error) {
      setMessage(error.message);
      setPending(null);
    }
  }

  async function sendMagicLink(event: FormEvent) {
    event.preventDefault();
    setPending("email");
    setMessage(null);
    const supabase = createClient();
    const redirectTo = new URL("/auth/callback", window.location.origin);
    redirectTo.searchParams.set("next", safeNext);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectTo.toString(),
        shouldCreateUser: true,
      },
    });
    setPending(null);
    setMessage(
      error ? error.message : "登录链接已发送，请检查邮箱（也可能在垃圾邮件中）。",
    );
  }

  return (
    <div className="space-y-5">
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        disabled={pending !== null}
        onClick={signInWithGoogle}
      >
        {pending === "google" ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <span className="text-base font-semibold text-accent">G</span>
        )}
        使用 Google 登录
      </Button>

      <div className="flex items-center gap-3 text-xs text-ink-faint">
        <span className="h-px flex-1 bg-line" />
        或使用邮箱
        <span className="h-px flex-1 bg-line" />
      </div>

      <form className="space-y-3" onSubmit={sendMagicLink}>
        <Input
          type="email"
          autoComplete="email"
          required
          value={email}
          placeholder="you@example.com"
          onChange={(event) => setEmail(event.target.value)}
        />
        <Button className="w-full" disabled={pending !== null}>
          {pending === "email" ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Mail className="size-4" />
          )}
          发送登录链接
        </Button>
      </form>

      {message && (
        <p
          role="status"
          className="rounded-lg border border-line bg-canvas-sunken px-4 py-3 text-sm leading-6 text-ink-soft"
        >
          {message}
        </p>
      )}
    </div>
  );
}
