"use client";

import { Check, LoaderCircle, LogOut, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface UserCardProps {
  email: string;
  displayName: string | null;
  createCredits: number;
  editCredits: number;
  /** "Live" or "Safe demo" — the badge that says which mode the account runs in. */
  mode: string;
}

function initials(displayName: string | null, email: string) {
  const source = displayName?.trim() || email;
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
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(displayName ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();
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

  async function saveName() {
    if (saving) return;
    setSaving(true);
    setSaved(false);
    setError(undefined);
    const response = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: name.trim() }),
    });
    if (!response.ok) {
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      setError(result.error ?? "保存失败。");
    } else {
      setSaved(true);
    }
    setSaving(false);
  }

  const label = displayName?.trim() || email;

  return (
    <div ref={containerRef} className="relative border-t border-line p-2">
      {open && (
        <div className="absolute bottom-full left-2 z-50 mb-2 w-64 rounded-xl border border-line bg-surface p-3 shadow-lg">
          <p className="truncate text-xs text-ink-faint">{email}</p>

          <label className="mt-3 block text-xs text-ink-soft" htmlFor="display-name">
            昵称
          </label>
          <div className="mt-1.5 flex gap-1.5">
            <Input
              id="display-name"
              value={name}
              maxLength={40}
              placeholder="还没设置"
              onChange={(event) => {
                setName(event.target.value);
                setSaved(false);
              }}
              className="h-8 text-[13px]"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={saveName}
              disabled={saving}
              aria-label="保存昵称"
            >
              {saving ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : saved ? (
                <Check className="size-3.5" />
              ) : (
                "保存"
              )}
            </Button>
          </div>
          {error && <p className="mt-1.5 text-xs text-accent-hover">{error}</p>}
          <p className="mt-1.5 text-xs text-ink-faint">
            昵称会显示在你公开发布的作品上。
          </p>

          <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3 text-xs">
            <div>
              <dt className="text-ink-faint">新建额度</dt>
              <dd className="mt-0.5 font-mono text-ink">{createCredits}</dd>
            </div>
            <div>
              <dt className="text-ink-faint">修改额度</dt>
              <dd className="mt-0.5 font-mono text-ink">{editCredits}</dd>
            </div>
          </dl>

          <form action="/auth/signout" method="post" className="mt-3">
            <button
              type="submit"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink-soft transition-colors hover:bg-canvas-sunken hover:text-ink"
            >
              <LogOut className="size-4" />
              退出登录
            </button>
          </form>
        </div>
      )}

      <button
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label="账户与设置"
        title={label}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-md p-1.5 text-left transition-colors hover:bg-surface",
          collapsed && "justify-center",
        )}
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent text-xs font-medium text-white">
          {initials(displayName, email)}
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-ink">{label}</span>
              <span className="block truncate text-xs text-ink-faint">
                {mode} · 剩 {createCredits + editCredits}
              </span>
            </span>
            <Settings className="size-4 shrink-0 text-ink-faint" />
          </>
        )}
      </button>
    </div>
  );
}
