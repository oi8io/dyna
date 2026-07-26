"use client";

import { ExternalLink, LoaderCircle, Rocket } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { WorkVisibility } from "@/types/database";

interface PublishPanelProps {
  projectId: string;
  publishedSlug?: string;
  publishedVisibility?: WorkVisibility;
}

export function PublishPanel({
  projectId,
  publishedSlug: initialSlug,
  publishedVisibility,
}: PublishPanelProps) {
  const [slug, setSlug] = useState(initialSlug);
  const [visibility, setVisibility] = useState<WorkVisibility>(
    publishedVisibility ?? "public",
  );
  const [allowRemix, setAllowRemix] = useState(
    (publishedVisibility ?? "public") === "public",
  );
  const [busy, setBusy] = useState<"publish" | "visibility" | null>(null);
  const [error, setError] = useState<string>();

  async function publish() {
    if (busy) return;
    setBusy("publish");
    setError(undefined);

    const response = await fetch(`/api/projects/${projectId}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        visibility: allowRemix ? "public" : "private",
      }),
    });
    const result = (await response.json()) as {
      slug?: string;
      visibility?: WorkVisibility;
      error?: string;
    };
    if (!response.ok || !result.slug) {
      setError(result.error ?? "发布失败。");
    } else {
      setSlug(result.slug);
      setVisibility(result.visibility ?? "public");
    }
    setBusy(null);
  }

  async function updateVisibility(next: WorkVisibility) {
    if (busy) return;
    setBusy("visibility");
    setError(undefined);

    const response = await fetch(`/api/projects/${projectId}/visibility`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visibility: next }),
    });
    const result = (await response.json()) as {
      visibility?: WorkVisibility;
      error?: string;
    };
    if (!response.ok || !result.visibility) {
      setError(result.error ?? "更新失败。");
    } else {
      setVisibility(result.visibility);
      setAllowRemix(result.visibility === "public");
    }
    setBusy(null);
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        {slug && (
          <Link
            href={`/play/${slug}`}
            target="_blank"
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink hover:bg-canvas-sunken"
          >
            <ExternalLink className="size-4" />
            公开页面
          </Link>
        )}
        <Button onClick={publish} disabled={busy !== null}>
          {busy === "publish" ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Rocket className="size-4" />
          )}
          {slug ? "发布当前版本" : "发布"}
        </Button>
      </div>

      {slug ? (
        <label className="flex items-center gap-2 text-xs text-ink-soft">
          <input
            type="checkbox"
            checked={visibility === "public"}
            disabled={busy !== null}
            onChange={(event) =>
              updateVisibility(event.target.checked ? "public" : "private")
            }
          />
          允许别人查看源码并 Remix
        </label>
      ) : (
        <label className="flex items-center gap-2 text-xs text-ink-soft">
          <input
            type="checkbox"
            checked={allowRemix}
            disabled={busy !== null}
            onChange={(event) => setAllowRemix(event.target.checked)}
          />
          允许别人查看源码并 Remix
        </label>
      )}

      <p className="max-w-xs text-right text-xs text-ink-faint">
        {slug
          ? "发出去的链接永久有效；取消勾选后，之前发出去的也一起收回。"
          : "不发布就没人看得到。"}
      </p>
      {error && <p className="text-xs text-accent-hover">{error}</p>}
    </div>
  );
}
