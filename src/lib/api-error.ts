import { NextResponse } from "next/server";

import type { ErrorCode } from "@/lib/i18n/dictionary";

/**
 * The single shape every API route uses to refuse.
 *
 * Routes send a code, not a sentence. Language is a property of whoever is
 * reading, and the server only knows that through a cookie it would have to
 * consult on every path — including background work where no request exists at
 * all. Codes are also stable across copy edits, which makes them safe to key
 * behaviour off.
 */
export interface ApiError {
  code: ErrorCode;
}

export function apiError(code: ErrorCode, status: number) {
  return NextResponse.json<ApiError>({ code }, { status });
}
