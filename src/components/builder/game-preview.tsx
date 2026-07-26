"use client";

import { Maximize2, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";

export function GamePreview({
  artifactHtml,
  title,
}: {
  artifactHtml: string;
  title: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [revision, setRevision] = useState(0);

  function reload() {
    setRevision((value) => value + 1);
  }

  function fullscreen() {
    void iframeRef.current?.requestFullscreen();
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3">
        <div className="text-xs text-ink-soft">预览</div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={reload}
            aria-label="重新载入预览"
          >
            <RefreshCw className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={fullscreen}
            aria-label="全屏预览"
          >
            <Maximize2 className="size-4" />
          </Button>
        </div>
      </div>
      {/* No min-height: the canvas takes whatever the pane gives it. A floor
          here would make the iframe push the grid row taller instead. */}
      <iframe
        key={revision}
        ref={iframeRef}
        title={`${title} 预览`}
        srcDoc={artifactHtml}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        className="min-h-0 w-full flex-1 border-0 bg-canvas-sunken"
      />
    </section>
  );
}
