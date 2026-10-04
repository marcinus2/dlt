// Pure threshold calibration from idle-scene ratios, ported 1:1 from the PoC `calibration.js`,
// plus the sample collector of the PoC's Calibrate button (`collectCalibration` in main.js).
import type { Ms } from './types.ts';

/** Floor: a perfectly static scene (all zeros) must not trigger on one pixel. */
export const MIN_START = 0.002;

export interface Calibration {
  n: number;
  mean: number;
  sigma: number;
  max: number;
  startRatio: number;
  endRatio: number;
  hint: string | null;
}

/** startRatio = max(mean + k·σ, 1.2·max, MIN_START), endRatio = startRatio / 2. null without samples. */
export function calibrate(ratios: ArrayLike<number>, k: number): Calibration | null {
  const n = ratios.length;
  if (n === 0) return null;
  let sum = 0;
  let max = 0;
  for (let i = 0; i < n; i++) {
    const r = ratios[i] as number;
    sum += r;
    if (r > max) max = r;
  }
  const mean = sum / n;
  let sq = 0;
  for (let i = 0; i < n; i++) sq += ((ratios[i] as number) - mean) ** 2;
  const sigma = Math.sqrt(sq / n);
  const startRatio = Math.max(mean + k * sigma, 1.2 * max, MIN_START);
  return {
    n,
    mean,
    sigma,
    max,
    startRatio,
    endRatio: startRatio / 2,
    hint: mean > 0.01 ? 'idle noise is high (mean > 1%): check lighting, exposure and ROI' : null,
  };
}

/** Highest frame rate the collector keeps room for; later frames of a longer window are dropped. */
export const MAX_CALIBRATION_FPS = 120;

export type CalibrationStep = { done: false; progress: number } | { done: true; result: Calibration | null }; // null: no usable frames

/**
 * Collects idle-scene ratios for `durationMs` from the first frame, skipping `global` frames
 * (no previous frame, guard tripped). One preallocated buffer, no allocation per frame.
 */
export function createCalibrator(durationMs: Ms, k: number) {
  const buf = new Float64Array(Math.ceil((durationMs / 1000) * MAX_CALIBRATION_FPS) + 1);
  const pending = { done: false as const, progress: 0 };
  let n = 0;
  let startT: Ms | null = null;
  let result: CalibrationStep | null = null;
  return {
    add(t: Ms, ratio: number, global: boolean): CalibrationStep {
      if (result) return result;
      startT ??= t;
      if (!global && n < buf.length) buf[n++] = ratio;
      if (t - startT < durationMs) {
        pending.progress = (t - startT) / durationMs;
        return pending;
      }
      result = { done: true, result: calibrate(buf.subarray(0, n), k) };
      return result;
    },
  };
}
