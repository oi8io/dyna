"use client";

import { useEffect, useRef, useState } from "react";

import { useLocale } from "@/lib/i18n/client";
import { type SeedSection, isSeedPrompt, seedsFor } from "@/lib/i18n/seeds";

/**
 * A prompt field seeded with an example that follows the interface language
 * until the user makes the field their own.
 *
 * Switching language re-renders the server tree, but a field's value lives in
 * the client and survives that — so without this the box keeps showing the
 * example from whichever language the page was first opened in. Resetting
 * unconditionally would be the worse bug: it would throw away a half-written
 * prompt on a stray click.
 */
export function useSeededPrompt(
  section: SeedSection,
  initial?: string,
  maxLength = 4000,
) {
  const { locale } = useLocale();
  const seeds = seedsFor(locale, section);
  const [value, setValue] = useState(
    initial?.trim().slice(0, maxLength) || seeds[0],
  );
  const shownIn = useRef(locale);

  useEffect(() => {
    if (shownIn.current === locale) return;
    shownIn.current = locale;
    setValue((current) =>
      isSeedPrompt(current) ? seedsFor(locale, section)[0] : current,
    );
  }, [locale, section]);

  return { value, setValue, seeds };
}
