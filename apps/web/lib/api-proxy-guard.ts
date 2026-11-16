export function isBlockedApiProxyPath(
  segments: readonly string[],
  resolvedPathname: string,
): boolean {
  const normalizedPathname = resolvedPathname.replace(/\/+$/u, "").toLowerCase();
  if (normalizedPathname === "/api/v1/metrics") {
    return true;
  }
  if (!normalizedPathname.startsWith("/api/v1/")) {
    return true;
  }
  return segments.some(
    (segment) =>
      segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\"),
  );
}
