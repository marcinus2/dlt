// PoC settings (`dronelap.settings.v1`, flat keys) → v2 groups (spec §2.6). Pure. Only maps keys:
// values are checked by sanitize(); keys without a v2 home (showDisplay, minMotionFrames, …) are dropped.
import { ROI_PRESETS, type SettingKey } from './schema.ts';

/** PoC key → v2 setting. `roi` is handled on its own. */
export const V1_KEYS: Readonly<Record<string, SettingKey>> = {
  cameraWidth: 'camera.width',
  cameraHeight: 'camera.height',
  cameraFps: 'camera.fps',
  fpsExact: 'camera.fpsExact',
  exposureManual: 'camera.exposureManual',
  exposureTime: 'camera.exposureTime',
  focusLock: 'camera.focusLock',
  processingMaxSize: 'detection.processingMaxSize',
  pixelDiffThreshold: 'detection.pixelDiffThreshold',
  brightnessNormalize: 'detection.brightnessNormalize',
  globalGuard: 'detection.globalGuard',
  globalGuardRatio: 'detection.globalGuardRatio',
  readbackHint: 'detection.readbackHint',
  startRatio: 'detection.startRatio',
  endRatio: 'detection.endRatio',
  minMotionMs: 'detection.minMotionMs',
  endHoldMs: 'detection.endHoldMs',
  cooldownMs: 'detection.cooldownMs',
  maxMotionMs: 'detection.maxMotionMs',
  warmupMs: 'detection.warmupMs',
  resetGapMs: 'detection.resetGapMs',
  calibrationMs: 'calibration.durationMs',
  calibrationK: 'calibration.k',
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Flat PoC object → `{ camera, detection, calibration }` for sanitize(); anything else → {}. */
export function migrateV1(raw: unknown): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  if (!isObject(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    const key = V1_KEYS[k];
    if (!key) continue;
    const [g, f] = key.split('.') as [string, string];
    out[g] = { ...out[g], [f]: v };
  }
  if (isObject(raw.roi)) {
    // The PoC kept each valid roi key over its default (full frame).
    const roi: Record<string, unknown> = { ...ROI_PRESETS.full };
    for (const k of Object.keys(roi)) if (typeof raw.roi[k] === 'number') roi[k] = raw.roi[k];
    out.detection = { ...out.detection, roi };
  }
  return out;
}
