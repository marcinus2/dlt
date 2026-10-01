import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calibrate, MIN_START } from '../src/calibration.js';

test('empty input -> null', () => {
  assert.equal(calibrate([], 5), null);
});

test('perfectly static scene -> MIN_START floor', () => {
  const c = calibrate(new Array(100).fill(0), 5);
  assert.equal(c.startRatio, MIN_START);
  assert.equal(c.endRatio, MIN_START / 2);
  assert.equal(c.hint, null);
});

test('mean + k*sigma wins for a smooth noise floor', () => {
  const r = [0.01, 0.03, 0.01, 0.03];            // mean 0.02, sigma 0.01
  const c = calibrate(r, 5);
  assert.ok(Math.abs(c.mean - 0.02) < 1e-12);
  assert.ok(Math.abs(c.sigma - 0.01) < 1e-12);
  assert.equal(c.max, 0.03);
  assert.ok(Math.abs(c.startRatio - 0.07) < 1e-12);
  assert.ok(Math.abs(c.endRatio - 0.035) < 1e-12);
});

test('1.2 * max wins when one spike dominates', () => {
  const r = new Array(99).fill(0.001).concat([0.05]);
  const c = calibrate(r, 1);
  assert.ok(c.mean + c.sigma < 1.2 * 0.05);
  assert.ok(Math.abs(c.startRatio - 0.06) < 1e-12);
});

test('hint when mean > 1%', () => {
  assert.ok(calibrate([0.02, 0.02], 5).hint);
  assert.equal(calibrate([0.005, 0.005], 5).hint, null);
});
