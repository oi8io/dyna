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
      return new URL(configured).origin;
    } catch {
      // Fall through: a malformed value should not break sign-in.
    }
  }

  const host = request.headers.get("x-forwarded-host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    // Comma-separated when several proxies appended to it; the first is the
    // one closest to the client.
    const first = host.split(",")[0].trim();
    const scheme = proto.split(",")[0].trim();
    try {
      return new URL(`${scheme}://${first}`).origin;
    } catch {
      // Fall through.
    }
  }

  return new URL(request.url).origin;
}
