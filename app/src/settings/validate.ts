// Schema-driven validation (spec §2.6). Pure.
import type { Roi, Settings } from '../engine/types.ts';
import {
  DEFAULTS,
  type FieldMeta,
  getSetting,
  ROI_MIN_SIZE,
  SCHEMA,
  type SettingKey,
  setSetting,
} from './schema.ts';

export type SettingErrors = Partial<Record<SettingKey, string>>;

const pct = (v: number) => `${+(v * 100).toPrecision(3)}%`;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const EPS = 1e-9;

function roiError(v: unknown): string | null {
  if (typeof v !== 'object' || v === null) return 'Invalid region';
  const r = v as Record<string, unknown>;
  if (![r.x, r.y, r.width, r.height].every(isNum)) return 'Invalid region';
  const { x, y, width, height } = r as unknown as Roi;
  if (x < 0 || y < 0) return 'Region must start inside the frame';
  if (width < ROI_MIN_SIZE - EPS || height < ROI_MIN_SIZE - EPS)
    return `Region must be at least ${pct(ROI_MIN_SIZE)}`;
  if (x + width > 1 + EPS || y + height > 1 + EPS) return 'Region must stay inside the frame';
  return null;
}

/** Error text for one field value on its own, or null when valid. */
export function fieldError(f: FieldMeta, v: unknown): string | null {
  switch (f.type) {
    case 'number':
      if (!isNum(v)) return 'Enter a number';
      if (f.int && !Number.isInteger(v)) return 'Enter a whole number';
      if (v < f.min || v > f.max) return `Must be ${f.min}–${f.max}${f.unit ? ` ${f.unit}` : ''}`;
      return null;
    case 'ratio':
      if (!isNum(v)) return 'Enter a number';
      if (v < f.min - EPS || v > f.max + EPS) return `Must be ${pct(f.min)}–${pct(f.max)}`;
      return null;
    case 'select':
      return isNum(v) && f.options.includes(v) ? null : 'Pick one of the options';
    case 'bool':
      return typeof v === 'boolean' ? null : 'Invalid value';
    case 'enum':
      return f.options.some((o) => o.value === v) ? null : 'Pick one of the options';
    case 'device':
      return v === null || (typeof v === 'string' && v !== '') ? null : 'Invalid camera';
    case 'roi':
      return roiError(v);
  }
}

/** Cross-field rules; reported on the dependent field. */
function crossErrors(s: Settings): SettingErrors {
  const d = s.detection;
  const errors: SettingErrors = {};
  if (isNum(d.endRatio) && isNum(d.startRatio) && d.endRatio > d.startRatio + EPS) {
    errors['detection.endRatio'] = `Must be at most the start ratio (${pct(d.startRatio)})`;
  }
  if (isNum(d.maxMotionMs) && isNum(d.minMotionMs) && d.maxMotionMs <= d.minMotionMs) {
    errors['detection.maxMotionMs'] = `Must be more than min motion (${d.minMotionMs} ms)`;
  }
  return errors;
}

/** All errors of a draft; empty when it can be saved. */
export function validate(s: Settings): SettingErrors {
  const errors: SettingErrors = {};
  for (const f of SCHEMA) {
    const e = fieldError(f, getSetting(s, f.key));
    if (e) errors[f.key] = e;
  }
  return { ...crossErrors(s), ...errors };
}

export const isValid = (s: Settings) => Object.keys(validate(s)).length === 0;

/** Loaded data → valid Settings: bad fields fall back to their default, then cross-field fixes. */
export function sanitize(raw: unknown): Settings {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  let s = DEFAULTS;
  for (const f of SCHEMA) {
    const [g, k] = f.key.split('.') as [string, string];
    const group = src[g];
    const v = typeof group === 'object' && group !== null ? (group as Record<string, unknown>)[k] : undefined;
    if (v !== undefined && fieldError(f, v) === null)
      s = setSetting(s, f.key, f.type === 'roi' ? { ...(v as Roi) } : v);
  }
  const d = s.detection;
  if (d.endRatio > d.startRatio) s = setSetting(s, 'detection.endRatio', d.startRatio / 2);
  if (d.maxMotionMs <= d.minMotionMs)
    s = setSetting(s, 'detection.maxMotionMs', DEFAULTS.detection.maxMotionMs);
  return s;
}

function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    const keys = Object.keys(ra);
    return keys.length === Object.keys(rb).length && keys.every((k) => Object.is(ra[k], rb[k]));
  }
  return Object.is(a, b);
}

export function equalSettings(a: Settings, b: Settings): boolean {
  return SCHEMA.every((f) => same(getSetting(a, f.key), getSetting(b, f.key)));
}

/** Keys whose value differs from the default ("changed" dot). */
export function isDefault(s: Settings, key: SettingKey): boolean {
  return same(getSetting(s, key), getSetting(DEFAULTS, key));
}
