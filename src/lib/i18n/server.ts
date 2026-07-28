import { cookies, headers } from "next/headers";

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  type Locale,
  isLocale,
  negotiateLocale,
} from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n/dictionary";
import { MESSAGES } from "@/lib/i18n/messages";

/**
 * The locale for the current request.
 *
 * The proxy writes the cookie on the first request, so this almost always hits
 * the cookie. The `Accept-Language` fallback covers the requests the proxy does
 * not match — and means a response is never rendered in the wrong language
 * while waiting for a cookie to take effect.
 */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const chosen = store.get(LOCALE_COOKIE)?.value;
  if (isLocale(chosen)) return chosen;

  try {
    const requestHeaders = await headers();
    return negotiateLocale(requestHeaders.get("accept-language"));
  } catch {
    return DEFAULT_LOCALE;
  }
}

/** The dictionary for the current request. */
export async function getDictionary(): Promise<Dictionary> {
  return MESSAGES[await getLocale()];
}

/** Locale and dictionary together, for the common case of needing both. */
export async function getI18n(): Promise<{ locale: Locale; t: Dictionary }> {
  const locale = await getLocale();
  return { locale, t: MESSAGES[locale] };
}
