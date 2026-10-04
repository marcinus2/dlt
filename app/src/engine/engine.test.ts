// DetectorEngine integration (plan 4.8): fake source (scripted FrameMeta) + fake analyzer
// (scripted ratios), and once with the real analyzer over a fake canvas.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULTS, ROI_PRESETS } from '../settings/schema.ts';
import { createFrameAnalyzer } from './browser/frame-analyzer.ts';
import { createDetectorEngine, type Engine } from './engine.ts';
import { fakeContexts, solid } from './test/fake-canvas.ts';
import type {
  DetectionSettings,
  DetectorEvent,
  EnginePhase,
  FrameAnalyzer,
  FrameMeta,
  FrameSource,
  MotionSample,
  PassEvent,
} from './types.ts';

const HI = 0.05;
const LO = 0;
const s: DetectionSettings = { ...DEFAULTS.detection, warmupMs: 500, cooldownMs: 1000, maxMotionMs: 1000 };

/** Delivers scripted frames; `leaky` keeps calling callbacks after unsubscribe. */
function fakeSource({ leaky = false } = {}) {
  const cbs = new Set<(f: FrameMeta) => void>();
  const video = { videoWidth: 240, videoHeight: 480 };
  let t = 0;
  const source = {
    video: video as unknown as HTMLVideoElement,
    start: async () => ({ width: 240, height: 480, fps: 30 }),
    stop() {},
    onFrame(cb: (f: FrameMeta) => void) {
      cbs.add(cb);
      return () => {
        if (!leaky) cbs.delete(cb);
      };
    },
    onEnded: () => () => {},
  } satisfies FrameSource;
  return {
    source,
    video,
    listeners: () => cbs.size,
    /** One frame `dt` ms after the previous one. */
    frame(dt = 100, meta: Partial<FrameMeta> = {}) {
      t += dt;
      const f: FrameMeta = {
        t,
        dropped: 0,
        presented: null,
        gapReset: false,
        seeked: false,
        tSource: 'now',
        ...meta,
      };
      for (const cb of [...cbs]) cb(f);
    },
    setT(v: number) {
      t = v;
    },
  };
}

interface FakeAnalyzer extends FrameAnalyzer {
  next: { ratio: number; globalRatio: number; global: boolean };
  resets: number;
  sizes: [number, number][];
}

function fakeAnalyzer(): FakeAnalyzer {
  const a: FakeAnalyzer = {
    next: { ratio: LO, globalRatio: 0, global: false },
    resets: 0,
    sizes: [],
    process(_img, w, h) {
      a.sizes.push([w, h]);
      return { ...a.next };
    },
    reset() {
      a.resets++;
    },
  };
  return a;
}

describe('DetectorEngine', () => {
  let src: ReturnType<typeof fakeSource>;
  let analyzer: FakeAnalyzer;
  let engine: Engine;
  let clock: number;
  let phases: EnginePhase[];
  let passes: PassEvent[];
  let events: DetectorEvent[];
  let samples: MotionSample[];

  /** Frames at 10 fps with these ratios. */
  const feed = (ratios: number[]) => {
    for (const r of ratios) {
      analyzer.next = { ratio: r, globalRatio: 0, global: false };
      clock += 100;
      src.frame(100);
    }
  };
  const warm = () => feed(Array(6).fill(LO)); // > warmupMs
  const pass = [HI, HI, HI, LO, LO, LO];

  function make(leaky = false) {
    src = fakeSource({ leaky });
    analyzer = fakeAnalyzer();
    clock = 0;
    engine = createDetectorEngine({ analyzer, now: () => clock });
    phases = [];
    passes = [];
    events = [];
    samples = [];
    engine.on('phase', (p) => phases.push(p));
    engine.on('pass', (p) => passes.push(p));
    engine.on('event', (e) => events.push(e));
    engine.on('sample', (x) => samples.push({ ...x }));
  }

  beforeEach(() => make());

  it('start → warm-up → armed after warmupMs', () => {
    engine.start(src.source, s);
    expect(phases).toEqual(['warmup']);
    feed([LO, LO, LO, LO, LO]); // t 100..500: warmUntil = 600
    expect(phases).toEqual(['warmup']);
    feed([LO, LO]);
    expect(phases).toEqual(['warmup', 'armed']);
    expect(analyzer.sizes[0]).toEqual([240, 480]);
  });

  it('a clean pass → MOTION_START, MOTION_END, one backdated pass', () => {
    engine.start(src.source, s);
    warm();
    feed(pass);
    expect(events.map((e) => e.type)).toEqual(['MOTION_START', 'MOTION_END']);
    expect(passes).toEqual([{ t: 900, startT: 700, endT: 900, peakT: 700, peakRatio: HI }]);
    expect(phases).toEqual(['warmup', 'armed', 'motion', 'armed']);
  });

  it('SUPPRESSED and REJECTED never produce a pass', () => {
    engine.start(src.source, s);
    warm();
    feed([...pass, ...pass]); // second inside cooldown
    feed(Array(12).fill(HI)); // > maxMotionMs
    feed([LO, LO, LO]);
    expect(events.map((e) => e.type)).toEqual([
      'MOTION_START',
      'MOTION_END',
      'SUPPRESSED',
      'MOTION_START',
      'REJECTED',
    ]);
    expect(passes).toHaveLength(1);
  });

  it('stop(): synchronous, no events afterwards, even from a leaky source', () => {
    make(true);
    engine.start(src.source, s);
    warm();
    feed([HI, HI]);
    engine.stop();
    expect(phases.at(-1)).toBe('stopped');
    const n = { events: events.length, samples: samples.length, phases: phases.length };
    feed([HI, LO, LO, LO, HI, HI, HI, LO, LO, LO]);
    expect({ events: events.length, samples: samples.length, phases: phases.length }).toEqual(n);
    expect(passes).toEqual([]);
    expect(engine.detectorState()).toBeNull();
  });

  it('stop() unsubscribes from the source', () => {
    engine.start(src.source, s);
    expect(src.listeners()).toBe(1);
    engine.stop();
    expect(src.listeners()).toBe(0);
  });

  it('reset() → warm-up again; motion during warm-up is ignored', () => {
    engine.start(src.source, s);
    warm();
    const resets = analyzer.resets;
    engine.reset();
    expect(phases.at(-1)).toBe('warmup');
    expect(analyzer.resets).toBe(resets + 1);
    feed(pass.slice(0, 4)); // inside the new warm-up
    expect(events).toEqual([]);
    feed([LO, LO, LO, ...pass]);
    expect(passes).toHaveLength(1);
  });

  it('reset() bumps the run: a leaky old subscription goes quiet', () => {
    make(true);
    engine.start(src.source, s);
    warm();
    engine.reset();
    const before = samples.length;
    feed([LO]);
    expect(samples.length).toBe(before + 1); // only the new subscription
  });

  it('reset() when stopped is a no-op', () => {
    engine.reset();
    expect(phases).toEqual([]);
  });

  it('a listener may stop the engine inside pass: nothing else is emitted for that frame', () => {
    engine.on('pass', () => engine.stop());
    const late = vi.fn();
    engine.on('sample', late);
    engine.start(src.source, s);
    warm();
    late.mockClear();
    feed(pass);
    expect(passes).toHaveLength(1);
    // MOTION_END comes on the 5th frame; its sample is never emitted after the stop.
    expect(late).toHaveBeenCalledTimes(4);
    feed(pass);
    expect(passes).toHaveLength(1);
  });

  it('frame gap > resetGapMs → analyzer reset, neutral sample', () => {
    engine.start(src.source, s);
    warm();
    const resets = analyzer.resets;
    clock += 400;
    src.frame(400); // resetGapMs 250
    expect(analyzer.resets).toBe(resets + 1);
    expect(samples.at(-1)?.gapReset).toBe(true);
    src.frame(100, { gapReset: true }); // source-flagged discontinuity
    expect(analyzer.resets).toBe(resets + 2);
  });

  it('seeked frame (file loop) → detector back to warm-up on the new time base', () => {
    engine.start(src.source, s);
    warm();
    expect(engine.detectorState()).toBe('IDLE');
    src.setT(0);
    src.frame(0, { seeked: true, gapReset: true });
    expect(engine.detectorState()).toBe('WARMUP');
    expect(phases.at(-1)).toBe('warmup');
  });

  it('update(): live tuning; the settings object is copied', () => {
    const mine = { ...s, roi: { ...s.roi } };
    engine.start(src.source, mine);
    warm();
    mine.startRatio = 0.9; // caller mutation has no effect
    feed(pass);
    expect(passes).toHaveLength(1);
    engine.update({ ...s, startRatio: 0.1 }); // HI is below the new threshold
    feed([LO, LO, LO, LO, LO, LO, LO, LO, LO, LO, LO, ...pass]);
    expect(passes).toHaveLength(1);
  });

  it('start() while running restarts on the new source', () => {
    engine.start(src.source, s);
    const other = fakeSource();
    engine.start(other.source, s);
    expect(src.listeners()).toBe(0);
    expect(other.listeners()).toBe(1);
    expect(phases).toEqual(['warmup', 'stopped', 'warmup']);
  });

  it('sample is emitted every frame', () => {
    engine.start(src.source, s);
    feed([LO, HI]);
    expect(samples.map((x) => x.ratio)).toEqual([LO, HI]);
  });

  describe('stats', () => {
    it('fps, delivered fps, dropped, ratio, tSource', () => {
      engine.start(src.source, s);
      for (let i = 0; i < 20; i++) {
        clock += 33;
        src.frame(33, { presented: i * 2, dropped: i === 0 ? 0 : 1, tSource: 'captureTime' });
      }
      const st = engine.stats();
      expect(st.fps).toBeCloseTo(1000 / 33, 5);
      expect(st.deliveredFps).toBeCloseTo(2000 / 33, 5);
      expect(st.dropped).toBe(19);
      expect(st.tSource).toBe('captureTime');
      expect(st.ratio).toBe(LO);
    });

    it('no presentedFrames → delivered null; no frames for 1 s → fps 0', () => {
      engine.start(src.source, s);
      feed([LO, LO, LO]);
      expect(engine.stats().deliveredFps).toBeNull();
      expect(engine.stats().fps).toBeCloseTo(10, 5);
      clock += 1500;
      expect(engine.stats().fps).toBe(0);
    });

    it('msPerFrame is the p95 of the processing time', () => {
      let i = 0;
      // each frame: process takes 5 ms, every 10th 50 ms
      const a = fakeAnalyzer();
      const proc = a.process;
      a.process = (img, w, h, x) => {
        clock += ++i % 10 === 0 ? 50 : 5;
        return proc(img, w, h, x);
      };
      const e = createDetectorEngine({ analyzer: a, now: () => clock });
      const fs = fakeSource();
      e.start(fs.source, s);
      for (let k = 0; k < 100; k++) fs.frame(33);
      expect(e.stats().msPerFrame).toBe(50);
      expect(e.stats().fps).toBeGreaterThan(0);
    });
  });

  it('with the real analyzer: a frame-size change gives a neutral frame', () => {
    const { factory } = fakeContexts();
    const e = createDetectorEngine({ analyzer: createFrameAnalyzer({ context: factory }), now: () => 0 });
    const fs = fakeSource();
    Object.assign(fs.video, solid(240, 480, 100)); // the fake context samples video.luma
    const got: boolean[] = [];
    e.on('sample', (x) => got.push(x.global));
    e.start(fs.source, s);
    fs.frame();
    fs.frame();
    Object.assign(fs.video, { videoWidth: 480, videoHeight: 240 }); // rotated
    fs.frame();
    fs.frame();
    expect(got).toEqual([true, false, true, false]);
  });

  it('with the real analyzer: a preset via update() moves the crop and resizes the buffers', () => {
    const { factory, created } = fakeContexts();
    const a = createFrameAnalyzer({ context: factory });
    const e = createDetectorEngine({ analyzer: a, now: () => 0 });
    const fs = fakeSource();
    Object.assign(fs.video, solid(240, 480, 100));
    const got: boolean[] = [];
    e.on('sample', (x) => got.push(x.global));
    e.start(fs.source, { ...s, roi: ROI_PRESETS.full });
    fs.frame();
    fs.frame();
    expect(a.size).toEqual({ width: 160, height: 320 });
    e.update({ ...s, roi: ROI_PRESETS.vLine });
    fs.frame();
    fs.frame();
    expect(created[0]?.draws.at(-1)).toEqual({ sx: 102, sy: 48, sw: 36, sh: 384, dw: 30, dh: 320 });
    expect(a.size).toEqual({ width: 30, height: 320 });
    expect(got).toEqual([true, false, true, false]);
  });
});
