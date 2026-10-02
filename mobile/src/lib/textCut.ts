/**
 * A cut position that never splits a UTF-16 surrogate pair (emoji, some
 * symbols): if `i` falls between a high and a low surrogate it moves past
 * the pair, so a slice never ends in half a character (a flashing "�").
 */
export function safeCut(text: string, i: number): number {
  const n = Math.max(0, Math.min(text.length, Math.floor(i)));
  if (n > 0 && n < text.length) {
    const prev = text.charCodeAt(n - 1);
    if (prev >= 0xd800 && prev <= 0xdbff) return n + 1;
  }
  return n;
}
