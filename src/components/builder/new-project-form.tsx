"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const examples = [
  "做一个像素风太空射击游戏，击落陨石会积累连击倍率",
  "生成一个双人同屏的霓虹贪吃蛇，支持 WASD 和方向键",
  "做一个治愈系接水果游戏，60 秒计时并记录最高分",
];

export function NewProjectForm({ initialPrompt }: { initialPrompt?: string }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState(
    initialPrompt?.trim().slice(0, 4000) || examples[0],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  /**
   * Creates the project and hands off immediately.
   *
   * Generation used to run here, which meant staring at this form for the
   * couple of minutes a two-stage run takes, and only reaching the editor once
   * everything was already finished. The builder starts the run itself, so the
   * code appears as it is written.
   */
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);

    try {
      const createResponse = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const created = (await createResponse.json()) as {
        projectId?: string;
        error?: string;
      };
      if (!createResponse.ok || !created.projectId) {
        throw new Error(created.error ?? "项目创建失败。");
      }

      router.push(`/builder/${created.projectId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "发生未知错误。");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="overflow-hidden rounded-xl border border-line-strong bg-surface">
        <Textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          disabled={busy}
          maxLength={4000}
          className="min-h-40 resize-none rounded-none border-0 bg-transparent p-5 text-[15px] leading-7 focus:border-0"
          placeholder="一句话描述玩法、风格和规则……"
        />
        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
          <span className="truncate font-mono text-xs text-ink-faint">
            {busy ? "正在打开工作台…" : `${prompt.length}/4000`}
          </span>
          <Button type="submit" disabled={busy || prompt.trim().length < 8}>
            {busy && <LoaderCircle className="size-4 animate-spin" />}
            {busy ? "正在打开…" : "开始制作"}
            {!busy && <ArrowRight className="size-4" />}
          </Button>
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-accent/25 bg-accent-soft px-4 py-3 text-sm text-accent-hover"
        >
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {examples.map((example) => (
          <button
            key={example}
            type="button"
            disabled={busy}
            onClick={() => setPrompt(example)}
            className="rounded-full border border-line bg-canvas-sunken px-3 py-1.5 text-xs text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
          >
            {example.slice(0, 18)}…
          </button>
        ))}
      </div>
    </form>
  );
}
