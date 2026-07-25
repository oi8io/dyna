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
    throw new Error("index.html 缺少 Content-Security-Policy");
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
      throw new Error(`index.html 缺少安全策略：${directive} 'none'`);
    }
  }
  if (!directives.get("script-src")?.includes("'unsafe-inline'")) {
    throw new Error("index.html 未声明受控的内联脚本策略");
  }
  if (
    /<(?:script|img|audio|video|source|link)[^>]+(?:src|href)=["']https?:/i.test(
      html,
    )
  ) {
    throw new Error("生成页面不能加载远程资源");
  }
  if (/<script[^>]+src=/i.test(html)) {
    throw new Error("预览产物必须是单文件，不能引用外部脚本");
  }
  if (html.length > 500_000) {
    throw new Error("预览产物超过大小限制");
  }
}
