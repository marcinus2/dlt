import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSettings, saveSettings, clearSettings } from '../src/storage.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
};
const defaults = () => ({ startRatio: 0.02, brightnessNormalize: true, roi: { x: 0.2, y: 0.25 } });

test('save then load round-trips', () => {
  const s = memory(), a = defaults();
  a.startRatio = 0.05; a.brightnessNormalize = false; a.roi.x = 0.5;
  saveSettings(a, s);
  const b = defaults();
  loadSettings(b, s);
  assert.deepEqual(b, a);
});

test('empty or corrupt storage keeps defaults', () => {
  const b = defaults();
  loadSettings(b, memory());
  assert.deepEqual(b, defaults());
  const s = memory();
  s.setItem('dronelap.settings.v1', '{not json');
  loadSettings(b, s);
  assert.deepEqual(b, defaults());
});

test('wrong types, non-finite values and unknown keys are ignored', () => {
  const s = memory();
  s.setItem('dronelap.settings.v1', JSON.stringify({ startRatio: 'x', brightnessNormalize: 1, extra: 5, roi: { x: null, y: 0.4 } }));
  const b = defaults();
  loadSettings(b, s);
  assert.deepEqual(b, { startRatio: 0.02, brightnessNormalize: true, roi: { x: 0.2, y: 0.4 } });
  assert.equal('extra' in b, false);
});

test('clear removes saved settings; throwing storage is tolerated', () => {
  const s = memory();
  saveSettings(defaults(), s);
  clearSettings(s);
  const b = defaults(); b.startRatio = 0.9;
  loadSettings(b, s);
  assert.equal(b.startRatio, 0.9);
  const bad = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  assert.doesNotThrow(() => { loadSettings(b, bad); saveSettings(b, bad); clearSettings(bad); });
});
