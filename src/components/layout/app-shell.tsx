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

import { UserCard, type UserCardProps } from "@/components/layout/user-card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface RecentProject {
  id: string;
  title: string;
}

interface AppShellProps extends UserCardProps {
  recent: RecentProject[];
  children: React.ReactNode;
}

const SECTIONS = [
  { href: "/builder", label: "作品", icon: LayoutGrid },
  { href: "/artifacts", label: "已发布", icon: Share2 },
  { href: "/usage", label: "额度与用量", icon: Gauge },
] as const;

/** The builder is a two-pane IDE; a full sidebar there would crowd it out. */
function isWorkbench(pathname: string) {
  return /^\/builder\/[^/]+$/.test(pathname) && pathname !== "/builder/new";
}

export function AppShell({ recent, children, ...user }: AppShellProps) {
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
            title="新建作品"
            className={cn(
              buttonVariants({ size: "sm" }),
              "w-full",
              collapsed && "px-0",
            )}
          >
            <Plus className="size-4" />
            {!collapsed && "新建作品"}
          </Link>
        </div>

        <nav className={cn("mt-4 shrink-0 space-y-0.5", collapsed ? "px-2" : "px-3")}>
          {SECTIONS.map((section) => {
            const active =
              pathname === section.href ||
              pathname.startsWith(`${section.href}/`);
            return (
              <Link
                key={section.href}
                href={section.href}
                title={section.label}
                className={cn(
                  "flex h-9 items-center gap-2.5 rounded-md text-sm transition-colors",
                  collapsed ? "justify-center" : "px-2.5",
                  active
                    ? "bg-surface text-ink"
                    : "text-ink-soft hover:bg-surface/60 hover:text-ink",
                )}
              >
                <section.icon className="size-4 shrink-0" />
                {!collapsed && section.label}
              </Link>
            );
          })}
        </nav>

        {!collapsed && recent.length > 0 && (
          <div className="scrollbar-thin mt-6 min-h-0 flex-1 overflow-y-auto px-3">
            <p className="px-2.5 pb-1 text-xs text-ink-faint">最近</p>
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
        <div className="mt-auto shrink-0 px-2 pb-1">
          <button
            onClick={() => setManual(!collapsed)}
            aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
            aria-expanded={!collapsed}
            title={collapsed ? "展开侧栏" : "收起侧栏"}
            className={cn(
              "flex h-9 w-full items-center gap-2.5 rounded-md text-[13px] text-ink-soft transition-colors hover:bg-surface hover:text-ink",
              collapsed ? "justify-center" : "px-2.5",
            )}
          >
            {collapsed ? (
              <ChevronsRight className="size-4 shrink-0" />
            ) : (
              <>
                <ChevronsLeft className="size-4 shrink-0" />
                收起侧栏
              </>
            )}
          </button>
        </div>

        <div className="shrink-0">
          <UserCard {...user} collapsed={collapsed} />
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
