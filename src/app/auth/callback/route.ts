import { NextResponse } from "next/server";

import { resolvePublicOrigin } from "@/lib/public-origin";
import { createClient } from "@/lib/supabase/server";
import { toSafeInternalPath } from "@/lib/navigation";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = toSafeInternalPath(url.searchParams.get("next"));
  // Not url.origin: that is the internal listener behind the proxy.
  const origin = resolvePublicOrigin(request);

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
  }

  return NextResponse.redirect(new URL("/login?error=auth_callback", origin));
}
