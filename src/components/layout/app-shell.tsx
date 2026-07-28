"use client";

import {
  ChevronsLeft,
  ChevronsRight,
  Gauge,
  LayoutGrid,
  Plus,
  Share2,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { UserCard, type UserCardProps } from "@/components/layout/user-card";
import { buttonVariants } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

export interface RecentProject {
  id: string;
  title: string;
}

interface AppShellProps extends UserCardProps {
  recent: RecentProject[];
  children: React.ReactNode;
}

/** Icons and routes are fixed; labels come from the dictionary at render. */
const SECTIONS = [
  { href: "/builder", key: "projects", icon: LayoutGrid },
  { href: "/artifacts", key: "published", icon: Share2 },
  { href: "/usage", key: "usage", icon: Gauge },
] as const;

/** The builder is a two-pane IDE; a full sidebar there would crowd it out. */
function isWorkbench(pathname: string) {
  return /^\/builder\/[^/]+$/.test(pathname) && pathname !== "/builder/new";
}

export function AppShell({ recent, children, ...user }: AppShellProps) {
  const t = useT();
  const pathname = usePathname();
  const [manual, setManual] = useState<boolean>();
  // Collapsed by default inside the workbench, expanded everywhere else, and
  // whatever the user last chose once they touch the toggle.
  const collapsed = manual ?? isWorkbench(pathname);

  return (
    <div className="flex h-screen overflow-hidden">
      <aside
        className={cn(
          "flex shrink-0 flex-col border-r border-line bg-canvas-sunken transition-[width] duration-150",
          collapsed ? "w-14" : "w-60",
        )}
      >
        <div
          className={cn(
            "flex h-14 shrink-0 items-center",
            collapsed ? "justify-center" : "px-4",
          )}
        >
          <Link href="/" className="flex items-baseline gap-1.5" title="Dyna Studio">
            <span className="font-serif text-lg tracking-tight text-ink">
              {collapsed ? "D" : "Dyna"}
            </span>
            {!collapsed && <span className="text-xs text-ink-faint">Studio</span>}
          </Link>
        </div>

        <div className={cn("shrink-0", collapsed ? "px-2" : "px-3")}>
          <Link
            href="/builder/new"
            title={t.nav.newProject}
            className={cn(
              buttonVariants({ size: "sm" }),
              "w-full",
              collapsed && "px-0",
            )}
          >
            <Plus className="size-4" />
            {!collapsed && t.nav.newProject}
          </Link>
        </div>

        <nav className={cn("mt-4 shrink-0 space-y-0.5", collapsed ? "px-2" : "px-3")}>
          {SECTIONS.map((section) => {
            const active =
              pathname === section.href ||
              pathname.startsWith(`${section.href}/`);
            const label = t.nav[section.key];
            return (
              <Link
                key={section.href}
                href={section.href}
                title={label}
                className={cn(
                  "flex h-9 items-center gap-2.5 rounded-md text-sm transition-colors",
                  collapsed ? "justify-center" : "px-2.5",
                  active
                    ? "bg-surface text-ink"
                    : "text-ink-soft hover:bg-surface/60 hover:text-ink",
                )}
              >
                <section.icon className="size-4 shrink-0" />
                {!collapsed && label}
              </Link>
            );
          })}
        </nav>

        {!collapsed && recent.length > 0 && (
          <div className="scrollbar-thin mt-6 min-h-0 flex-1 overflow-y-auto px-3">
            <p className="px-2.5 pb-1 text-xs text-ink-faint">{t.nav.recent}</p>
            {recent.map((project) => (
              <Link
                key={project.id}
                href={`/builder/${project.id}`}
                title={project.title}
                className={cn(
                  "block truncate rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
                  pathname === `/builder/${project.id}`
                    ? "bg-surface text-ink"
                    : "text-ink-soft hover:bg-surface/60 hover:text-ink",
                )}
              >
                {project.title}
              </Link>
            ))}
          </div>
        )}

        {/* The toggle sits in one fixed spot in both states. Moving it from the
            header to the footer on collapse meant hunting for it, which is
            exactly what a collapsed sidebar should not require. */}
        <div
          className={cn(
            "mt-auto flex shrink-0 items-center gap-1 px-2 pb-1",
            collapsed && "flex-col",
          )}
        >
          <button
            onClick={() => setManual(!collapsed)}
            aria-label={collapsed ? t.nav.expand : t.nav.collapse}
            aria-expanded={!collapsed}
            title={collapsed ? t.nav.expand : t.nav.collapse}
            className={cn(
              "flex h-9 items-center gap-2.5 rounded-md text-[13px] text-ink-soft transition-colors hover:bg-surface hover:text-ink",
              // Side by side with the language button when there is room; the
              // rail stacks them instead, so each takes the full width there.
              collapsed ? "w-full justify-center" : "min-w-0 flex-1 px-2.5",
            )}
          >
            {collapsed ? (
              <ChevronsRight className="size-4 shrink-0" />
            ) : (
              <>
                <ChevronsLeft className="size-4 shrink-0" />
                {t.nav.collapse}
              </>
            )}
          </button>
          {/* Last here too, matching the header. `align="end"` keeps the list
              inside the sidebar now that it hangs off the right edge. */}
          <LocaleSwitcher side="top" align="end" />
        </div>

        <div className="shrink-0">
          <UserCard {...user} collapsed={collapsed} />
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
