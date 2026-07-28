"use client";

import { createContext, useContext, useMemo } from "react";

import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";
import { type Dictionary, intlLocale } from "@/lib/i18n/dictionary";
import { MESSAGES } from "@/lib/i18n/messages";

interface I18nValue {
  locale: Locale;
  t: Dictionary;
  /** BCP 47 tag for `Intl` and `toLocaleDateString`. */
  intl: string;
}

const I18nContext = createContext<I18nValue | null>(null);

/**
 * Only the locale crosses the server/client boundary — never the dictionary.
 *
 * Some entries are functions, which cannot be serialised into an RSC payload,
 * and shipping the copy twice (once in the payload, once in the bundle) would
 * be wasteful even if they could.
 */
export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const value = useMemo<I18nValue>(
    () => ({ locale, t: MESSAGES[locale], intl: intlLocale(locale) }),
    [locale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  // A client component rendered outside the provider is a wiring bug, but a
  // crash is a worse answer than the default language.
  return (
    value ?? {
      locale: DEFAULT_LOCALE,
      t: MESSAGES[DEFAULT_LOCALE],
      intl: intlLocale(DEFAULT_LOCALE),
    }
  );
}

/** The dictionary, for copy. */
export function useT(): Dictionary {
  return useI18n().t;
}

/** Locale plus the `Intl` tag, for dates and numbers. */
export function useLocale(): { locale: Locale; intl: string } {
  const { locale, intl } = useI18n();
  return { locale, intl };
}
