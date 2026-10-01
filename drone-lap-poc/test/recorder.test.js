import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecorder } from '../src/recorder.js';

test('frames CSV has header and one row per frame', () => {
  const r = createRecorder(10);
  r.addFrame(100.5, 0.25, 0.5, false, 'IDLE');
  r.addFrame(116.25, 0, 0, true, 'MOTION');
  assert.equal(r.framesCsv(), 't,ratio,globalRatio,global,state\n100.5,0.25,0.5,0,IDLE\n116.25,0,0,1,MOTION\n');
});

test('frame rows are capped', () => {
  const r = createRecorder(2);
  assert.equal(r.addFrame(1, 0, 0, false, 'IDLE'), true);
  assert.equal(r.addFrame(2, 0, 0, false, 'IDLE'), true);
  assert.equal(r.addFrame(3, 0, 0, false, 'IDLE'), false);
  assert.equal(r.frameCount, 2);
});

test('events CSV fills missing columns with empty cells', () => {
  const r = createRecorder(1);
  r.addEvent({ type: 'MOTION_START', t: 1000, dStart: null });
  r.addEvent({ type: 'REJECTED', t: 5000, startT: 1500, durationMs: 3500, reason: 'LONG_MOTION' });
  assert.equal(r.eventsCsv().split('\n')[0], 'type,t,startT,endT,durationMs,peakT,peakRatio,frames,dStart,dPeak,reason');
  assert.equal(r.eventsCsv().split('\n')[1], 'MOTION_START,1000,,,,,,,,,');
  assert.equal(r.eventsCsv().split('\n')[2], 'REJECTED,5000,1500,,3500,,,,,,LONG_MOTION');
});

test('clear empties both', () => {
  const r = createRecorder(5);
  r.addFrame(1, 0, 0, false, 'IDLE');
  r.addEvent({ type: 'SUPPRESSED', t: 1 });
  r.clear();
  assert.equal(r.frameCount, 0);
  assert.equal(r.eventCount, 0);
});

test('ratios keep full precision (no float32 noise)', () => {
  const r = createRecorder(1);
  r.addFrame(1, 0.02, 0.003, false, 'IDLE');
  assert.equal(r.framesCsv().split('\n')[1], '1,0.02,0.003,0,IDLE');
});
