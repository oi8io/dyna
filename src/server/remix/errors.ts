/**
 * Maps `remix_publication` database exceptions to user-facing responses.
 * Raw database messages are never forwarded: they can carry table names,
 * column values and connection details.
 */
export function remixErrorResponse(message: string) {
  if (message.includes("source_is_private")) {
    return { status: 403, error: "作者没有公开这个作品的源码，无法 Remix。" };
  }
  if (message.includes("source_not_remixable")) {
    return { status: 409, error: "这个作品还没有可运行的版本。" };
  }
  if (message.includes("remix_rate_limit_exceeded")) {
    return { status: 429, error: "Remix 太频繁了，请稍后再试。" };
  }
  if (message.includes("not_authenticated")) {
    return { status: 401, error: "请先登录。" };
  }
  return { status: 500, error: "Remix 失败，请稍后重试。" };
}
