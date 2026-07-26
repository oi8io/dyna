import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getServerEnv } from "@/server/env";

/**
 * A Supabase client that outlives the request that created it.
 *
 * The request-scoped client reads cookies through `next/headers`, which is only
 * valid while the request is being handled. A generation now continues after
 * its response has been sent, so it carries the caller's access token directly
 * instead. RLS still applies exactly as it would to that user — this grants
 * nothing extra, it only detaches from the request lifecycle.
 */
export function createDetachedClient(accessToken: string) {
  const env = getServerEnv();
  return createSupabaseClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
