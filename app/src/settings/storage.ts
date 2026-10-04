// Persistence (spec §2.6): `dronelap.settings.v2`, written only on Save; without it the PoC's
// `dronelap.settings.v1` is migrated (and left alone). `dronelap.ui.v1` holds UI flags, written on
// change. In-memory fallback when storage is unavailable.
import type { Settings } from '../engine/types.ts';
import { migrateV1 } from './migrate.ts';
import { DEFAULTS } from './schema.ts';
import { sanitize } from './validate.ts';

export const SETTINGS_KEY = 'dronelap.settings.v2';
export const POC_SETTINGS_KEY = 'dronelap.settings.v1';
export const UI_KEY = 'dronelap.ui.v1';

export type Backend = Pick<Storage, 'getItem' | 'setItem'>;

export interface SettingsStorage {
  load(): Settings;
  /** false = could not be persisted (kept in memory). */
  save(s: Settings): boolean;
}

function localBackend(): Backend | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // e.g. blocked storage throws on access
  }
}

export function createSettingsStorage(backend: Backend | null = localBackend()): SettingsStorage {
  let memory: Settings | null = null;
  return {
    load() {
      if (memory) return memory;
      try {
        const raw = backend?.getItem(SETTINGS_KEY);
        const poc = raw ? null : backend?.getItem(POC_SETTINGS_KEY);
        memory = raw ? sanitize(JSON.parse(raw)) : poc ? sanitize(migrateV1(JSON.parse(poc))) : DEFAULTS;
      } catch {
        memory = DEFAULTS; // unreadable storage or corrupt JSON
      }
      return memory;
    },
    save(s) {
      memory = s;
      if (!backend) return false;
      try {
        backend.setItem(SETTINGS_KEY, JSON.stringify(s));
        return true;
      } catch {
        return false; // quota exceeded / private mode
      }
    },
  };
}

export interface UiPrefs {
  installHintDismissed: boolean;
}

export interface UiStorage {
  load(): UiPrefs;
  /** false = could not be persisted (kept in memory). */
  save(p: UiPrefs): boolean;
}

const UI_DEFAULTS: UiPrefs = { installHintDismissed: false };

export function createUiStorage(backend: Backend | null = localBackend()): UiStorage {
  let memory: UiPrefs | null = null;
  return {
    load() {
      if (memory) return memory;
      memory = UI_DEFAULTS;
      try {
        const raw = JSON.parse(backend?.getItem(UI_KEY) ?? 'null') as Partial<UiPrefs> | null;
        if (typeof raw?.installHintDismissed === 'boolean')
          memory = { installHintDismissed: raw.installHintDismissed };
      } catch {
        // corrupt or unreadable: defaults
      }
      return memory;
    },
    save(p) {
      memory = p;
      try {
        backend?.setItem(UI_KEY, JSON.stringify(p));
        return backend !== null;
      } catch {
        return false;
      }
    },
  };
}

/** In-memory backend: gallery (G12) and tests. */
export function memoryBackend(init: Record<string, string> = {}): Backend {
  const data = new Map(Object.entries(init));
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}
