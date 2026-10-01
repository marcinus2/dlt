import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toLuma, diffLuma } from '../src/motion.js';

const W = 100, H = 100, N = W * H;
const frame = (v) => new Uint8Array(N).fill(v);
const opts = { pixelDiffThreshold: 25, brightnessNormalize: true };
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const diff = (c, p, o = opts, mask) => diffLuma(c, p, mean(c), mean(p), o, mask);

test('toLuma: weights and mean', () => {
  const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]);
  const out = new Uint8Array(3);
  const m = toLuma(rgba, out);
  assert.deepEqual([...out], [255, 0, 77 * 255 >> 8]);
  assert.equal(m, (255 + 0 + out[2]) / 3);
});

test('identical frames -> 0', () => {
  const f = frame(100);
  assert.equal(diff(f, f.slice()), 0);
});

test('uniform +30 brightness: normalisation on -> 0, off -> 100%', () => {
  const prev = frame(100), curr = frame(130);
  assert.equal(diff(curr, prev), 0);
  assert.equal(diff(curr, prev, { ...opts, brightnessNormalize: false }), N);
});

test('one 10x10 block changed -> exact ratio', () => {
  const prev = frame(100), curr = frame(100);
  for (let y = 40; y < 50; y++) for (let x = 40; x < 50; x++) curr[y * W + x] = 200;
  // the block shifts the frame mean, so normalise off to isolate the count
  const count = diff(curr, prev, { ...opts, brightnessNormalize: false });
  assert.equal(count, 100);
  assert.equal(count / N, 0.01);
});

test('change at or below the threshold is not counted', () => {
  assert.equal(diff(frame(125), frame(100), { ...opts, brightnessNormalize: false }), 0);
  assert.equal(diff(frame(126), frame(100), { ...opts, brightnessNormalize: false }), N);
});

test('exclusion mask is respected', () => {
  const prev = frame(100), curr = frame(100);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) curr[y * W + x] = 200;
  const o = { ...opts, brightnessNormalize: false };
  assert.equal(diff(curr, prev, o), 100);
  const exclude = new Uint8Array(N);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 5; x++) exclude[y * W + x] = 1; // left half of the block
  assert.equal(diff(curr, prev, { ...o, exclude }), 50);
});

test('debug mask: changed white, rest black (excluded too)', () => {
  const prev = frame(100), curr = frame(100);
  curr[0] = 200; curr[1] = 200;
  const exclude = new Uint8Array(N);
  exclude[1] = 1;
  const mask = new Uint32Array(N);
  diff(curr, prev, { pixelDiffThreshold: 25, brightnessNormalize: false, exclude }, mask);
  assert.equal(mask[0], 0xffffffff);
  assert.equal(mask[1], 0xff000000);
  assert.equal(mask[2], 0xff000000);
});
