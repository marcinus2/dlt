import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDetector, WARMUP, IDLE, CANDIDATE, MOTION } from '../src/detector.js';
import { config as defaults } from '../src/config.js';

const HI = 0.05, MID = 0.015, LO = 0;

// ratios -> samples at a fixed rate; `global` lists indices of global frames
function seq(ratios, { fps = 10, t0 = 0, global = [] } = {}) {
  return ratios.map((ratio, i) => ({ t: t0 + (i * 1000) / fps, ratio, global: global.includes(i) }));
}
const rep = (v, n) => Array(n).fill(v);

function run(samples, overrides = {}) {
  const det = createDetector({ ...defaults, warmupMs: 0, ...overrides });
  const events = samples.flatMap((s) => det.update(s));
  return { det, events, types: events.map((e) => e.type) };
}

test('clean pass -> exactly 1 START + 1 END', () => {
  const { types, events } = run(seq([LO, LO, HI, HI, HI, HI, LO, LO, LO, LO]));
  assert.deepEqual(types, ['MOTION_START', 'MOTION_END']);
  const end = events[1];
  assert.equal(end.startT, 200);
  assert.equal(end.endT, 500);
  assert.equal(end.durationMs, 300);
  assert.equal(end.frames, 4);
  assert.equal(end.peakRatio, HI);
});

test('pass with a 1-frame dip -> still 1 pass', () => {
  const { types } = run(seq([HI, HI, LO, HI, HI, LO, LO, LO]));
  assert.deepEqual(types, ['MOTION_START', 'MOTION_END']);
});

test('1-frame noise spike -> nothing', () => {
  const { types, det } = run(seq([LO, HI, LO, LO, LO]));
  assert.deepEqual(types, []);
  assert.equal(det.state, IDLE);
});

test('2 passes within cooldown -> 1 accepted + 1 SUPPRESSED', () => {
  const pass = [HI, HI, HI, LO, LO, LO];
  const { types } = run(seq([...pass, ...pass, LO]));
  assert.deepEqual(types, ['MOTION_START', 'MOTION_END', 'SUPPRESSED']);
});

test('motion > maxMotionMs -> REJECTED', () => {
  // motion at t=0..3100, rejected on the first frame past 3000 ms
  const { events, det } = run(seq([...rep(HI, 32), LO, LO, LO, LO]));
  assert.deepEqual(events.map((e) => e.type), ['MOTION_START', 'REJECTED']);
  assert.equal(events[1].reason, 'LONG_MOTION');
  assert.equal(det.state, IDLE);
});

test('global frames -> no START', () => {
  const { types } = run(seq(rep(HI, 6), { global: [0, 1, 2, 3, 4, 5] }));
  assert.deepEqual(types, []);
});

test('events during warm-up are ignored', () => {
  const det = createDetector({ ...defaults, warmupMs: 1000 });
  det.reset(0);
  assert.equal(det.state, WARMUP);
  const events = seq([HI, HI, HI, LO, LO, LO], { t0: 0 }).flatMap((s) => det.update(s)); // t 0..500
  assert.deepEqual(events, []);
  assert.equal(det.state, WARMUP);
  const after = seq([LO, HI, HI, HI, LO, LO, LO], { t0: 1000 }).flatMap((s) => det.update(s));
  assert.deepEqual(after.map((e) => e.type), ['MOTION_START', 'MOTION_END']);
});

test('START timestamp equals the first motion frame (backdated)', () => {
  const det = createDetector({ ...defaults, warmupMs: 0 });
  const samples = seq([LO, HI, HI, HI, LO]);
  const started = samples.map((s) => det.update(s));
  assert.equal(started[1].length, 0);                       // not confirmed yet
  assert.equal(started[2][0].type, 'MOTION_START');         // confirmed on the 2nd frame...
  assert.equal(started[2][0].t, 100);                       // ...but stamped with the 1st
});

// --- dev-plan §5 clarifications ---

test('CANDIDATE + global frame is neutral', () => {
  // doesn't count toward minMotionFrames
  let r = run(seq([HI, HI], { global: [1] }));
  assert.deepEqual(r.types, []);
  assert.equal(r.det.state, CANDIDATE);
  // and doesn't reset to IDLE
  r = run(seq([HI, HI, HI, LO, LO, LO], { global: [1] }));
  assert.deepEqual(r.types, ['MOTION_START', 'MOTION_END']);
  assert.equal(r.events[0].t, 0);
});

test('CANDIDATE with endRatio <= ratio < startRatio -> back to IDLE', () => {
  const r = run(seq([HI, MID, HI]));
  assert.deepEqual(r.types, []);
  assert.equal(r.det.state, CANDIDATE); // the last HI is a fresh candidate, not a continuation
  assert.equal(run(seq([HI, MID])).det.state, IDLE);
});

test('MOTION keeps going while ratio stays in the hysteresis band', () => {
  const { types } = run(seq([HI, HI, MID, MID, MID, MID, HI, LO, LO, LO]));
  assert.deepEqual(types, ['MOTION_START', 'MOTION_END']);
});

test('SUPPRESSED pass ends silently and does not update prevStartT', () => {
  const pass = [HI, HI, HI, LO, LO, LO]; // 600 ms at 10 fps
  const a = seq(pass, { t0: 0 });
  const b = seq(pass, { t0: 800 });      // startT 800 < 1500 -> suppressed
  const c = seq(pass, { t0: 3000 });
  const { events } = run([...a, ...b, ...c]);
  assert.deepEqual(events.map((e) => e.type), ['MOTION_START', 'MOTION_END', 'SUPPRESSED', 'MOTION_START', 'MOTION_END']);
  assert.equal(events[3].dStart, 3000);  // measured from A, not the suppressed B
  assert.equal(events[4].dStart, 3000);
  assert.equal(events[4].dPeak, 3000);
});

test('cooldown is measured from the last accepted backdated startT', () => {
  const pass = [HI, HI, HI, LO, LO, LO];
  // 1499 ms after A -> suppressed, exactly cooldownMs after A -> accepted
  assert.deepEqual(run([...seq(pass, { t0: 0 }), ...seq(pass, { t0: 1499 })]).types,
    ['MOTION_START', 'MOTION_END', 'SUPPRESSED']);
  assert.deepEqual(run([...seq(pass, { t0: 0 }), ...seq(pass, { t0: 1500 })]).types,
    ['MOTION_START', 'MOTION_END', 'MOTION_START', 'MOTION_END']);
});

test('SUPPRESSED pass still obeys maxMotionMs and stays silent', () => {
  const a = seq([HI, HI, HI, LO, LO, LO], { t0: 0 });
  const long = seq([...rep(HI, 32), LO, LO, LO, LO], { t0: 800 });
  const { types, det } = run([...a, ...long]);
  assert.deepEqual(types, ['MOTION_START', 'MOTION_END', 'SUPPRESSED']);
  assert.equal(det.state, IDLE);
});

test('REJECTED resets the pass but keeps prevStartT', () => {
  const a = seq([HI, HI, HI, LO, LO, LO], { t0: 0 });
  const rejected = seq([...rep(HI, 32), LO, LO, LO, LO], { t0: 2000 });
  const c = seq([HI, HI, HI, LO, LO, LO], { t0: 8000 });
  const { events } = run([...a, ...rejected, ...c]);
  assert.deepEqual(events.map((e) => e.type), ['MOTION_START', 'MOTION_END', 'MOTION_START', 'REJECTED', 'MOTION_START', 'MOTION_END']);
  assert.equal(events[4].dStart, 8000);  // from A, not from the rejected pass
});

test('gapReset frame is neutral', () => {
  const det = createDetector({ ...defaults, warmupMs: 0 });
  const s = seq([HI, LO, HI, HI, LO, LO, LO]);
  s[1] = { ...s[1], gapReset: true };    // ratio 0 here is meaningless, must not reset the candidate
  const types = s.flatMap((x) => det.update(x)).map((e) => e.type);
  assert.deepEqual(types, ['MOTION_START', 'MOTION_END']);
  // and it doesn't count toward the end hold
  const d2 = createDetector({ ...defaults, warmupMs: 0 });
  const s2 = seq([HI, HI, LO, LO, LO]);
  s2[2] = { ...s2[2], gapReset: true };
  s2[3] = { ...s2[3], gapReset: true };
  assert.deepEqual(s2.flatMap((x) => d2.update(x)).map((e) => e.type), ['MOTION_START']);
  assert.equal(d2.state, MOTION);
});

test('maxMotionMs runs on t, so global frames inside a pass still count', () => {
  const { types } = run(seq([HI, HI, ...rep(HI, 3), ...rep(HI, 30)], { global: Array.from({ length: 30 }, (_, i) => i + 5) }));
  assert.deepEqual(types, ['MOTION_START', 'REJECTED']);
});

test('reset(t) returns to WARMUP until t + warmupMs', () => {
  const det = createDetector({ ...defaults, warmupMs: 500 });
  det.reset(0);
  det.update({ t: 600, ratio: LO });
  assert.equal(det.state, IDLE);
  det.reset(1000);
  assert.equal(det.state, WARMUP);
  det.update({ t: 1400, ratio: HI });
  assert.equal(det.state, WARMUP);
  det.update({ t: 1500, ratio: LO });
  assert.equal(det.state, IDLE);
});

test('Δstart and Δpeak between consecutive passes', () => {
  const p1 = seq([HI, HI, 0.08, HI, LO, LO, LO], { t0: 0 });      // peak at t=200
  const p2 = seq([HI, HI, HI, 0.09, LO, LO, LO], { t0: 5000 });   // peak at t=5300
  const { events } = run([...p1, ...p2]);
  const ends = events.filter((e) => e.type === 'MOTION_END');
  assert.equal(ends[0].dPeak, null);
  assert.equal(ends[1].dPeak, 5100);
  assert.equal(ends[1].dStart, 5000);
});

test('after a long motion the detector re-arms only after quiet frames', () => {
  // motion continues past the cutoff, then stops, then a real pass
  const long = seq([...rep(HI, 40), LO, LO, LO], { t0: 0 });
  const next = seq([HI, HI, HI, LO, LO, LO], { t0: 5000 });
  const { types } = run([...long, ...next]);
  assert.deepEqual(types, ['MOTION_START', 'REJECTED', 'MOTION_START', 'MOTION_END']);
  // a single quiet frame in the tail is not enough
  const tail = seq([...rep(HI, 32), LO, HI, HI, HI, HI, LO, LO, LO, LO]);
  assert.deepEqual(run(tail).types, ['MOTION_START', 'REJECTED']);
});

test('reset clears previous pass times: no cooldown or Δ across a time-base jump (file loop)', () => {
  const det = createDetector({ ...defaults, warmupMs: 0 });
  const feed = (samples) => samples.flatMap((x) => det.update(x));
  feed(seq([HI, HI, HI, LO, LO, LO], { t0: 40000 }));
  det.reset(0);                                     // loop: mediaTime back to 0
  const events = feed(seq([HI, HI, HI, LO, LO, LO], { t0: 0 }));
  assert.deepEqual(events.map((e) => e.type), ['MOTION_START', 'MOTION_END']);
  assert.equal(events[0].dStart, null);
  assert.equal(events[1].dPeak, null);
});

// --- time-based debounce (minMotionMs / endHoldMs) ---

// [[ratio, ms], ...] -> samples at `fps`
function seqMs(segments, fps) {
  const out = [];
  let from = 0;
  for (const [ratio, ms] of segments) {
    const end = from + ms;
    for (let k = Math.ceil((from * fps) / 1000); (k * 1000) / fps < end; k++) out.push({ t: (k * 1000) / fps, ratio, global: false });
    from = end;
  }
  return out;
}

test('same physical pass -> same events at 10, 20, 30 and 60 fps', () => {
  for (const fps of [10, 20, 30, 60]) {
    const { events, types } = run(seqMs([[LO, 300], [HI, 300], [LO, 300]], fps));
    assert.deepEqual(types, ['MOTION_START', 'MOTION_END'], `${fps} fps`);
    const frame = 1000 / fps;
    assert.ok(Math.abs(events[0].t - 300) < frame, `${fps} fps start`);
    assert.ok(Math.abs(events[1].durationMs - 300) <= frame + 1e-6, `${fps} fps duration`);
  }
});

test('start confirms once motion has lasted minMotionMs, not after N frames', () => {
  const det = createDetector({ ...defaults, warmupMs: 0, minMotionMs: 30 });
  const started = seq(rep(HI, 5), { fps: 100 }).map((s) => det.update(s).length);   // t = 0, 10, 20, 30, 40
  assert.deepEqual(started, [0, 0, 0, 1, 0]);
});

test('minMotionMs 0 confirms on the first motion frame', () => {
  const { events } = run(seq([LO, HI, LO, LO, LO]), { minMotionMs: 0 });
  assert.deepEqual(events.map((e) => e.type), ['MOTION_START', 'MOTION_END']);
  assert.equal(events[0].t, 100);
});

test('end confirms once quiet has lasted endHoldMs, not after N frames', () => {
  const det = createDetector({ ...defaults, warmupMs: 0, endHoldMs: 60 });
  const feed = seq([...rep(HI, 5), ...rep(LO, 10)], { fps: 100 });                   // quiet from t = 50
  const ended = feed.map((s) => det.update(s).some((e) => e.type === 'MOTION_END'));
  assert.deepEqual(ended.indexOf(true), 11);                                          // t = 110 = 50 + endHoldMs
});

test('a single quiet frame never ends a pass, however sparse the frames', () => {
  const { types, det } = run(seq([HI, HI, HI, LO], { fps: 2 }));
  assert.deepEqual(types, ['MOTION_START']);
  assert.equal(det.state, MOTION);
});

test('re-arm after a long motion needs endHoldMs of quiet', () => {
  const long = seq([...rep(HI, 40), LO], { fps: 10 });                                // one quiet frame at t = 4000
  const tooSoon = seq([HI, HI, HI, LO, LO, LO], { fps: 100, t0: 4010 });              // only 20 ms of quiet at the end
  assert.deepEqual(run([...long, ...tooSoon]).types, ['MOTION_START', 'REJECTED']);
  const quiet = seq([...rep(HI, 40), LO, LO, HI, HI, HI, LO, LO, LO], { fps: 10 });   // 100 ms of quiet, then a real pass
  assert.deepEqual(run(quiet).types, ['MOTION_START', 'REJECTED', 'MOTION_START', 'MOTION_END']);
});
