/** A colour token from `@theme` (canvas drawing can't use classes). */
export function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim();
}
