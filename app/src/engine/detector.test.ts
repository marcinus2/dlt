// Ported 1:1 from the PoC `test/detector.test.js`.
import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../settings/schema.ts';
import { createDetector, type DetectorSample, type DetectorSettings } from './detector.ts';
import type { DetectorEvent } from './types.ts';

const defaults = DEFAULTS.detection;
const HI = 0.05;
const MID = 0.015;
const LO = 0;

// ratios -> samples at a fixed rate; `global` lists indices of global frames
function seq(ratios: number[], { fps = 10, t0 = 0, global = [] as number[] } = {}): DetectorSample[] {
  return ratios.map((ratio, i) => ({ t: t0 + (i * 1000) / fps, ratio, global: global.includes(i) }));
}
const rep = (v: number, n: number) => Array<number>(n).fill(v);

function run(samples: DetectorSample[], overrides: Partial<DetectorSettings> = {}) {
  const det = createDetector({ ...defaults, warmupMs: 0, ...overrides });
  const events = samples.flatMap((s) => det.update(s));
  return { det, events, types: events.map((e) => e.type) };
}

describe('detector', () => {
  it('clean pass -> exactly 1 START + 1 END', () => {
    const { types, events } = run(seq([LO, LO, HI, HI, HI, HI, LO, LO, LO, LO]));
    expect(types).toEqual(['MOTION_START', 'MOTION_END']);
    expect(events[1]).toMatchObject({ startT: 200, endT: 500, durationMs: 300, frames: 4, peakRatio: HI });
  });

  it('pass with a 1-frame dip -> still 1 pass', () => {
    expect(run(seq([HI, HI, LO, HI, HI, LO, LO, LO])).types).toEqual(['MOTION_START', 'MOTION_END']);
  });

  it('1-frame noise spike -> nothing', () => {
    const { types, det } = run(seq([LO, HI, LO, LO, LO]));
    expect(types).toEqual([]);
    expect(det.state).toBe('IDLE');
  });

  it('2 passes within cooldown -> 1 accepted + 1 SUPPRESSED', () => {
    const pass = [HI, HI, HI, LO, LO, LO];
    expect(run(seq([...pass, ...pass, LO])).types).toEqual(['MOTION_START', 'MOTION_END', 'SUPPRESSED']);
  });

  it('motion > maxMotionMs -> REJECTED', () => {
    // motion at t=0..3100, rejected on the first frame past 3000 ms
    const { events, det } = run(seq([...rep(HI, 32), LO, LO, LO, LO]));
    expect(events.map((e) => e.type)).toEqual(['MOTION_START', 'REJECTED']);
    expect(events[1]).toMatchObject({ reason: 'LONG_MOTION' });
    expect(det.state).toBe('IDLE');
  });

  it('global frames -> no START', () => {
    expect(run(seq(rep(HI, 6), { global: [0, 1, 2, 3, 4, 5] })).types).toEqual([]);
  });

  it('events during warm-up are ignored', () => {
    const det = createDetector({ ...defaults, warmupMs: 1000 });
    det.reset(0);
    expect(det.state).toBe('WARMUP');
    const events = seq([HI, HI, HI, LO, LO, LO], { t0: 0 }).flatMap((s) => det.update(s)); // t 0..500
    expect(events).toEqual([]);
    expect(det.state).toBe('WARMUP');
    const after = seq([LO, HI, HI, HI, LO, LO, LO], { t0: 1000 }).flatMap((s) => det.update(s));
    expect(after.map((e) => e.type)).toEqual(['MOTION_START', 'MOTION_END']);
  });

  it('START timestamp equals the first motion frame (backdated)', () => {
    const det = createDetector({ ...defaults, warmupMs: 0 });
    const started = seq([LO, HI, HI, HI, LO]).map((s) => det.update(s));
    expect(started[1]).toHaveLength(0); // not confirmed yet
    expect(started[2]?.[0]).toMatchObject({ type: 'MOTION_START', t: 100 }); // confirmed on the 2nd frame, stamped with the 1st
  });

  // --- dev-plan §5 clarifications ---

  it('CANDIDATE + global frame is neutral', () => {
    // doesn't count toward minMotionFrames
    let r = run(seq([HI, HI], { global: [1] }));
    expect(r.types).toEqual([]);
    expect(r.det.state).toBe('CANDIDATE');
    // and doesn't reset to IDLE
    r = run(seq([HI, HI, HI, LO, LO, LO], { global: [1] }));
    expect(r.types).toEqual(['MOTION_START', 'MOTION_END']);
    expect(r.events[0]?.t).toBe(0);
  });

  it('CANDIDATE with endRatio <= ratio < startRatio -> back to IDLE', () => {
    const r = run(seq([HI, MID, HI]));
    expect(r.types).toEqual([]);
    expect(r.det.state).toBe('CANDIDATE'); // the last HI is a fresh candidate, not a continuation
    expect(run(seq([HI, MID])).det.state).toBe('IDLE');
  });

  it('MOTION keeps going while ratio stays in the hysteresis band', () => {
    expect(run(seq([HI, HI, MID, MID, MID, MID, HI, LO, LO, LO])).types).toEqual([
      'MOTION_START',
      'MOTION_END',
    ]);
  });

  it('SUPPRESSED pass ends silently and does not update prevStartT', () => {
    const pass = [HI, HI, HI, LO, LO, LO]; // 600 ms at 10 fps
    const a = seq(pass, { t0: 0 });
    const b = seq(pass, { t0: 800 }); // startT 800 < 1500 -> suppressed
    const c = seq(pass, { t0: 3000 });
    const { events } = run([...a, ...b, ...c]);
    expect(events.map((e) => e.type)).toEqual([
      'MOTION_START',
      'MOTION_END',
      'SUPPRESSED',
      'MOTION_START',
      'MOTION_END',
    ]);
    expect(events[3]).toMatchObject({ dStart: 3000 }); // measured from A, not the suppressed B
    expect(events[4]).toMatchObject({ dStart: 3000, dPeak: 3000 });
  });

  it('cooldown is measured from the last accepted backdated startT', () => {
    const pass = [HI, HI, HI, LO, LO, LO];
    // 1499 ms after A -> suppressed, exactly cooldownMs after A -> accepted
    expect(run([...seq(pass, { t0: 0 }), ...seq(pass, { t0: 1499 })]).types).toEqual([
      'MOTION_START',
      'MOTION_END',
      'SUPPRESSED',
    ]);
    expect(run([...seq(pass, { t0: 0 }), ...seq(pass, { t0: 1500 })]).types).toEqual([
      'MOTION_START',
      'MOTION_END',
      'MOTION_START',
      'MOTION_END',
    ]);
  });

  it('SUPPRESSED pass still obeys maxMotionMs and stays silent', () => {
    const a = seq([HI, HI, HI, LO, LO, LO], { t0: 0 });
    const long = seq([...rep(HI, 32), LO, LO, LO, LO], { t0: 800 });
    const { types, det } = run([...a, ...long]);
    expect(types).toEqual(['MOTION_START', 'MOTION_END', 'SUPPRESSED']);
    expect(det.state).toBe('IDLE');
  });

  it('REJECTED resets the pass but keeps prevStartT', () => {
    const a = seq([HI, HI, HI, LO, LO, LO], { t0: 0 });
    const rejected = seq([...rep(HI, 32), LO, LO, LO, LO], { t0: 2000 });
    const c = seq([HI, HI, HI, LO, LO, LO], { t0: 8000 });
    const { events } = run([...a, ...rejected, ...c]);
    expect(events.map((e) => e.type)).toEqual([
      'MOTION_START',
      'MOTION_END',
      'MOTION_START',
      'REJECTED',
      'MOTION_START',
      'MOTION_END',
    ]);
    expect(events[4]).toMatchObject({ dStart: 8000 }); // from A, not from the rejected pass
  });

  it('gapReset frame is neutral', () => {
    const det = createDetector({ ...defaults, warmupMs: 0 });
    const s = seq([HI, LO, HI, HI, LO, LO, LO]);
    s[1] = { ...(s[1] as DetectorSample), gapReset: true }; // ratio 0 here is meaningless, must not reset the candidate
    expect(s.flatMap((x) => det.update(x)).map((e) => e.type)).toEqual(['MOTION_START', 'MOTION_END']);
    // and it doesn't count toward the end hold
    const d2 = createDetector({ ...defaults, warmupMs: 0 });
    const s2 = seq([HI, HI, LO, LO, LO]);
    s2[2] = { ...(s2[2] as DetectorSample), gapReset: true };
    s2[3] = { ...(s2[3] as DetectorSample), gapReset: true };
    expect(s2.flatMap((x) => d2.update(x)).map((e) => e.type)).toEqual(['MOTION_START']);
    expect(d2.state).toBe('MOTION');
  });

  it('maxMotionMs runs on t, so global frames inside a pass still count', () => {
    const global = Array.from({ length: 30 }, (_, i) => i + 5);
    expect(run(seq([HI, HI, ...rep(HI, 3), ...rep(HI, 30)], { global })).types).toEqual([
      'MOTION_START',
      'REJECTED',
    ]);
  });

  it('reset(t) returns to WARMUP until t + warmupMs', () => {
    const det = createDetector({ ...defaults, warmupMs: 500 });
    det.reset(0);
    det.update({ t: 600, ratio: LO });
    expect(det.state).toBe('IDLE');
    det.reset(1000);
    expect(det.state).toBe('WARMUP');
    det.update({ t: 1400, ratio: HI });
    expect(det.state).toBe('WARMUP');
    det.update({ t: 1500, ratio: LO });
    expect(det.state).toBe('IDLE');
  });

  it('Δstart and Δpeak between consecutive passes', () => {
    const p1 = seq([HI, HI, 0.08, HI, LO, LO, LO], { t0: 0 }); // peak at t=200
    const p2 = seq([HI, HI, HI, 0.09, LO, LO, LO], { t0: 5000 }); // peak at t=5300
    const ends = run([...p1, ...p2]).events.filter((e) => e.type === 'MOTION_END');
    expect(ends[0]).toMatchObject({ dPeak: null });
    expect(ends[1]).toMatchObject({ dPeak: 5100, dStart: 5000 });
  });

  it('after a long motion the detector re-arms only after quiet frames', () => {
    // motion continues past the cutoff, then stops, then a real pass
    const long = seq([...rep(HI, 40), LO, LO, LO], { t0: 0 });
    const next = seq([HI, HI, HI, LO, LO, LO], { t0: 5000 });
    expect(run([...long, ...next]).types).toEqual(['MOTION_START', 'REJECTED', 'MOTION_START', 'MOTION_END']);
    // a single quiet frame in the tail is not enough
    const tail = seq([...rep(HI, 32), LO, HI, HI, HI, HI, LO, LO, LO, LO]);
    expect(run(tail).types).toEqual(['MOTION_START', 'REJECTED']);
  });

  it('reset clears previous pass times: no cooldown or Δ across a time-base jump (file loop)', () => {
    const det = createDetector({ ...defaults, warmupMs: 0 });
    const feed = (samples: DetectorSample[]) => samples.flatMap((x) => det.update(x));
    feed(seq([HI, HI, HI, LO, LO, LO], { t0: 40000 }));
    det.reset(0); // loop: mediaTime back to 0
    const events = feed(seq([HI, HI, HI, LO, LO, LO], { t0: 0 }));
    expect(events.map((e) => e.type)).toEqual(['MOTION_START', 'MOTION_END']);
    expect(events[0]).toMatchObject({ dStart: null });
    expect(events[1]).toMatchObject({ dPeak: null });
  });

  // --- time-based debounce (minMotionMs / endHoldMs) ---

  // [[ratio, ms], ...] -> samples at `fps`
  function seqMs(segments: [number, number][], fps: number): DetectorSample[] {
    const out: DetectorSample[] = [];
    let from = 0;
    for (const [ratio, ms] of segments) {
      const end = from + ms;
      for (let k = Math.ceil((from * fps) / 1000); (k * 1000) / fps < end; k++)
        out.push({ t: (k * 1000) / fps, ratio, global: false });
      from = end;
    }
    return out;
  }

  it('same physical pass -> same events at 10, 20, 30 and 60 fps', () => {
    for (const fps of [10, 20, 30, 60]) {
      const segs: [number, number][] = [
        [LO, 300],
        [HI, 300],
        [LO, 300],
      ];
      const { events, types } = run(seqMs(segs, fps));
      expect(types, `${fps} fps`).toEqual(['MOTION_START', 'MOTION_END']);
      const frame = 1000 / fps;
      expect(Math.abs((events[0]?.t ?? 0) - 300), `${fps} fps start`).toBeLessThan(frame);
      const { durationMs } = events[1] as Extract<DetectorEvent, { type: 'MOTION_END' }>;
      expect(Math.abs(durationMs - 300), `${fps} fps duration`).toBeLessThanOrEqual(frame + 1e-6);
    }
  });

  it('start confirms once motion has lasted minMotionMs, not after N frames', () => {
    const det = createDetector({ ...defaults, warmupMs: 0, minMotionMs: 30 });
    const started = seq(rep(HI, 5), { fps: 100 }).map((s) => det.update(s).length); // t = 0, 10, 20, 30, 40
    expect(started).toEqual([0, 0, 0, 1, 0]);
  });

  it('minMotionMs 0 confirms on the first motion frame', () => {
    const { events } = run(seq([LO, HI, LO, LO, LO]), { minMotionMs: 0 });
    expect(events.map((e) => e.type)).toEqual(['MOTION_START', 'MOTION_END']);
    expect(events[0]?.t).toBe(100);
  });

  it('end confirms once quiet has lasted endHoldMs, not after N frames', () => {
    const det = createDetector({ ...defaults, warmupMs: 0, endHoldMs: 60 });
    const feed = seq([...rep(HI, 5), ...rep(LO, 10)], { fps: 100 }); // quiet from t = 50
    const ended = feed.map((s) => det.update(s).some((e) => e.type === 'MOTION_END'));
    expect(ended.indexOf(true)).toBe(11); // t = 110 = 50 + endHoldMs
  });

  it('a single quiet frame never ends a pass, however sparse the frames', () => {
    const { types, det } = run(seq([HI, HI, HI, LO], { fps: 2 }));
    expect(types).toEqual(['MOTION_START']);
    expect(det.state).toBe('MOTION');
  });

  it('re-arm after a long motion needs endHoldMs of quiet', () => {
    const long = seq([...rep(HI, 40), LO], { fps: 10 }); // one quiet frame at t = 4000
    const tooSoon = seq([HI, HI, HI, LO, LO, LO], { fps: 100, t0: 4010 }); // only 20 ms of quiet at the end
    expect(run([...long, ...tooSoon]).types).toEqual(['MOTION_START', 'REJECTED']);
    const quiet = seq([...rep(HI, 40), LO, LO, HI, HI, HI, LO, LO, LO], { fps: 10 }); // 100 ms of quiet, then a real pass
    expect(run(quiet).types).toEqual(['MOTION_START', 'REJECTED', 'MOTION_START', 'MOTION_END']);
  });

  // --- v1 additions ---

  it('no events -> the shared empty result (no per-frame allocation)', () => {
    const det = createDetector({ ...defaults, warmupMs: 0 });
    const a = det.update({ t: 0, ratio: LO });
    const b = det.update({ t: 100, ratio: LO });
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
  });

  it('reads the settings object live (tuning)', () => {
    const cfg = { ...defaults, warmupMs: 0 };
    const det = createDetector(cfg);
    cfg.startRatio = 0.1; // HI is now below the start threshold
    expect(seq([HI, HI, HI, LO, LO, LO]).flatMap((s) => det.update(s))).toEqual([]);
  });
});
