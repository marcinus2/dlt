// Synthetic luma frames (spec §5.3): a dark blob crossing a bright, slightly noisy background.
// Deterministic (seeded) so tests and fixtures are reproducible.
import type { Ms } from '../types.ts';

/** Small seeded PRNG, uniform in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ClipOptions {
  fps: number;
  durationMs: Ms;
  /** Blob enters (left edge just outside the frame) at each of these times. */
  passAt: readonly Ms[];
  /** Time to cross from fully outside left to fully outside right. */
  crossMs?: Ms;
  width?: number;
  height?: number;
  blob?: number;
  bg?: number;
  fg?: number;
  /** Uniform noise amplitude (±), applied per pixel per frame. */
  noise?: number;
  seed?: number;
}

export interface Clip {
  width: number;
  height: number;
  frameCount: number;
  /** Frame time of frame i. */
  t(i: number): Ms;
  /** Renders frame i into `out` (length width·height). */
  render(i: number, out: Uint8Array): void;
}

export function syntheticClip(o: ClipOptions): Clip {
  const width = o.width ?? 64;
  const height = o.height ?? 96;
  const blob = o.blob ?? 24;
  const bg = o.bg ?? 200;
  const fg = o.fg ?? 30;
  const noise = o.noise ?? 3;
  const crossMs = o.crossMs ?? 300;
  const random = mulberry32(o.seed ?? 1);
  const frameCount = Math.floor((o.durationMs * o.fps) / 1000);
  const t = (i: number) => (i * 1000) / o.fps;
  const y0 = Math.floor((height - blob) / 2);

  return {
    width,
    height,
    frameCount,
    t,
    render(i, out) {
      const ti = t(i);
      let bx = Number.NaN;
      for (const at of o.passAt) {
        const p = (ti - at) / crossMs;
        if (p >= 0 && p <= 1) bx = Math.floor(-blob + p * (width + blob));
      }
      for (let y = 0; y < height; y++) {
        const inY = y >= y0 && y < y0 + blob;
        for (let x = 0; x < width; x++) {
          const base = inY && x >= bx && x < bx + blob ? fg : bg;
          out[y * width + x] = base + Math.round((random() * 2 - 1) * noise);
        }
      }
    },
  };
}

/** Writes a luma frame as RGBA (grey), e.g. for a fake canvas. */
export function lumaToRgba(luma: Uint8Array, out: Uint8ClampedArray): void {
  for (let i = 0, j = 0; i < luma.length; i++, j += 4) {
    const v = luma[i] as number;
    out[j] = v;
    out[j + 1] = v;
    out[j + 2] = v;
    out[j + 3] = 255;
  }
}
