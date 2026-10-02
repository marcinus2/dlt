// Ported 1:1 from the PoC `test/motion.test.js`.
import { expect, it } from 'vitest';
import { type DiffOptions, diffLuma, toLuma } from './motion-core.ts';

const W = 100;
const H = 100;
const N = W * H;
const frame = (v: number) => new Uint8Array(N).fill(v);
const opts: DiffOptions = { pixelDiffThreshold: 25, brightnessNormalize: true };
const mean = (a: Uint8Array) => a.reduce((s, v) => s + v, 0) / a.length;
const diff = (c: Uint8Array, p: Uint8Array, o = opts, mask?: Uint32Array) =>
  diffLuma(c, p, mean(c), mean(p), o, mask);

it('toLuma: weights and mean', () => {
  const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]);
  const out = new Uint8Array(3);
  const m = toLuma(rgba, out);
  expect([...out]).toEqual([255, 0, (77 * 255) >> 8]);
  expect(m).toBe((255 + 0 + (out[2] as number)) / 3);
});

it('identical frames -> 0', () => {
  const f = frame(100);
  expect(diff(f, f.slice())).toBe(0);
});

it('uniform +30 brightness: normalisation on -> 0, off -> 100%', () => {
  const prev = frame(100);
  const curr = frame(130);
  expect(diff(curr, prev)).toBe(0);
  expect(diff(curr, prev, { ...opts, brightnessNormalize: false })).toBe(N);
});

it('one 10x10 block changed -> exact ratio', () => {
  const prev = frame(100);
  const curr = frame(100);
  for (let y = 40; y < 50; y++) for (let x = 40; x < 50; x++) curr[y * W + x] = 200;
  // the block shifts the frame mean, so normalise off to isolate the count
  const count = diff(curr, prev, { ...opts, brightnessNormalize: false });
  expect(count).toBe(100);
  expect(count / N).toBe(0.01);
});

it('change at or below the threshold is not counted', () => {
  expect(diff(frame(125), frame(100), { ...opts, brightnessNormalize: false })).toBe(0);
  expect(diff(frame(126), frame(100), { ...opts, brightnessNormalize: false })).toBe(N);
});

it('exclusion mask is respected', () => {
  const prev = frame(100);
  const curr = frame(100);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) curr[y * W + x] = 200;
  const o = { ...opts, brightnessNormalize: false };
  expect(diff(curr, prev, o)).toBe(100);
  const exclude = new Uint8Array(N);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 5; x++) exclude[y * W + x] = 1; // left half of the block
  expect(diff(curr, prev, { ...o, exclude })).toBe(50);
});

it('debug mask: changed white, rest black (excluded too)', () => {
  const prev = frame(100);
  const curr = frame(100);
  curr[0] = 200;
  curr[1] = 200;
  const exclude = new Uint8Array(N);
  exclude[1] = 1;
  const mask = new Uint32Array(N);
  diff(curr, prev, { pixelDiffThreshold: 25, brightnessNormalize: false, exclude }, mask);
  expect(mask[0]).toBe(0xffffffff);
  expect(mask[1]).toBe(0xff000000);
  expect(mask[2]).toBe(0xff000000);
});
