import { describe, expect, it } from 'vitest';
import type { Settings } from '../engine/types.ts';
import { DEFAULTS, field, ROI_PRESETS, SCHEMA, setSetting } from './schema.ts';
import { equalSettings, fieldError, isDefault, isValid, sanitize, validate } from './validate.ts';

describe('fieldError: range tests for every key', () => {
  for (const f of SCHEMA) {
    describe(f.key, () => {
      it('accepts the default', () => expect(fieldError(f, f.default)).toBeNull());

      switch (f.type) {
        case 'number':
        case 'ratio':
          it('accepts min and max', () => {
            expect(fieldError(f, f.min)).toBeNull();
            expect(fieldError(f, f.max)).toBeNull();
          });
          it('rejects out of range', () => {
            expect(fieldError(f, f.min - f.step)).toMatch(/^Must be/);
            expect(fieldError(f, f.max + f.step)).toMatch(/^Must be/);
          });
          it('rejects wrong type, NaN and Infinity', () => {
            for (const v of ['10', null, undefined, true, Number.NaN, Number.POSITIVE_INFINITY]) {
              expect(fieldError(f, v)).toBe('Enter a number');
            }
          });
          if (f.type === 'number' && f.int) {
            it('rejects fractions', () => expect(fieldError(f, f.min + 0.5)).toBe('Enter a whole number'));
          }
          break;
        case 'select':
          it('accepts each option, rejects others', () => {
            for (const o of f.options) expect(fieldError(f, o)).toBeNull();
            expect(fieldError(f, 25)).not.toBeNull();
            expect(fieldError(f, '30')).not.toBeNull();
          });
          break;
        case 'bool':
          it('rejects non-booleans', () => {
            for (const v of ['true', 1, null]) expect(fieldError(f, v)).not.toBeNull();
          });
          break;
        case 'enum':
          it('accepts each option, rejects others', () => {
            for (const o of f.options) expect(fieldError(f, o.value)).toBeNull();
            expect(fieldError(f, 'side')).not.toBeNull();
          });
          break;
        case 'device':
          it('accepts null or an id, rejects empty and non-strings', () => {
            expect(fieldError(f, 'abc123')).toBeNull();
            expect(fieldError(f, '')).not.toBeNull();
            expect(fieldError(f, 5)).not.toBeNull();
          });
          break;
        case 'roi':
          it('accepts every preset and a custom region at the edges', () => {
            for (const p of Object.values(ROI_PRESETS)) expect(fieldError(f, p)).toBeNull();
            expect(fieldError(f, { x: 0.95, y: 0.95, width: 0.05, height: 0.05 })).toBeNull();
          });
          it('rejects regions outside the frame or too small', () => {
            expect(fieldError(f, { x: -0.1, y: 0, width: 0.5, height: 0.5 })).toMatch(/inside/);
            expect(fieldError(f, { x: 0.6, y: 0, width: 0.5, height: 0.5 })).toMatch(/inside/);
            expect(fieldError(f, { x: 0, y: 0.6, width: 0.5, height: 0.5 })).toMatch(/inside/);
            expect(fieldError(f, { x: 0, y: 0, width: 0.04, height: 0.5 })).toMatch(/at least/);
            expect(fieldError(f, { x: 0, y: 0, width: 0.5, height: 0.01 })).toMatch(/at least/);
          });
          it('rejects malformed regions', () => {
            for (const v of [null, 'full', { x: 0, y: 0, width: 1 }, { x: '0', y: 0, width: 1, height: 1 }]) {
              expect(fieldError(f, v)).toBe('Invalid region');
            }
          });
          break;
      }
    });
  }
});

describe('validate: cross-field rules', () => {
  const withDetection = (patch: Partial<Settings['detection']>): Settings => ({
    ...DEFAULTS,
    detection: { ...DEFAULTS.detection, ...patch },
  });

  it('defaults are valid', () => {
    expect(validate(DEFAULTS)).toEqual({});
    expect(isValid(DEFAULTS)).toBe(true);
  });

  it('endRatio ≤ startRatio', () => {
    expect(validate(withDetection({ startRatio: 0.02, endRatio: 0.02 }))).toEqual({});
    expect(validate(withDetection({ startRatio: 0.01, endRatio: 0.02 }))).toEqual({
      'detection.endRatio': 'Must be at most the start ratio (1%)',
    });
  });

  it('maxMotionMs > minMotionMs', () => {
    expect(validate(withDetection({ minMotionMs: 300, maxMotionMs: 301 }))).toEqual({});
    expect(validate(withDetection({ minMotionMs: 300, maxMotionMs: 300 }))).toEqual({
      'detection.maxMotionMs': 'Must be more than min motion (300 ms)',
    });
  });

  it('a field error wins over a cross-field error on the same key', () => {
    const errors = validate(withDetection({ startRatio: 0.01, endRatio: 0.9 }));
    expect(errors['detection.endRatio']).toMatch(/^Must be 0.01%/);
  });

  it('reports every invalid field at once', () => {
    const s = setSetting(setSetting(DEFAULTS, 'camera.fps', 25), 'audio.beep', 'yes');
    expect(Object.keys(validate(s)).sort()).toEqual(['audio.beep', 'camera.fps']);
    expect(isValid(s)).toBe(false);
  });
});

describe('sanitize', () => {
  it('non-objects and empty input give the defaults', () => {
    for (const raw of [null, undefined, 42, 'x', [], {}]) expect(sanitize(raw)).toEqual(DEFAULTS);
  });

  it('keeps valid fields and defaults each bad one on its own', () => {
    const s = sanitize({
      version: 2,
      camera: { fps: 60, width: 'wide', height: 99999, facing: 'environment' },
      detection: { pixelDiffThreshold: 20, cooldownMs: -5 },
      audio: { voice: false, beep: 'off' },
    });
    expect(s.camera).toMatchObject({ fps: 60, width: 240, height: 480, facing: 'environment' });
    expect(s.detection).toMatchObject({ pixelDiffThreshold: 20, cooldownMs: 1500 });
    expect(s.audio).toEqual({ beep: true, voice: false, announceBest: true });
  });

  it('drops unknown keys and forces version 2', () => {
    const s = sanitize({ version: 1, camera: { minMotionFrames: 3 }, extra: { a: 1 } });
    expect(s).toEqual(DEFAULTS);
  });

  it('fixes endRatio > startRatio to startRatio / 2', () => {
    const s = sanitize({ detection: { startRatio: 0.004, endRatio: 0.01 } });
    expect(s.detection.startRatio).toBe(0.004);
    expect(s.detection.endRatio).toBe(0.002);
  });

  it('fixes maxMotionMs ≤ minMotionMs to the default', () => {
    const s = sanitize({ detection: { minMotionMs: 400, maxMotionMs: 300 } });
    expect(s.detection.maxMotionMs).toBe(3000);
  });

  it('an ROI outside the frame falls back to the full frame; a valid one is copied', () => {
    expect(sanitize({ detection: { roi: { x: 0.5, y: 0, width: 0.6, height: 1 } } }).detection.roi).toEqual(
      ROI_PRESETS.full,
    );
    const roi = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
    const s = sanitize({ detection: { roi } });
    expect(s.detection.roi).toEqual(roi);
    expect(s.detection.roi).not.toBe(roi);
  });

  it('output always validates', () => {
    const s = sanitize({
      detection: { startRatio: 0.0005, endRatio: 0.5, minMotionMs: 500, maxMotionMs: 200 },
    });
    expect(validate(s)).toEqual({});
  });
});

describe('equalSettings / isDefault', () => {
  it('compares by value, incl. the ROI', () => {
    expect(equalSettings(DEFAULTS, structuredClone(DEFAULTS))).toBe(true);
    expect(equalSettings(DEFAULTS, setSetting(DEFAULTS, 'camera.fps', 60))).toBe(false);
    expect(equalSettings(DEFAULTS, setSetting(DEFAULTS, 'detection.roi', { ...ROI_PRESETS.box }))).toBe(
      false,
    );
    expect(equalSettings(DEFAULTS, setSetting(DEFAULTS, 'detection.roi', { ...ROI_PRESETS.full }))).toBe(
      true,
    );
  });

  it('isDefault per key', () => {
    const s = setSetting(DEFAULTS, 'detection.cooldownMs', 2000);
    expect(isDefault(s, 'detection.cooldownMs')).toBe(false);
    expect(isDefault(s, 'detection.warmupMs')).toBe(true);
    expect(isDefault(setSetting(DEFAULTS, 'detection.roi', { ...ROI_PRESETS.full }), 'detection.roi')).toBe(
      true,
    );
  });

  it('NaN drafts are not equal to the defaults', () => {
    expect(equalSettings(DEFAULTS, setSetting(DEFAULTS, 'camera.width', Number.NaN))).toBe(false);
    expect(fieldError(field('camera.width'), Number.NaN)).toBe('Enter a number');
  });
});
