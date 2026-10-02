import { describe, expect, it } from 'vitest';
import { DEFAULTS, FIELDS, field, GROUPS, getSetting, ROI_PRESETS, SCHEMA, setSetting } from './schema.ts';
import { fieldError } from './validate.ts';

describe('schema', () => {
  it('defaults are the current PoC defaults', () => {
    expect(DEFAULTS).toEqual({
      version: 2,
      camera: {
        facing: 'user',
        deviceId: null,
        fps: 30,
        exposureManual: true,
        exposureTime: 100,
        width: 240,
        height: 480,
        fpsExact: false,
        focusLock: false,
      },
      detection: {
        pixelDiffThreshold: 10,
        startRatio: 0.02,
        endRatio: 0.01,
        roi: { x: 0, y: 0, width: 1, height: 1 },
        brightnessNormalize: false,
        globalGuard: false,
        globalGuardRatio: 0.2,
        cooldownMs: 1500,
        warmupMs: 1500,
        minMotionMs: 30,
        endHoldMs: 60,
        maxMotionMs: 3000,
        processingMaxSize: 320,
        readbackHint: true,
        resetGapMs: 250,
      },
      calibration: { durationMs: 3000, k: 5 },
      audio: { beep: true, voice: true, announceBest: true },
    });
  });

  it('keys are unique and every default is valid', () => {
    expect(FIELDS.size).toBe(SCHEMA.length);
    for (const f of SCHEMA) expect(fieldError(f, f.default), f.key).toBeNull();
  });

  it('every field belongs to a known group and every group has fields', () => {
    const ids = GROUPS.map((g) => g.id);
    for (const f of SCHEMA) expect(ids).toContain(f.group);
    for (const id of ids)
      expect(
        SCHEMA.some((f) => f.group === id),
        id,
      ).toBe(true);
  });

  it('ROI presets are valid regions', () => {
    const roi = field('detection.roi');
    for (const p of Object.values(ROI_PRESETS)) expect(fieldError(roi, p)).toBeNull();
  });

  it('DEFAULTS roi is a copy, not the preset object', () => {
    expect(DEFAULTS.detection.roi).not.toBe(ROI_PRESETS.full);
  });

  it('get/set by key; set is immutable', () => {
    const s = setSetting(DEFAULTS, 'camera.fps', 60);
    expect(getSetting(s, 'camera.fps')).toBe(60);
    expect(DEFAULTS.camera.fps).toBe(30);
    expect(s.detection).toBe(DEFAULTS.detection);
  });

  it('field() throws on an unknown key', () => {
    expect(() => field('camera.nope' as never)).toThrow();
  });
});
