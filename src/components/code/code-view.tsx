"use client";

import { useEffect, useRef, useState } from "react";

import {
  escapeLines,
  highlightLines,
  langForPath,
} from "@/components/code/highlighter";

interface CodeViewProps {
  path: string;
  code: string;
  /** Renders a blinking caret at the end and keeps the view scrolled there. */
  streaming?: boolean;
  className?: string;
}

/**
 * Read-only editor surface: gutter, syntax highlighting, and a caret while the
 * agent is still writing. Code is never editable here — changes go through the
 * conversation so the file whitelist and sandbox build stay authoritative.
 */
export function CodeView({
  path,
  code,
  streaming = false,
  className = "",
}: CodeViewProps) {
  // Escaped from the very first render, including on the server. Splitting the
  // raw file put unescaped `</script>` and `<!-- ... -->` from the project's own
  // `index.html` straight into the document, which truncated the inline RSC
  // payload and left the builder unhydrated — every button on the page dead.
  const [lines, setLines] = useState<string[]>(() => escapeLines(code));
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<number>(0);

  useEffect(() => {
    let cancelled = false;
    // Highlighting a growing buffer on every delta would thrash the main
    // thread. One pass per animation frame keeps up with a fast model.
    cancelAnimationFrame(pendingRef.current);
    pendingRef.current = requestAnimationFrame(() => {
      void highlightLines(code, langForPath(path)).then((result) => {
        if (!cancelled) setLines(result);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(pendingRef.current);
    };
  }, [code, path]);

  useEffect(() => {
    if (!streaming) return;
    const scroller = scrollerRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [lines, streaming]);

  return (
    <div
      ref={scrollerRef}
      className={`scrollbar-thin overflow-auto bg-surface ${className}`}
    >
      <table className="w-full border-collapse font-mono text-[12px] leading-5">
        <tbody>
          {lines.map((line, index) => (
            <tr key={index}>
              <td className="w-10 select-none border-r border-line py-0 pr-2 text-right align-top text-[11px] text-ink-faint">
                {index + 1}
              </td>
              <td className="whitespace-pre-wrap break-words py-0 pl-3 align-top text-ink">
                <span dangerouslySetInnerHTML={{ __html: line || "&nbsp;" }} />
                {streaming && index === lines.length - 1 && (
                  <span className="ml-px inline-block h-3.5 w-[2px] translate-y-[3px] animate-pulse bg-accent" />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
