/**
 * Locale identity and negotiation. No message data here, so this module is
 * safe to import from the proxy, from server components and from the client.
 *
 * Language is carried by a cookie rather than a path segment: `/play/[slug]`
 * links are shared as-is and must keep resolving for whoever opens them,
 * whichever language they read in.
 */

export const LOCALES = ["zh-CN", "en"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "zh-CN";

export const LOCALE_COOKIE = "dyna_locale";

/** A year. The choice is a preference, not a session. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Each language names itself, so the switcher is readable in either state. */
export const LOCALE_LABELS: Record<Locale, string> = {
  "zh-CN": "简体中文",
  en: "English",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Picks a locale from an `Accept-Language` header.
 *
 * Tags are ranked by their `q` value, then matched loosest-first: `zh-Hant-TW`
 * and `zh` both land on `zh-CN` because Simplified Chinese is the closer of the
 * two options on offer. Anything unrecognised falls through to the default.
 */
export function negotiateLocale(acceptLanguage: string | null): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;

  const ranked = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params
        .map((param) => param.trim())
        .find((param) => param.startsWith("q="));
      const quality = q ? Number.parseFloat(q.slice(2)) : 1;
      return {
        tag: tag.trim().toLowerCase(),
        quality: Number.isFinite(quality) ? quality : 0,
      };
    })
    .filter((entry) => entry.tag && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality);

  for (const { tag } of ranked) {
    if (tag === "*") return DEFAULT_LOCALE;
    const primary = tag.split("-")[0];
    if (primary === "zh") return "zh-CN";
    if (primary === "en") return "en";
  }

  return DEFAULT_LOCALE;
}

/**
 * Which language the *content* of a request is in.
 *
 * Generated games follow what the user typed, not what the interface is set to
 * — someone browsing in English who writes a Chinese prompt wants a Chinese
 * game. CJK is counted against letters rather than merely detected, so
 * "做一个 roguelike" reads as Chinese and "a 2048 clone" reads as English.
 */
export function detectContentLocale(text: string): Locale {
  const cjk = text.match(/[㐀-䶿一-鿿豈-﫿]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  if (cjk === 0) return latin > 0 ? "en" : DEFAULT_LOCALE;
  // One Chinese character carries roughly a short English word, so a plain
  // count would call almost anything Chinese.
  return cjk * 3 >= latin ? "zh-CN" : "en";
}
