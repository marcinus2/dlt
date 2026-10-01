// Config persistence. Storage is injectable so the logic runs under node --test; every access is try/catch'd.
const KEY = 'dronelap.settings.v1';
const ok = (v, ref) => typeof v === typeof ref && (typeof v !== 'number' || Number.isFinite(v));

export function loadSettings(config, storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage.getItem(KEY));
    if (!saved || typeof saved !== 'object') return;
    for (const key of Object.keys(config)) {
      if (key === 'roi') {
        for (const k of Object.keys(config.roi)) if (ok(saved.roi?.[k], config.roi[k])) config.roi[k] = saved.roi[k];
      } else if (ok(saved[key], config[key])) {
        config[key] = saved[key];
      }
    }
  } catch { /* unavailable or corrupt: keep defaults */ }
}

export function saveSettings(config, storage = globalThis.localStorage) {
  try { storage.setItem(KEY, JSON.stringify(config)); } catch { /* ignore */ }
}

export function clearSettings(storage = globalThis.localStorage) {
  try { storage.removeItem(KEY); } catch { /* ignore */ }
}
