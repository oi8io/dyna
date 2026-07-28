"use client";

import { Check, Globe } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { useLocale, useT } from "@/lib/i18n/client";
import {
  LOCALES,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_LABELS,
  type Locale,
} from "@/lib/i18n/config";
import { cn } from "@/lib/utils";

/**
 * Persists the choice.
 *
 * Outside the component on purpose: the compiler treats a write to a global
 * from inside a render scope as a side effect it cannot reason about, and this
 * one genuinely is one — it belongs to the click, not to rendering.
 */
function persistLocale(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale};path=/;max-age=${LOCALE_COOKIE_MAX_AGE};samesite=lax`;
}

/**
 * An icon button that opens the language list.
 *
 * A menu rather than a segmented control: language is set once and then never
 * touched, so it does not deserve permanent space in the header, and the
 * segmented version would grow a row wider with every locale added.
 *
 * `router.refresh()` rather than a reload: every page here is a server
 * component reading the cookie, so refetching the tree is enough, and it keeps
 * whatever local state the page had — a half-written prompt survives the switch.
 */
export function LocaleSwitcher({
  className,
  /** The sidebar sits at the bottom of the viewport, so it opens upward. */
  side = "bottom",
  align = "end",
}: {
  className?: string;
  side?: "top" | "bottom";
  align?: "start" | "end";
}) {
  const { locale } = useLocale();
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  // A popover that survives clicking elsewhere reads as a stuck panel.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function choose(next: Locale) {
    setOpen(false);
    if (next === locale) return;
    persistLocale(next);
    startTransition(() => router.refresh());
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={t.common.language}
        title={`${t.common.language} · ${LOCALE_LABELS[locale]}`}
        className={cn(
          "flex size-8 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-canvas-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20",
          open && "bg-canvas-sunken text-ink",
          pending && "opacity-60",
        )}
      >
        <Globe className="size-4" />
      </button>

      {open && (
        <div
          role="group"
          aria-label={t.common.language}
          className={cn(
            "absolute z-50 min-w-40 rounded-lg border border-line bg-surface p-1 shadow-lg",
            side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {LOCALES.map((option) => (
            <button
              key={option}
              type="button"
              lang={option}
              onClick={() => choose(option)}
              aria-pressed={option === locale}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
                option === locale
                  ? "text-ink"
                  : "text-ink-soft hover:bg-canvas-sunken hover:text-ink",
              )}
            >
              <Check
                className={cn(
                  "size-3.5 shrink-0",
                  option === locale ? "text-accent" : "invisible",
                )}
              />
              {LOCALE_LABELS[option]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
