"use client";

import { GitFork, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";
import { translateError } from "@/lib/i18n/dictionary";

export function RemixButton({
  slug,
  signedIn,
}: {
  slug: string;
  signedIn: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<string>();

  async function remix() {
    if (busy) return;
    if (!signedIn) {
      router.push(`/login?next=/play/${slug}`);
      return;
    }
    setBusy(true);
    setErrorCode(undefined);

    const response = await fetch(`/api/works/${slug}/remix`, {
      method: "POST",
    });
    const result = (await response.json()) as {
      projectId?: string;
      code?: string;
    };
    if (!response.ok || !result.projectId) {
      setErrorCode(result.code ?? "remix_failed");
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
        {busy ? t.gallery.remixing : t.gallery.remix}
      </Button>
      {errorCode && (
        <p className="text-xs text-accent-hover">
          {translateError(t, errorCode)}
        </p>
      )}
    </div>
  );
}
