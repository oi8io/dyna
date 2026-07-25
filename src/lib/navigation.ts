export function toSafeInternalPath(
  value: string | null | undefined,
  fallback = "/builder",
) {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f]/.test(value)
  ) {
    return fallback;
  }
  return value;
}
