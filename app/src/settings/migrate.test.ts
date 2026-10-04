import { describe, expect, it } from 'vitest';
import { migrateV1, V1_KEYS } from './migrate.ts';
import { DEFAULTS, FIELDS, SCHEMA } from './schema.ts';
import { OLD_POC_PAYLOAD, POC_PAYLOAD } from './test/poc-payloads.ts';
import { sanitize } from './validate.ts';

describe('migrateV1', () => {
  it('maps every v2 setting except the new ones (facing, device, audio, roi on its own)', () => {
    const mapped = new Set(Object.values(V1_KEYS));
    const unmapped = SCHEMA.map((f) => f.key).filter((k) => !mapped.has(k));
    expect(unmapped.sort()).toEqual(
      [
        'audio.announceBest',
        'audio.beep',
        'audio.voice',
        'camera.deviceId',
        'camera.facing',
        'detection.roi',
      ].sort(),
    );
    for (const k of mapped) expect(FIELDS.has(k)).toBe(true);
  });

  it('a full PoC payload lands in its v2 groups', () => {
    const s = sanitize(migrateV1(POC_PAYLOAD));
    expect(s.camera).toEqual({
      ...DEFAULTS.camera,
      width: 320,
      height: 640,
      exposureManual: false,
      exposureTime: 50,
      focusLock: true,
      fps: 60,
      fpsExact: true,
    });
    expect(s.detection).toEqual({
      pixelDiffThreshold: 14,
      brightnessNormalize: true,
      globalGuard: true,
      globalGuardRatio: 0.3,
      processingMaxSize: 160,
      readbackHint: false,
      startRatio: 0.035,
      endRatio: 0.012,
      minMotionMs: 40,
      endHoldMs: 80,
      cooldownMs: 2500,
      maxMotionMs: 2000,
      warmupMs: 1000,
      resetGapMs: 300,
      roi: { x: 0.425, y: 0.1, width: 0.15, height: 0.8 },
    });
    expect(s.calibration).toEqual({ durationMs: 4000, k: 6 });
    expect(s.audio).toEqual(DEFAULTS.audio);
  });

  it('drops legacy keys; a partial roi keeps the PoC default for the rest', () => {
    const m = migrateV1(OLD_POC_PAYLOAD);
    expect(JSON.stringify(m)).not.toMatch(/minMotionFrames|showDisplay/);
    const s = sanitize(m);
    expect(m.detection?.roi).toEqual({ x: 0.2, y: 0.25, width: 1, height: 1 });
    expect(s.detection.roi).toEqual(DEFAULTS.detection.roi); // outside the frame → default
    const partial = sanitize(migrateV1({ roi: { x: 0.5, width: 0.5, height: 'tall' } }));
    expect(partial.detection.roi).toEqual({ x: 0.5, y: 0, width: 0.5, height: 1 });
    expect(s.detection.startRatio).toBe(0.05);
    expect(s.detection.cooldownMs).toBe(2000);
  });

  it('out-of-range PoC values fall back per field; cross-field rules apply', () => {
    const s = sanitize(
      migrateV1({
        cameraFps: 25,
        pixelDiffThreshold: 300,
        startRatio: 0.01,
        endRatio: 0.05,
        exposureTime: 'x',
      }),
    );
    expect(s.camera.fps).toBe(30);
    expect(s.detection.pixelDiffThreshold).toBe(10);
    expect(s.camera.exposureTime).toBe(100);
    expect(s.detection.startRatio).toBe(0.01);
    expect(s.detection.endRatio).toBe(0.005);
  });

  it('non-objects migrate to nothing', () => {
    for (const raw of [null, 5, 'x', [1, 2]]) expect(sanitize(migrateV1(raw))).toEqual(DEFAULTS);
  });
});
