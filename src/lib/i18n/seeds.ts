import { LOCALES, type Locale } from "@/lib/i18n/config";
import { MESSAGES } from "@/lib/i18n/messages";

/** The two places a prompt field starts out pre-filled with an example. */
export type SeedSection = "home" | "newProject";

const SECTIONS = ["home", "newProject"] as const;

export function seedsFor(locale: Locale, section: SeedSection): string[] {
  const t = MESSAGES[locale];
  return section === "home" ? t.home.examples : t.newProject.examples;
}

/**
 * Whether a prompt field still holds an example rather than something the user
 * wrote.
 *
 * Checked against every locale and both sections, not just the current pair.
 * A prompt carried over from the home page arrives at the builder as
 * `initialPrompt` and is still an example; and after a language switch the
 * field holds the *previous* locale's example, which is exactly the case this
 * exists to catch.
 *
 * Someone who types out an example by hand loses it on a language switch. That
 * is the acceptable side of the trade: the alternative is tracking edit events,
 * and a field that was never focused would still read as touched after a
 * programmatic reset.
 */
export function isSeedPrompt(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  return LOCALES.some((locale) =>
    SECTIONS.some((section) => seedsFor(locale, section).includes(trimmed)),
  );
}
