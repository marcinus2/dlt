// Ported 1:1 from the PoC `test/recorder.test.js`.
import { expect, it } from 'vitest';
import { createRecorder } from './recorder.ts';

it('frames CSV has header and one row per frame', () => {
  const r = createRecorder(10);
  r.addFrame(100.5, 0.25, 0.5, false, 'IDLE');
  r.addFrame(116.25, 0, 0, true, 'MOTION');
  expect(r.framesCsv()).toBe(
    't,ratio,globalRatio,global,state\n100.5,0.25,0.5,0,IDLE\n116.25,0,0,1,MOTION\n',
  );
});

it('frame rows are capped', () => {
  const r = createRecorder(2);
  expect(r.addFrame(1, 0, 0, false, 'IDLE')).toBe(true);
  expect(r.addFrame(2, 0, 0, false, 'IDLE')).toBe(true);
  expect(r.addFrame(3, 0, 0, false, 'IDLE')).toBe(false);
  expect(r.frameCount).toBe(2);
});

it('events CSV fills missing columns with empty cells', () => {
  const r = createRecorder(1);
  r.addEvent({ type: 'MOTION_START', t: 1000, dStart: null });
  r.addEvent({ type: 'REJECTED', t: 5000, startT: 1500, durationMs: 3500, reason: 'LONG_MOTION' });
  const lines = r.eventsCsv().split('\n');
  expect(lines[0]).toBe('type,t,startT,endT,durationMs,peakT,peakRatio,frames,dStart,dPeak,reason');
  expect(lines[1]).toBe('MOTION_START,1000,,,,,,,,,');
  expect(lines[2]).toBe('REJECTED,5000,1500,,3500,,,,,,LONG_MOTION');
});

it('clear empties both', () => {
  const r = createRecorder(5);
  r.addFrame(1, 0, 0, false, 'IDLE');
  r.addEvent({ type: 'SUPPRESSED', t: 1, reason: 'cooldown' });
  r.clear();
  expect(r.frameCount).toBe(0);
  expect(r.eventCount).toBe(0);
});

it('ratios keep full precision (no float32 noise)', () => {
  const r = createRecorder(1);
  r.addFrame(1, 0.02, 0.003, false, 'IDLE');
  expect(r.framesCsv().split('\n')[1]).toBe('1,0.02,0.003,0,IDLE');
});
