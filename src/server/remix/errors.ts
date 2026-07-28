import type { ErrorCode } from "@/lib/i18n/dictionary";

/**
 * Maps `remix_publication` database exceptions to a status and a stable code.
 *
 * Raw database messages are never forwarded: they can carry table names,
 * column values and connection details. Neither is prose — the caller's
 * language is a client-side fact, and a sentence chosen here would be wrong for
 * half the people who see it. The client turns the code into copy.
 */
export function remixErrorResponse(message: string): {
  status: number;
  code: ErrorCode;
} {
  if (message.includes("source_is_private")) {
    return { status: 403, code: "remix_source_private" };
  }
  if (message.includes("source_not_remixable")) {
    return { status: 409, code: "remix_source_not_remixable" };
  }
  if (message.includes("remix_rate_limit_exceeded")) {
    return { status: 429, code: "remix_rate_limited" };
  }
  if (message.includes("not_authenticated")) {
    return { status: 401, code: "not_authenticated" };
  }
  return { status: 500, code: "remix_failed" };
}
