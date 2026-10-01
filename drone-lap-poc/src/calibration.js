// Pure threshold calibration from idle-scene ratios, no DOM.
export const MIN_START = 0.002;   // floor: a perfectly static scene (all zeros) must not trigger on one pixel

// calibrate(ratios, k) -> { n, mean, sigma, max, startRatio, endRatio, hint }
// startRatio = max(mean + k*sigma, 1.2*max, MIN_START), endRatio = startRatio / 2.
export function calibrate(ratios, k) {
  const n = ratios.length;
  if (n === 0) return null;
  let sum = 0, max = 0;
  for (const r of ratios) { sum += r; if (r > max) max = r; }
  const mean = sum / n;
  let sq = 0;
  for (const r of ratios) sq += (r - mean) ** 2;
  const sigma = Math.sqrt(sq / n);
  const startRatio = Math.max(mean + k * sigma, 1.2 * max, MIN_START);
  return {
    n, mean, sigma, max, startRatio, endRatio: startRatio / 2,
    hint: mean > 0.01 ? 'idle noise is high (mean > 1%): check lighting, exposure and ROI' : null,
  };
}
