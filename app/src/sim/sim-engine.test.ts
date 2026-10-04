import { beforeEach, describe, expect, it } from 'vitest';
import type { DetectorEvent, EnginePhase, FrameSource, PassEvent } from '../engine/types.ts';
import { DEFAULTS } from '../settings/schema.ts';
import {
  createSimEngine,
  SIM_FIRST_PASS_MS,
  SIM_MOTION_MS,
  SIM_SAMPLE_MS,
  type SimEngine,
} from './sim-engine.ts';

/** Manual clock + timer queue. */
function fakeClock() {
  let t = 0;
  let id = 0;
  const timers = new Map<number, { at: number; cb: () => void }>();
  return {
    now: () => t,
    setTimer: (cb: () => void, ms: number) => {
      timers.set(++id, { at: t + ms, cb });
      return id;
    },
    clearTimer: (h: unknown) => {
      timers.delete(h as number);
    },
    advance(ms: number) {
      const end = t + ms;
      for (;;) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        timers.delete(next[0]);
        t = next[1].at;
        next[1].cb();
      }
      t = end;
    },
    pending: () => timers.size,
  };
}

const source = {} as FrameSource;
const detection = DEFAULTS.detection; // warmup 1500, cooldown 1500

describe('SimEngine', () => {
  let clock: ReturnType<typeof fakeClock>;
  let engine: SimEngine;
  let phases: EnginePhase[];
  let passes: PassEvent[];
  let events: DetectorEvent[];

  function make(opts: { auto?: boolean; lapRange?: [number, number] } = {}) {
    clock = fakeClock();
    engine = createSimEngine({ ...clock, random: () => 0.5, auto: false, ...opts });
    phases = [];
    passes = [];
    events = [];
    engine.on('phase', (p) => phases.push(p));
    engine.on('pass', (p) => passes.push(p));
    engine.on('event', (e) => events.push(e));
  }

  beforeEach(() => make());

  it('warm-up → armed after warmupMs', () => {
    engine.start(source, detection);
    expect(phases).toEqual(['warmup']);
    clock.advance(1499);
    expect(engine.phase()).toBe('warmup');
    clock.advance(1);
    expect(phases).toEqual(['warmup', 'armed']);
  });

  it('manual pass during warm-up is ignored', () => {
    engine.start(source, detection);
    engine.pass();
    clock.advance(1000);
    expect(passes).toEqual([]);
  });

  it('manual pass: MOTION_START, then MOTION_END + pass backdated to the start', () => {
    engine.start(source, detection);
    clock.advance(2000);
    engine.pass();
    expect(engine.phase()).toBe('motion');
    expect(events).toEqual([{ type: 'MOTION_START', t: 2000, dStart: null }]);
    expect(passes).toEqual([]); // recorded at MOTION_END (D1)
    clock.advance(SIM_MOTION_MS);
    expect(passes).toEqual([
      { t: 2000 + SIM_MOTION_MS, startT: 2000, endT: 2000 + SIM_MOTION_MS, peakT: 2090, peakRatio: 0.125 },
    ]);
    expect(events.at(-1)).toMatchObject({ type: 'MOTION_END', startT: 2000, durationMs: SIM_MOTION_MS });
    expect(engine.phase()).toBe('armed');
  });

  it('respects cooldownMs: a pass too soon is SUPPRESSED', () => {
    engine.start(source, detection);
    clock.advance(1500);
    engine.pass();
    clock.advance(1000);
    engine.pass(); // 1000 ms after the last start < 1500
    clock.advance(1000);
    expect(passes).toHaveLength(1);
    expect(events.map((e) => e.type)).toEqual(['MOTION_START', 'MOTION_END', 'SUPPRESSED']);
    engine.pass(); // 2000 ms after
    clock.advance(SIM_MOTION_MS);
    expect(passes).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ type: 'MOTION_END', dStart: 2000 });
  });

  it('auto passes: first after arming, then one per lap time', () => {
    make({ auto: true, lapRange: [10000, 10000] });
    engine.start(source, detection);
    clock.advance(1500 + SIM_FIRST_PASS_MS + SIM_MOTION_MS);
    expect(passes.map((p) => p.startT)).toEqual([4500]);
    clock.advance(20000);
    expect(passes.map((p) => p.startT)).toEqual([4500, 14500, 24500]);
  });

  it('auto lap times are random within the range and never below cooldownMs', () => {
    make({ auto: true, lapRange: [10000, 15000] });
    engine.start(source, detection);
    clock.advance(1500 + SIM_FIRST_PASS_MS + 12500 + SIM_MOTION_MS);
    expect(passes.map((p) => p.startT)).toEqual([4500, 17000]); // random 0.5 → 12.5 s

    make({ auto: true, lapRange: [500, 500] });
    engine.start(source, detection);
    clock.advance(1500 + SIM_FIRST_PASS_MS + 1500 + SIM_MOTION_MS);
    expect(passes.map((p) => p.startT)).toEqual([4500, 6000]);
    expect(events.some((e) => e.type === 'SUPPRESSED')).toBe(false);
  });

  it('setAuto(false) cancels the scheduled pass; setAuto(true) resumes', () => {
    make({ auto: true, lapRange: [10000, 10000] });
    engine.start(source, detection);
    clock.advance(1500);
    engine.setAuto(false);
    expect(engine.auto()).toBe(false);
    clock.advance(30000);
    expect(passes).toEqual([]);
    engine.setAuto(true);
    clock.advance(10000 + SIM_MOTION_MS);
    expect(passes).toHaveLength(1);
  });

  it('a manual pass restarts the auto lap timer', () => {
    make({ auto: true, lapRange: [10000, 10000] });
    engine.start(source, detection);
    clock.advance(2500);
    engine.pass(); // t=2500, before the first auto pass (4500)
    clock.advance(9000);
    expect(passes.map((p) => p.startT)).toEqual([2500]);
    clock.advance(1000 + SIM_MOTION_MS);
    expect(passes.map((p) => p.startT)).toEqual([2500, 12500]);
  });

  it('stop() is synchronous: no events after it returns, no timers left', () => {
    make({ auto: true, lapRange: [10000, 10000] });
    engine.start(source, detection);
    clock.advance(2000);
    engine.pass();
    engine.stop();
    expect(engine.phase()).toBe('stopped');
    const seen = events.length;
    clock.advance(60000);
    expect(passes).toEqual([]);
    expect(events).toHaveLength(seen);
    expect(phases.at(-1)).toBe('stopped');
    expect(clock.pending()).toBe(0);
  });

  it('reset() → warm-up again; the cooldown starts fresh', () => {
    engine.start(source, detection);
    clock.advance(1500);
    engine.pass();
    clock.advance(SIM_MOTION_MS);
    engine.reset();
    expect(engine.phase()).toBe('warmup');
    clock.advance(1500);
    expect(engine.phase()).toBe('armed');
    engine.pass(); // < cooldown after the earlier pass, but reset cleared it
    clock.advance(SIM_MOTION_MS);
    expect(passes).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ dStart: null });
  });

  it('reset() while stopped does nothing', () => {
    engine.reset();
    expect(phases).toEqual([]);
  });

  it('update() changes the cooldown live', () => {
    engine.start(source, detection);
    clock.advance(1500);
    engine.update({ ...detection, cooldownMs: 0 });
    engine.pass();
    clock.advance(SIM_MOTION_MS);
    engine.pass();
    clock.advance(SIM_MOTION_MS);
    expect(passes).toHaveLength(2);
  });

  it('unsubscribe stops delivery', () => {
    const got: EnginePhase[] = [];
    const off = engine.on('phase', (p) => got.push(p));
    off();
    engine.start(source, detection);
    expect(got).toEqual([]);
  });

  it('samples at ~30 fps only while running and listened to; motion raises the ratio', () => {
    engine.start(source, detection);
    expect(clock.pending()).toBe(1); // warm-up only: nobody listens to samples
    const ratios: number[] = [];
    const off = engine.on('sample', (x) => ratios.push(x.ratio));
    clock.advance(SIM_SAMPLE_MS * 10);
    expect(ratios).toHaveLength(10);
    expect(Math.max(...ratios)).toBeLessThan(0.005);
    clock.advance(2000);
    engine.pass();
    ratios.length = 0;
    clock.advance(SIM_SAMPLE_MS);
    expect(ratios[0]).toBeGreaterThan(0.05);
    engine.stop();
    ratios.length = 0;
    clock.advance(1000);
    expect(ratios).toEqual([]);
    expect(clock.pending()).toBe(0);
    off();
  });

  it('fake stats with a low-fps switch', () => {
    expect(engine.stats().fps).toBeGreaterThanOrEqual(29);
    engine.setLowFps(true);
    expect(engine.lowFps()).toBe(true);
    const s = engine.stats();
    expect(s.fps).toBeLessThan(20);
    expect(s.dropped).toBeGreaterThan(0);
    engine.setLapRange([1000, 2000]);
  });
});
