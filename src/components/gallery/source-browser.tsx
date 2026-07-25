"use client";

import { useState } from "react";

import { CodeView } from "@/components/code/code-view";
import type { PublishedSourceFile } from "@/types/database";

export function SourceBrowser({ files }: { files: PublishedSourceFile[] }) {
  const [selected, setSelected] = useState(files[0]?.path);
  const [open, setOpen] = useState(false);

  if (!files.length) return null;
  const current = files.find((file) => file.path === selected);

  return (
    <section className="mt-6">
      <button
        onClick={() => setOpen((value) => !value)}
        className="text-sm text-ink-soft underline underline-offset-4 hover:text-ink"
      >
        {open ? "收起源码" : `查看源码（${files.length} 个文件）`}
      </button>

      {open && (
        <div className="mt-3 grid overflow-hidden rounded-xl border border-line bg-surface md:grid-cols-[200px_minmax(0,1fr)]">
          <div className="scrollbar-thin max-h-96 overflow-auto border-b border-line bg-canvas-sunken p-2 md:border-b-0 md:border-r">
            {files.map((file) => (
              <button
                key={file.path}
                onClick={() => setSelected(file.path)}
                className={`block w-full truncate rounded-md px-2 py-1.5 text-left font-mono text-[11px] transition-colors ${
                  selected === file.path
                    ? "bg-surface text-ink"
                    : "text-ink-soft hover:text-ink"
                }`}
                title={file.path}
              >
                {file.path}
              </button>
            ))}
          </div>
          {current && (
            <CodeView
              path={current.path}
              code={current.content}
              className="max-h-96"
            />
          )}
        </div>
      )}
    </section>
  );
}
