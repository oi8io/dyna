"use client";

import { Maximize2, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";

type PreviewHealth =
  | { kind: "pending" }
  | { kind: "ok" }
  | { kind: "empty" }
  | { kind: "error"; message: string };

interface PreviewMessage {
  source?: string;
  kind?: string;
  message?: string;
}

export function GamePreview({
  artifactHtml,
  title,
  onRetry,
}: {
  artifactHtml: string;
  title: string;
  /** Offered when the game failed to run, so the user has a way forward. */
  onRetry?: (instruction: string) => void;
}) {
  const t = useT();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [revision, setRevision] = useState(0);
  const [health, setHealth] = useState<PreviewHealth>({ kind: "pending" });

  // The artifact reports on itself. The iframe is sandboxed without
  // allow-same-origin, so nothing here can read into it — a script in the
  // platform-owned shell posts out instead. Without this a game that throws on
  // mount is indistinguishable from one that is still loading.
  useEffect(() => {
    function onMessage(event: MessageEvent<PreviewMessage>) {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (!data || data.source !== "dyna-preview") return;

      if (data.kind === "error") {
        setHealth({ kind: "error", message: data.message || t.preview.unknownError });
      } else if (data.kind === "empty") {
        // An error already reported is the more useful message; keep it.
        setHealth((current) =>
          current.kind === "error" ? current : { kind: "empty" },
        );
      } else if (data.kind === "ok") {
        setHealth((current) =>
          current.kind === "error" ? current : { kind: "ok" },
        );
      }
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // `t` is a stable object per locale, so this re-subscribes only on switch.
  }, [t]);

  function reload() {
    setHealth({ kind: "pending" });
    setRevision((value) => value + 1);
  }

  function fullscreen() {
    void iframeRef.current?.requestFullscreen();
  }

  const broken = health.kind === "error" || health.kind === "empty";

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3">
        <div className="text-xs text-ink-soft">{t.preview.title}</div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={reload}
            aria-label={t.preview.reload}
          >
            <RefreshCw className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={fullscreen}
            aria-label={t.preview.fullscreen}
          >
            <Maximize2 className="size-4" />
          </Button>
        </div>
      </div>

      {broken && (
        <div className="shrink-0 border-b border-accent/25 bg-accent-soft px-3 py-2.5">
          <p className="text-sm leading-6 text-accent-hover">
            {health.kind === "error" ? t.preview.crashed : t.preview.blank}
          </p>
          {health.kind === "error" && (
            <pre className="scrollbar-thin mt-1.5 max-h-20 overflow-auto font-mono text-[11px] leading-5 text-accent-hover/80">
              <code>{health.message}</code>
            </pre>
          )}
          {onRetry && (
            <Button
              size="sm"
              variant="secondary"
              className="mt-2"
              onClick={() =>
                // Written in the interface language: it becomes the next turn
                // in the conversation, and that is what the user is reading.
                onRetry(
                  health.kind === "error"
                    ? t.preview.fixCrashPrompt(health.message)
                    : t.preview.fixBlankPrompt,
                )
              }
            >
              {t.preview.fixIt}
            </Button>
          )}
        </div>
      )}

      {/* No min-height: the canvas takes whatever the pane gives it. A floor
          here would make the iframe push the grid row taller instead. */}
      <iframe
        key={revision}
        ref={iframeRef}
        title={t.preview.frameTitle(title)}
        srcDoc={artifactHtml}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        className="min-h-0 w-full flex-1 border-0 bg-canvas-sunken"
      />
    </section>
  );
}
