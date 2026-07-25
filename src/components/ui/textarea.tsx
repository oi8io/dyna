import * as React from "react";

import { cn } from "@/lib/utils";

export function Textarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "min-h-28 w-full resize-none rounded-lg border border-line-strong bg-surface px-4 py-3 text-sm leading-6 text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-ink/40",
        className,
      )}
      {...props}
    />
  );
}
