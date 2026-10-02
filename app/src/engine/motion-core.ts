// Pure motion core, ported 1:1 from the PoC `motion.js`: no DOM, caller-allocated buffers.

export interface DiffOptions {
  pixelDiffThreshold: number;
  brightnessNormalize: boolean;
  /** Non-zero = pixel ignored (not counted). */
  exclude?: Uint8Array;
}

/** RGBA → luma `(77r + 150g + 29b) >> 8` into `out` (length = pixel count). Returns the mean luma. */
export function toLuma(rgba: ArrayLike<number>, out: Uint8Array): number {
  const n = out.length;
  let sum = 0;
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const y = (77 * (rgba[j] as number) + 150 * (rgba[j + 1] as number) + 29 * (rgba[j + 2] as number)) >> 8;
    out[i] = y;
    sum += y;
  }
  return sum / n;
}

/**
 * Counts pixels where |curr − prev − offset| > pixelDiffThreshold; offset = mean shift when normalising.
 * mask: optional Uint32Array over RGBA pixels (e.g. an ImageData buffer), changed = white, else black.
 */
export function diffLuma(
  curr: Uint8Array,
  prev: Uint8Array,
  meanCurr: number,
  meanPrev: number,
  opts: DiffOptions,
  mask?: Uint32Array,
): number {
  const { pixelDiffThreshold, brightnessNormalize, exclude } = opts;
  const offset = brightnessNormalize ? meanCurr - meanPrev : 0;
  const n = curr.length;
  let changed = 0;
  for (let i = 0; i < n; i++) {
    let hit = false;
    if (!exclude?.[i]) {
      const d = (curr[i] as number) - (prev[i] as number) - offset;
      hit = (d < 0 ? -d : d) > pixelDiffThreshold;
      if (hit) changed++;
    }
    if (mask) mask[i] = hit ? 0xffffffff : 0xff000000;
  }
  return changed;
}
