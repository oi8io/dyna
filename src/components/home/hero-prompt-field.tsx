"use client";

import { useSeededPrompt } from "@/lib/i18n/use-seeded-prompt";

/**
 * The hero textarea, and only it.
 *
 * The surrounding form, label, hint and button stay on the server; this is
 * client-side purely because the field has to be controlled for its seed to
 * follow a language switch. An uncontrolled `defaultValue` applies on mount and
 * never again, so refreshing the server tree left the old language's example
 * sitting in the box.
 */
export function HeroPromptField({ maxLength = 800 }: { maxLength?: number }) {
  const { value, setValue } = useSeededPrompt("home", undefined, maxLength);

  return (
    <textarea
      id="prompt"
      name="prompt"
      required
      maxLength={maxLength}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      className="min-h-24 w-full resize-none bg-transparent px-4 pt-4 text-[15px] leading-7 text-ink outline-none placeholder:text-ink-faint"
    />
  );
}
