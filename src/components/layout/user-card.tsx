"use client";

import { Check, LoaderCircle, LogOut, Pencil, Settings, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n/client";
import { translateError } from "@/lib/i18n/dictionary";
import { cn } from "@/lib/utils";

export interface UserCardProps {
  email: string;
  displayName: string | null;
  createCredits: number;
  editCredits: number;
  /** "Live" or "Safe demo" — the badge that says which mode the account runs in. */
  mode: string;
}

function initials(displayName: string, email: string) {
  const source = displayName.trim() || email;
  return source.slice(0, 1).toUpperCase();
}

export function UserCard({
  email,
  displayName,
  createCredits,
  editCredits,
  mode,
  collapsed,
}: UserCardProps & { collapsed: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  // What the server last confirmed. The prop is the initial value only: the
  // sidebar does not remount after a save, so a name that lived solely in the
  // prop would keep showing the old one until a full navigation.
  const [name, setName] = useState(displayName?.trim() ?? "");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);
  const [errorCode, setErrorCode] = useState<string>();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * Closing also ends any rename in progress: reopening the panel to find a
   * half-typed name still sitting in an open field reads as an unsaved change
   * the user has to deal with, when in fact nothing was ever sent.
   */
  const closePanel = useCallback(() => {
    setOpen(false);
    setEditing(false);
    setErrorCode(undefined);
  }, []);

  // A popover that survives clicking elsewhere reads as a stuck panel.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) closePanel();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closePanel();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, closePanel]);

  // The pencil is a mode switch, so the caret has to land in the field for it
  // to read as one. `select` focuses as well as selecting, which is why there
  // is no `autoFocus` on the input.
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function startEditing() {
    setDraft(name);
    setErrorCode(undefined);
    setEditing(true);
  }

  function cancelEditing() {
    setDraft(name);
    setErrorCode(undefined);
    setEditing(false);
  }

  async function saveName() {
    if (saving) return;
    const next = draft.trim();
    // Nothing to send, and no reason to make the user watch a spinner for it.
    if (next === name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setErrorCode(undefined);
    const response = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: next }),
    });
    if (!response.ok) {
      const result = (await response.json().catch(() => ({}))) as {
        code?: string;
      };
      // Stays in edit mode: the text the user typed is still in the field, and
      // dropping them back to read mode would look like it saved.
      setErrorCode(result.code ?? "profile_save_failed");
    } else {
      setName(next);
      setEditing(false);
    }
    setSaving(false);
  }

  const label = name || email;

  return (
    <div ref={containerRef} className="relative border-t border-line p-2">
      {open && (
        <div
          className={cn(
            "absolute z-50 w-64 rounded-xl border border-line bg-surface p-3 shadow-lg",
            // Same reasoning as the language menu: a 56px rail cannot hold a
            // 256px panel, so on the rail it flies out sideways instead of
            // straddling the edge.
            collapsed
              ? "bottom-2 left-full ml-1.5"
              : "bottom-full left-2 mb-2",
          )}
        >
          <p className="truncate text-xs text-ink-faint">{email}</p>

          <p className="mt-3 text-xs text-ink-soft" id="display-name-label">
            {t.account.displayName}
          </p>

          {/* Read by default. A field standing open invites editing something
              that is set once and then left alone, and it makes the panel look
              like a form when it is mostly a summary. */}
          {editing ? (
            <div className="mt-1.5 flex gap-1.5">
              <Input
                ref={inputRef}
                aria-labelledby="display-name-label"
                value={draft}
                maxLength={40}
                placeholder={t.account.displayNamePlaceholder}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void saveName();
                  }
                  // Caught here rather than by the panel's Escape handler, which
                  // would close the whole thing instead of leaving edit mode.
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    cancelEditing();
                  }
                }}
                className="h-8 text-[13px]"
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={saveName}
                disabled={saving}
                aria-label={t.account.saveDisplayName}
                className="px-2"
              >
                {saving ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Check className="size-3.5" />
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={cancelEditing}
                disabled={saving}
                aria-label={t.account.cancelDisplayName}
                className="px-2"
              >
                <X className="size-3.5" />
              </Button>
            </div>
          ) : (
            <div className="mt-1 flex h-8 items-center gap-1.5">
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-[13px]",
                  name ? "text-ink" : "text-ink-faint",
                )}
              >
                {name || t.account.displayNamePlaceholder}
              </span>
              <button
                type="button"
                onClick={startEditing}
                aria-label={t.account.editDisplayName}
                title={t.account.editDisplayName}
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-canvas-sunken hover:text-ink"
              >
                <Pencil className="size-3.5" />
              </button>
            </div>
          )}

          {errorCode && (
            <p className="mt-1.5 text-xs text-accent-hover">
              {translateError(t, errorCode)}
            </p>
          )}
          <p className="mt-1.5 text-xs text-ink-faint">
            {t.account.displayNameNote}
          </p>

          <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3 text-xs">
            <div>
              <dt className="text-ink-faint">{t.account.createCredits}</dt>
              <dd className="mt-0.5 font-mono text-ink">{createCredits}</dd>
            </div>
            <div>
              <dt className="text-ink-faint">{t.account.editCredits}</dt>
              <dd className="mt-0.5 font-mono text-ink">{editCredits}</dd>
            </div>
          </dl>

          <form action="/auth/signout" method="post" className="mt-3">
            <button
              type="submit"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink-soft transition-colors hover:bg-canvas-sunken hover:text-ink"
            >
              <LogOut className="size-4" />
              {t.account.signOut}
            </button>
          </form>
        </div>
      )}

      <button
        onClick={() => (open ? closePanel() : setOpen(true))}
        aria-expanded={open}
        aria-label={t.account.settings}
        title={label}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-md p-1.5 text-left transition-colors hover:bg-surface",
          collapsed && "justify-center",
        )}
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent text-xs font-medium text-white">
          {initials(name, email)}
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-ink">{label}</span>
              <span className="block truncate text-xs text-ink-faint">
                {mode} · {t.account.remaining(createCredits + editCredits)}
              </span>
            </span>
            <Settings className="size-4 shrink-0 text-ink-faint" />
          </>
        )}
      </button>
    </div>
  );
}
