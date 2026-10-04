// Ported 1:1 from the PoC `test/calibration.test.js`.
import { expect, it } from 'vitest';
import {
  type Calibration,
  calibrate,
  createCalibrator,
  MAX_CALIBRATION_FPS,
  MIN_START,
} from './calibration.ts';

const cal = (r: number[], k: number) => calibrate(r, k) as Calibration;

it('empty input -> null', () => {
  expect(calibrate([], 5)).toBeNull();
});

it('perfectly static scene -> MIN_START floor', () => {
  const c = cal(new Array(100).fill(0), 5);
  expect(c.startRatio).toBe(MIN_START);
  expect(c.endRatio).toBe(MIN_START / 2);
  expect(c.hint).toBeNull();
});

it('mean + k*sigma wins for a smooth noise floor', () => {
  const c = cal([0.01, 0.03, 0.01, 0.03], 5); // mean 0.02, sigma 0.01
  expect(c.mean).toBeCloseTo(0.02, 12);
  expect(c.sigma).toBeCloseTo(0.01, 12);
  expect(c.max).toBe(0.03);
  expect(c.startRatio).toBeCloseTo(0.07, 12);
  expect(c.endRatio).toBeCloseTo(0.035, 12);
});

it('1.2 * max wins when one spike dominates', () => {
  const c = cal(new Array(99).fill(0.001).concat([0.05]), 1);
  expect(c.mean + c.sigma).toBeLessThan(1.2 * 0.05);
  expect(c.startRatio).toBeCloseTo(0.06, 12);
});

it('hint when mean > 1%', () => {
  expect(cal([0.02, 0.02], 5).hint).toBeTruthy();
  expect(cal([0.005, 0.005], 5).hint).toBeNull();
});

it('calibrator: collects for durationMs from the first frame, skips global frames', () => {
  const c = createCalibrator(1000, 5);
  expect(c.add(5000, 0, true)).toEqual({ done: false, progress: 0 }); // first frame: no diff
  for (let t = 5033; t < 6000; t += 33) expect(c.add(t, t % 2 ? 0.01 : 0.03, false).done).toBe(false);
  expect(c.add(5500, 0.9, true)).toMatchObject({ done: false, progress: 0.5 }); // global: skipped
  const end = c.add(6000, 0.02, false);
  expect(end.done).toBe(true);
  const r = end.done ? end.result : null;
  expect(r?.n).toBe(31);
  expect(r?.max).toBe(0.03);
  expect(c.add(7000, 1, false)).toBe(end); // finished: later frames change nothing
});

it('calibrator: only global frames -> null; the buffer is capped', () => {
  const g = createCalibrator(100, 5);
  g.add(0, 0, true);
  expect(g.add(100, 0, true)).toEqual({ done: true, result: null });
  const fast = createCalibrator(1000, 5);
  const cap = MAX_CALIBRATION_FPS + 1;
  for (let i = 0; i < cap + 50; i++) fast.add(i * 0.5, 0.01, false);
  const end = fast.add(1000, 0.01, false);
  expect(end.done && end.result?.n).toBe(cap);
});
