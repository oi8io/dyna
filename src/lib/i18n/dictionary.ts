import { type Locale, DEFAULT_LOCALE } from "@/lib/i18n/config";
import { zhCN } from "@/lib/i18n/messages/zh-CN";

/**
 * `zh-CN` is the reference: it defines the shape every other locale must
 * satisfy. Importing `en` here would be circular — `en.ts` annotates itself
 * with this type — so the registry below pulls it in lazily-but-statically via
 * a separate module.
 */
export type Dictionary = typeof zhCN;

export type ErrorCode = keyof Dictionary["errors"];

export { zhCN };

/**
 * Resolves a code that arrived over the wire.
 *
 * Codes come from API responses and generation events, so they are strings the
 * client did not choose and cannot be sure of — an older tab talking to a newer
 * server, or a database error mapped to a code this build does not know. An
 * unrecognised one falls back rather than rendering an empty box.
 */
export function translateError(
  dictionary: Dictionary,
  code: string | undefined,
): string {
  if (!code) return dictionary.errors.unknown;
  const table = dictionary.errors as Record<string, string | undefined>;
  return table[code] ?? dictionary.errors.unknown;
}

/** BCP 47 tag for `<html lang>` and `Intl` formatting. */
export function intlLocale(locale: Locale): string {
  return locale === "zh-CN" ? "zh-CN" : "en-US";
}

export { DEFAULT_LOCALE };
