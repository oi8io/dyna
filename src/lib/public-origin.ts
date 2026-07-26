/**
 * The origin a browser actually used to reach this app.
 *
 * `request.url` is the address the server was reached on. Behind a reverse
 * proxy — which is what a long-lived Node process sits behind — that is the
 * container's internal listener, so building a redirect from it sends the user
 * to something like `http://localhost:8080`. Serverless platforms rewrite
 * `request.url` to the public URL, which is why this only appears off them.
 *
 * Order of preference:
 *  1. `NEXT_PUBLIC_APP_URL`, because an explicitly configured origin is the
 *     operator's stated intent and cannot be influenced by a request header.
 *  2. The forwarding headers, for deployments that never set it.
 *  3. `request.url`, correct for local development where nothing proxies.
 */
export function resolvePublicOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) {
    try {
      const origin = new URL(configured).origin;
      warnOnHostMismatch(request, origin);
      return origin;
    } catch {
      // Fall through: a malformed value should not break sign-in.
    }
  }

  return fromForwardedHeaders(request) ?? new URL(request.url).origin;
}

/**
 * Says so when the app is reached on a host it is not configured for.
 *
 * Adding a domain without updating `NEXT_PUBLIC_APP_URL` sends every sign-in
 * back to the old one, which looks like a bug in the app rather than a setting
 * that was missed. Configuration still wins — a request header must not be
 * able to redirect sign-in — but the mismatch should not be silent.
 */
function warnOnHostMismatch(request: Request, configuredOrigin: string) {
  const reached = fromForwardedHeaders(request);
  if (reached && reached !== configuredOrigin) {
    console.warn(
      `[origin_mismatch] reached on ${reached} but NEXT_PUBLIC_APP_URL is ${configuredOrigin}; redirects will use the configured value. Update it, and Supabase's Site URL and Redirect URLs, to the new domain.`,
    );
  }
}

function fromForwardedHeaders(request: Request): string | undefined {
  const host = request.headers.get("x-forwarded-host");
  if (!host) return undefined;

  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  // Comma-separated when proxies append. The last entry is the one the closest
  // proxy wrote; the first is whatever the client claimed, which is exactly the
  // value not to trust.
  const entries = host.split(",");
  const nearest = entries[entries.length - 1].trim();
  const schemes = proto.split(",");
  const scheme = schemes[schemes.length - 1].trim();

  try {
    return new URL(`${scheme}://${nearest}`).origin;
  } catch {
    return undefined;
  }
}
