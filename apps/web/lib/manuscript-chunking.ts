export function safeChunkLength(text: string, requested: number): number {
  const bounded = Math.min(text.length, Math.max(0, Math.floor(requested)));
  if (bounded <= 0 || bounded >= text.length) {
    return bounded;
  }
  const previous = text.charCodeAt(bounded - 1);
  const next = text.charCodeAt(bounded);
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff
    ? Math.max(1, bounded - 1)
    : bounded;
}
