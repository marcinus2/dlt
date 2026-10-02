// DetectorEngine (plan 4.8): source → analyzer → detector → events. No DOM: the source's video
// is only handed to the analyzer. Emits `pass` only for accepted MOTION_END (D1).
// The run id is bumped on stop()/reset(), so frames and listeners of an older run go quiet.
import { createDetector, type Detector, type DetectorState } from './detector.ts';
import type {
  DetectionSettings,
  DetectorEngine,
  DetectorEvent,
  EnginePhase,
  EngineStats,
  FrameAnalyzer,
  FrameMeta,
  FrameSource,
  MotionSample,
  Ms,
  PassEvent,
  Unsubscribe,
} from './types.ts';

export interface Engine extends DetectorEngine {
  /** Detector state of the last frame (debug CSV), null when stopped. */
  detectorState(): DetectorState | null;
}

export interface EngineOptions {
  analyzer: FrameAnalyzer;
  now?: () => Ms;
}

interface Listeners {
  pass: Set<(p: PassEvent) => void>;
  phase: Set<(p: EnginePhase) => void>;
  event: Set<(e: DetectorEvent) => void>;
  sample: Set<(s: MotionSample) => void>;
}

const P95_WINDOW = 120; // frames (~4 s at 30 fps)
const STALE_MS = 1000; // no frame for this long → fps 0
const EMA = 0.1;

const PHASE: Record<DetectorState, EnginePhase> = {
  WARMUP: 'warmup',
  IDLE: 'armed',
  CANDIDATE: 'armed',
  MOTION: 'motion',
};

const copy = (s: DetectionSettings): DetectionSettings => ({ ...s, roi: { ...s.roi } });

export function createDetectorEngine(opts: EngineOptions): Engine {
  const { analyzer } = opts;
  const now = opts.now ?? (() => performance.now());
  const ls: Listeners = { pass: new Set(), phase: new Set(), event: new Set(), sample: new Set() };
  /** Emitted every frame; one reused object, copy what you keep. */
  const sample: MotionSample = { t: 0, ratio: 0, globalRatio: 0, global: true, gapReset: false };

  let run = 0;
  let source: FrameSource | null = null;
  let off: Unsubscribe | null = null;
  let cfg: DetectionSettings | null = null;
  let detector: Detector | null = null;
  let phase: EnginePhase = 'stopped';
  let lastT: Ms | null = null;

  // stats: frame interval and delivered interval as EMAs, ms/frame ring for p95
  let frameAt: Ms | null = null;
  let intervalEma = 0;
  let presLast: number | null = null;
  let presAt = 0;
  let deliveredEma = 0;
  let dropped = 0;
  let ratio = 0;
  let tSource: FrameMeta['tSource'] = 'now';
  const ms = new Float64Array(P95_WINDOW);
  const sorted = new Float64Array(P95_WINDOW);
  let msCount = 0;
  let msIdx = 0;

  function resetStats() {
    frameAt = presLast = null;
    intervalEma = deliveredEma = 0;
    dropped = msCount = msIdx = 0;
    ratio = 0;
  }

  function setPhase(p: EnginePhase) {
    if (p === phase) return;
    phase = p;
    for (const cb of ls.phase) cb(p);
  }

  /** (Re)subscribe to the source under a new run id. */
  function attach(src: FrameSource) {
    off?.();
    const my = ++run;
    off = src.onFrame((f) => {
      if (my === run) onFrame(f, src, my);
    });
  }

  function onFrame(f: FrameMeta, src: FrameSource, my: number) {
    const s = cfg;
    const det = detector;
    if (!s || !det) return;
    const t0 = now();
    const gap = f.gapReset || (lastT !== null && f.t - lastT > s.resetGapMs);
    lastT = f.t;
    if (gap) analyzer.reset();
    if (f.seeked) det.reset(f.t); // file loop / seek: new time base
    const v = src.video;
    const r = analyzer.process(v, v.videoWidth, v.videoHeight, s);
    sample.t = f.t;
    sample.ratio = r.ratio;
    sample.globalRatio = r.globalRatio;
    sample.global = r.global;
    sample.gapReset = gap;
    const events = det.update(sample);

    if (frameAt !== null)
      intervalEma = intervalEma === 0 ? t0 - frameAt : intervalEma + EMA * (t0 - frameAt - intervalEma);
    frameAt = t0;
    if (f.presented !== null && !f.seeked) {
      if (presLast !== null && f.presented > presLast) {
        const per = (t0 - presAt) / (f.presented - presLast);
        deliveredEma = deliveredEma === 0 ? per : deliveredEma + EMA * (per - deliveredEma);
      }
      presLast = f.presented;
      presAt = t0;
    }
    dropped += f.dropped;
    ratio = r.ratio;
    tSource = f.tSource;
    ms[msIdx] = now() - t0;
    msIdx = (msIdx + 1) % P95_WINDOW;
    if (msCount < P95_WINDOW) msCount++;

    // A listener may stop() or reset() the engine: re-check the run after every callback.
    for (const e of events) {
      for (const cb of ls.event) {
        cb(e);
        if (my !== run) return;
      }
    }
    setPhase(PHASE[det.state]);
    if (my !== run) return;
    for (const e of events) {
      if (e.type !== 'MOTION_END') continue;
      const pass: PassEvent = {
        t: e.t,
        startT: e.startT,
        endT: e.endT,
        peakT: e.peakT,
        peakRatio: e.peakRatio,
      };
      for (const cb of ls.pass) {
        cb(pass);
        if (my !== run) return;
      }
    }
    for (const cb of ls.sample) {
      cb(sample);
      if (my !== run) return;
    }
  }

  function p95(): number {
    if (msCount === 0) return 0;
    const a = sorted.subarray(0, msCount);
    a.set(ms.subarray(0, msCount));
    a.sort();
    return a[Math.ceil(0.95 * msCount) - 1] as number;
  }

  function stop() {
    run++;
    off?.();
    off = null;
    source = null;
    detector = null;
    cfg = null;
    setPhase('stopped');
  }

  return {
    start(src, s) {
      if (source) stop();
      source = src;
      cfg = copy(s);
      detector = createDetector(cfg);
      lastT = null;
      analyzer.reset();
      resetStats();
      setPhase('warmup');
      attach(src);
    },
    stop,
    reset() {
      if (!source || !detector) return;
      detector.reset(); // warm-up from the next frame
      analyzer.reset();
      lastT = null;
      setPhase('warmup');
      attach(source);
    },
    update(s) {
      if (cfg) Object.assign(cfg, copy(s)); // the detector reads cfg live
    },
    on(e: keyof Listeners, cb: (v: never) => void): Unsubscribe {
      const set = ls[e] as Set<unknown>;
      set.add(cb);
      return () => set.delete(cb);
    },
    stats(): EngineStats {
      const stale = frameAt === null || now() - frameAt > STALE_MS;
      return {
        fps: stale || intervalEma <= 0 ? 0 : 1000 / intervalEma,
        deliveredFps: presLast === null ? null : stale ? 0 : deliveredEma > 0 ? 1000 / deliveredEma : null,
        dropped,
        msPerFrame: p95(),
        ratio,
        tSource,
      };
    },
    detectorState: () => detector?.state ?? null,
  } as Engine;
}
