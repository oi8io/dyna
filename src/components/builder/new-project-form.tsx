"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { runGeneration } from "@/lib/run-generation";
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
  const [phase, setPhase] = useState<string>();
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setPhase(undefined);
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

      // The first generation streams too, but there is no editor to show it in
      // yet — the phase label is enough feedback until the builder opens.
      const generated = await runGeneration({
        projectId: created.projectId,
        prompt,
        kind: "create",
        onEvent: (event) => {
          if (event.type === "phase") setPhase(event.message);
          if (event.type === "file-open") setPhase(`正在写 ${event.path}`);
        },
      });
      if (!generated.ok) {
        throw new Error(generated.error ?? "生成失败。");
      }

      router.push(`/builder/${created.projectId}`);
      router.refresh();
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
            {busy ? (phase ?? "正在启动…") : `${prompt.length}/4000`}
          </span>
          <Button type="submit" disabled={busy || prompt.trim().length < 8}>
            {busy && <LoaderCircle className="size-4 animate-spin" />}
            {busy ? "正在构建…" : "开始制作"}
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
