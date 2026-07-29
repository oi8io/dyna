"use client";

import { Check, ExternalLink, LoaderCircle, Rocket } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";
import { translateError } from "@/lib/i18n/dictionary";
import type { WorkVisibility } from "@/types/database";

interface PublishPanelProps {
  projectId: string;
  /** The version the builder is showing right now. */
  currentVersionId?: string;
  publishedSlug?: string;
  publishedVisibility?: WorkVisibility;
  /** The version behind the newest publication, when there is one. */
  publishedVersionId?: string;
}

/** How long the "published" confirmation stays up before the panel goes quiet. */
const CONFIRMATION_MS = 6000;

/**
 * Publishing controls, sized to sit at the end of the workspace toolbar.
 *
 * Remix is a switch rather than a checkbox behind a menu: it has exactly two
 * states, it is read as often as it is set, and a menu hid whether it was on.
 * The explanation that used to sit under it is the switch's own tooltip, which
 * costs nothing until someone wants it.
 */
export function PublishPanel({
  projectId,
  currentVersionId,
  publishedSlug: initialSlug,
  publishedVisibility,
  publishedVersionId: initialPublishedVersionId,
}: PublishPanelProps) {
  const t = useT();
  const [slug, setSlug] = useState(initialSlug);
  const [visibility, setVisibility] = useState<WorkVisibility>(
    publishedVisibility ?? "public",
  );
  const [allowRemix, setAllowRemix] = useState(
    (publishedVisibility ?? "public") === "public",
  );
  const [publishedVersionId, setPublishedVersionId] = useState(
    initialPublishedVersionId,
  );
  const [busy, setBusy] = useState<"publish" | "visibility" | null>(null);
  const [errorCode, setErrorCode] = useState<string>();
  const [justPublished, setJustPublished] = useState(false);

  // The confirmation is the only thing that tells the user the click landed, so
  // it is a real piece of state rather than a side effect of the slug changing —
  // republishing an already-published project changes nothing else on screen.
  useEffect(() => {
    if (!justPublished) return;
    const timer = setTimeout(() => setJustPublished(false), CONFIRMATION_MS);
    return () => clearTimeout(timer);
  }, [justPublished]);

  // Publishing the same version twice would mint a second link to identical
  // content. The button says so instead of silently doing it.
  const upToDate = Boolean(
    slug && currentVersionId && publishedVersionId === currentVersionId,
  );
  const publishDisabled = busy !== null || upToDate;

  // Before the first publish the switch is only an intent carried into the
  // request; afterwards it writes through to the publication immediately, since
  // that is what actually governs who may remix an already-shared link.
  const remixOn = slug ? visibility === "public" : allowRemix;

  function toggleRemix() {
    if (busy) return;
    if (slug) {
      void updateVisibility(remixOn ? "private" : "public");
      return;
    }
    setAllowRemix(!remixOn);
  }

  async function publish() {
    if (publishDisabled) return;
    setBusy("publish");
    setErrorCode(undefined);
    setJustPublished(false);

    try {
      const response = await fetch(`/api/projects/${projectId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visibility: allowRemix ? "public" : "private",
        }),
      });
      // A gateway timeout or a crash upstream answers with HTML, not JSON.
      // Parsing that used to throw past the `setBusy(null)` below and leave the
      // button spinning for good, which is what "clicking publish does nothing"
      // actually was: it worked once, failed, and was disabled from then on.
      const result = (await response.json().catch(() => ({}))) as {
        slug?: string;
        visibility?: WorkVisibility;
        versionId?: string;
        code?: string;
      };
      if (!response.ok || !result.slug) {
        setErrorCode(result.code ?? "publish_failed");
        return;
      }
      setSlug(result.slug);
      setVisibility(result.visibility ?? "public");
      setPublishedVersionId(result.versionId ?? currentVersionId);
      setJustPublished(true);
    } catch {
      // Offline, DNS, a dropped connection: the request never got an answer.
      setErrorCode("publish_failed");
    } finally {
      setBusy(null);
    }
  }

  async function updateVisibility(next: WorkVisibility) {
    if (busy) return;
    setBusy("visibility");
    setErrorCode(undefined);

    try {
      const response = await fetch(`/api/projects/${projectId}/visibility`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: next }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        visibility?: WorkVisibility;
        code?: string;
      };
      if (!response.ok || !result.visibility) {
        setErrorCode(result.code ?? "visibility_update_failed");
        return;
      }
      setVisibility(result.visibility);
      setAllowRemix(result.visibility === "public");
    } catch {
      setErrorCode("visibility_update_failed");
    } finally {
      setBusy(null);
    }
  }

  const publishLabel =
    busy === "publish"
      ? t.publish.publishing
      : upToDate
        ? t.publish.upToDate
        : slug
          ? t.publish.publishCurrent
          : t.publish.publish;

  return (
    <div className="flex items-center gap-1.5">
      {errorCode ? (
        <span
          role="alert"
          title={translateError(t, errorCode)}
          className="hidden max-w-[180px] truncate text-xs text-accent-hover sm:inline"
        >
          {translateError(t, errorCode)}
        </span>
      ) : (
        justPublished && (
          <span
            role="status"
            className="hidden items-center gap-1 text-xs text-ink-soft sm:inline-flex"
          >
            <Check className="size-3.5 shrink-0" />
            {t.publish.publishedJustNow}
          </span>
        )
      )}

      <button
        type="button"
        role="switch"
        aria-checked={remixOn}
        aria-label={t.publish.allowRemix}
        title={`${t.publish.allowRemix}\n\n${
          slug ? t.publish.publishedNote : t.publish.unpublishedNote
        }`}
        disabled={busy !== null}
        onClick={toggleRemix}
        className="group flex shrink-0 items-center gap-1.5 rounded-md px-1 py-1 text-xs text-ink-faint transition-colors hover:text-ink disabled:pointer-events-none disabled:opacity-45"
      >
        <span className="hidden xl:inline">{t.publish.remix}</span>
        <span
          aria-hidden
          className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
            remixOn ? "bg-ink" : "bg-line-strong"
          }`}
        >
          <span
            className={`inline-block size-3 rounded-full bg-surface shadow-sm transition-transform ${
              remixOn ? "translate-x-3.5" : "translate-x-0.5"
            }`}
          />
        </span>
      </button>

      {slug && (
        <Link
          href={`/play/${slug}`}
          target="_blank"
          aria-label={t.publish.publicPage}
          title={t.publish.publicPage}
          className="grid size-8 place-items-center rounded-md text-ink-faint transition-colors hover:bg-canvas-sunken hover:text-ink"
        >
          <ExternalLink className="size-4" />
        </Link>
      )}

      <Button
        size="sm"
        onClick={publish}
        disabled={publishDisabled}
        aria-busy={busy === "publish"}
        title={upToDate ? t.publish.upToDateHint : undefined}
      >
        {busy === "publish" ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : upToDate ? (
          <Check className="size-4" />
        ) : (
          <Rocket className="size-4" />
        )}
        {publishLabel}
      </Button>
    </div>
  );
}
