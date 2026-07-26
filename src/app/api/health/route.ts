import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Liveness probe for the host's health checks.
 *
 * Deliberately touches nothing: no database, no model, no auth. A health check
 * that depends on other services turns their outage into a restart loop of
 * this one.
 */
export function GET() {
  return NextResponse.json({ ok: true, at: new Date().toISOString() });
}
