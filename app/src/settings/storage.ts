// Settings persistence (spec §2.6): `dronelap.settings.v2`, written only on Save,
// in-memory fallback when storage is unavailable. PoC v1 migration comes in M7.
import type { Settings } from '../engine/types.ts';
import { DEFAULTS } from './schema.ts';
import { sanitize } from './validate.ts';

export const SETTINGS_KEY = 'dronelap.settings.v2';

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
        memory = raw ? sanitize(JSON.parse(raw)) : DEFAULTS;
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
