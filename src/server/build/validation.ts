const NONE_ONLY_DIRECTIVES = [
  "default-src",
  "connect-src",
  "object-src",
  "base-uri",
];

export function validateStandaloneHtml(html: string) {
  const metaTag = html.match(
    /<meta(?=[^>]*http-equiv=["']content-security-policy["'])[^>]*>/i,
  );
  const content = metaTag?.[0].match(
    /content=(?:"([^"]+)"|'([^']+)')/i,
  );
  const policy = content?.[1] ?? content?.[2];
  if (!policy) {
    throw new Error("index.html has no Content-Security-Policy");
  }
  const directives = new Map(
    policy
      .toLowerCase()
      .split(";")
      .map((part) => part.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name, ...sources]) => [name, sources]),
  );
  for (const directive of NONE_ONLY_DIRECTIVES) {
    const sources = directives.get(directive);
    if (sources?.length !== 1 || sources[0] !== "'none'") {
      throw new Error(`index.html is missing the directive: ${directive} 'none'`);
    }
  }
  if (!directives.get("script-src")?.includes("'unsafe-inline'")) {
    throw new Error("index.html declares no controlled inline-script policy");
  }
  if (
    /<(?:script|img|audio|video|source|link)[^>]+(?:src|href)=["']https?:/i.test(
      html,
    )
  ) {
    throw new Error("A generated page may not load remote resources");
  }
  if (/<script[^>]+src=/i.test(html)) {
    throw new Error("The preview artifact must be a single file with no external scripts");
  }
  if (html.length > 500_000) {
    throw new Error("The preview artifact exceeds the size limit");
  }
}
