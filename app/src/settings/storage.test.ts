import { describe, expect, it } from 'vitest';
import { DEFAULTS, setSetting } from './schema.ts';
import {
  type Backend,
  createSettingsStorage,
  createUiStorage,
  memoryBackend,
  POC_SETTINGS_KEY,
  SETTINGS_KEY,
  UI_KEY,
} from './storage.ts';
import { POC_PAYLOAD } from './test/poc-payloads.ts';

const throwing = (on: 'get' | 'set'): Backend => ({
  getItem: () => {
    if (on === 'get') throw new Error('SecurityError');
    return null;
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
});

describe('settings storage', () => {
  it('uses the dronelap.-prefixed v2 key', () => {
    expect(SETTINGS_KEY).toBe('dronelap.settings.v2');
  });

  it('empty storage loads the defaults', () => {
    expect(createSettingsStorage(memoryBackend()).load()).toEqual(DEFAULTS);
  });

  it('save writes JSON; a new instance loads it back', () => {
    const backend = memoryBackend();
    const s = setSetting(DEFAULTS, 'camera.fps', 60);
    expect(createSettingsStorage(backend).save(s)).toBe(true);
    expect(JSON.parse(backend.getItem(SETTINGS_KEY) ?? '')).toEqual(s);
    expect(createSettingsStorage(backend).load()).toEqual(s);
  });

  it('load sanitizes stored values', () => {
    const backend = memoryBackend({ [SETTINGS_KEY]: JSON.stringify({ camera: { fps: 25, width: 320 } }) });
    const s = createSettingsStorage(backend).load();
    expect(s.camera.fps).toBe(30);
    expect(s.camera.width).toBe(320);
  });

  it('corrupt JSON loads the defaults', () => {
    expect(createSettingsStorage(memoryBackend({ [SETTINGS_KEY]: '{oops' })).load()).toEqual(DEFAULTS);
  });

  it('unreadable storage loads the defaults', () => {
    expect(createSettingsStorage(throwing('get')).load()).toEqual(DEFAULTS);
  });

  it('a failing write returns false but keeps the settings in memory', () => {
    const storage = createSettingsStorage(throwing('set'));
    const s = setSetting(DEFAULTS, 'audio.voice', false);
    expect(storage.save(s)).toBe(false);
    expect(storage.load()).toEqual(s);
  });

  it('no backend: in memory only, save reports false', () => {
    const storage = createSettingsStorage(null);
    expect(storage.load()).toEqual(DEFAULTS);
    const s = setSetting(DEFAULTS, 'audio.beep', false);
    expect(storage.save(s)).toBe(false);
    expect(storage.load()).toEqual(s);
  });

  it('defaults to localStorage when present, null when access throws', () => {
    const g = globalThis as { localStorage?: unknown };
    const backend = memoryBackend();
    g.localStorage = backend;
    try {
      expect(createSettingsStorage().save(DEFAULTS)).toBe(true);
      expect(backend.getItem(SETTINGS_KEY)).not.toBeNull();
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        get() {
          throw new Error('SecurityError');
        },
      });
      expect(createSettingsStorage().save(DEFAULTS)).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: undefined,
        writable: true,
      });
      delete g.localStorage;
    }
  });
});

describe('PoC migration', () => {
  it('without v2, PoC-saved settings migrate and the v1 key is left alone', () => {
    const raw = JSON.stringify(POC_PAYLOAD);
    const backend = memoryBackend({ [POC_SETTINGS_KEY]: raw });
    const s = createSettingsStorage(backend).load();
    expect(s.detection.startRatio).toBe(0.035);
    expect(s.camera.fps).toBe(60);
    expect(s.calibration.k).toBe(6);
    expect(backend.getItem(POC_SETTINGS_KEY)).toBe(raw);
    expect(backend.getItem(SETTINGS_KEY)).toBeNull(); // written only on Save
  });

  it('v2 wins over v1', () => {
    const v2 = setSetting(DEFAULTS, 'detection.startRatio', 0.04);
    const backend = memoryBackend({
      [SETTINGS_KEY]: JSON.stringify(v2),
      [POC_SETTINGS_KEY]: JSON.stringify(POC_PAYLOAD),
    });
    expect(createSettingsStorage(backend).load()).toEqual(v2);
  });

  it('corrupt v1 JSON loads the defaults', () => {
    expect(createSettingsStorage(memoryBackend({ [POC_SETTINGS_KEY]: '{not json' })).load()).toEqual(
      DEFAULTS,
    );
  });
});

describe('ui storage', () => {
  it('uses dronelap.ui.v1; round-trips installHintDismissed', () => {
    const backend = memoryBackend();
    expect(createUiStorage(backend).load()).toEqual({ installHintDismissed: false });
    expect(createUiStorage(backend).save({ installHintDismissed: true })).toBe(true);
    expect(JSON.parse(backend.getItem(UI_KEY) ?? '')).toEqual({ installHintDismissed: true });
    expect(createUiStorage(backend).load()).toEqual({ installHintDismissed: true });
  });

  it('corrupt or wrong-typed data loads the defaults', () => {
    for (const raw of ['{oops', '{"installHintDismissed":"yes"}', '7'])
      expect(createUiStorage(memoryBackend({ [UI_KEY]: raw })).load()).toEqual({
        installHintDismissed: false,
      });
  });

  it('failing or missing storage keeps the value in memory and reports false', () => {
    for (const backend of [throwing('set'), null]) {
      const ui = createUiStorage(backend);
      expect(ui.save({ installHintDismissed: true })).toBe(false);
      expect(ui.load()).toEqual({ installHintDismissed: true });
    }
  });
});
