import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  type Locale,
  isLocale,
  negotiateLocale,
} from "@/lib/i18n/config";

/**
 * Settles the language for this request before anything renders.
 *
 * A first-time visitor gets their browser's preference written to a cookie
 * here, and the request's own cookie jar is updated in the same pass so the
 * page rendered by *this* request already reads it — otherwise the first page
 * anyone sees is the default language and only the second one is right.
 */
function resolveLocale(request: NextRequest): {
  locale: Locale;
  persist: boolean;
} {
  const existing = request.cookies.get(LOCALE_COOKIE)?.value;
  if (isLocale(existing)) return { locale: existing, persist: false };

  const locale = negotiateLocale(request.headers.get("accept-language"));
  request.cookies.set(LOCALE_COOKIE, locale);
  return { locale, persist: true };
}

export async function proxy(request: NextRequest) {
  const { locale, persist } = resolveLocale(request);

  let response = NextResponse.next({ request });
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !publishableKey) {
    if (persist) setLocaleCookie(response, locale);
    return response;
  }

  const supabase = createServerClient(supabaseUrl, publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  await supabase.auth.getClaims();
  // Set last: the Supabase cookie handler replaces `response` whenever it
  // refreshes a session, and a cookie written before that would be dropped.
  if (persist) setLocaleCookie(response, locale);
  return response;
}

function setLocaleCookie(response: NextResponse, locale: Locale) {
  response.cookies.set(LOCALE_COOKIE, locale, {
    maxAge: LOCALE_COOKIE_MAX_AGE,
    path: "/",
    sameSite: "lax",
  });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
