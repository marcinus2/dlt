import { describe, expect, it } from 'vitest';
import { DEFAULTS, setSetting } from './schema.ts';
import { type Backend, createSettingsStorage, memoryBackend, SETTINGS_KEY } from './storage.ts';

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
