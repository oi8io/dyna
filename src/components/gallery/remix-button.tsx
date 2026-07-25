"use client";

import { GitFork, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export function RemixButton({
  slug,
  signedIn,
}: {
  slug: string;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function remix() {
    if (busy) return;
    if (!signedIn) {
      router.push(`/login?next=/play/${slug}`);
      return;
    }
    setBusy(true);
    setError(undefined);

    const response = await fetch(`/api/works/${slug}/remix`, {
      method: "POST",
    });
    const result = (await response.json()) as {
      projectId?: string;
      error?: string;
    };
    if (!response.ok || !result.projectId) {
      setError(result.error ?? "Remix 失败。");
      setBusy(false);
      return;
    }
    router.push(`/builder/${result.projectId}`);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button onClick={remix} disabled={busy}>
        {busy ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <GitFork className="size-4" />
        )}
        {busy ? "正在复制…" : "Remix 这个作品"}
      </Button>
      {error && <p className="text-xs text-accent-hover">{error}</p>}
    </div>
  );
}
