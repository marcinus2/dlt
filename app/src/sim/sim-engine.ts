// Simulated DetectorEngine (plan 2.5, G11): warm-up → armed after warmupMs, auto passes with
// random lap times (≥ cooldownMs), manual pass(), fake stats with a low-fps switch.
import type {
  DetectionSettings,
  DetectorEngine,
  DetectorEvent,
  EnginePhase,
  EngineStats,
  FrameSource,
  MotionSample,
  Ms,
  PassEvent,
  Unsubscribe,
} from '../engine/types.ts';

type Timer = unknown;
export interface SimEngineOptions {
  now?: () => Ms;
  setTimer?: (cb: () => void, ms: Ms) => Timer;
  clearTimer?: (t: Timer) => void;
  random?: () => number;
  /** Lap time range in ms (default 10–15 s). */
  lapRange?: [Ms, Ms];
  auto?: boolean;
}

export interface SimEngine extends DetectorEngine {
  pass(): void;
  setAuto(on: boolean): void;
  auto(): boolean;
  setLowFps(on: boolean): void;
  lowFps(): boolean;
  setLapRange(range: [Ms, Ms]): void;
  phase(): EnginePhase;
}

export const SIM_MOTION_MS = 180; // MOTION_START → MOTION_END of a simulated pass
export const SIM_FIRST_PASS_MS = 3000; // auto: first pass after arming

interface Listeners {
  pass: Set<(p: PassEvent) => void>;
  phase: Set<(p: EnginePhase) => void>;
  event: Set<(e: DetectorEvent) => void>;
  sample: Set<(s: MotionSample) => void>;
}

function emit<T>(set: Set<(v: T) => void>, v: T) {
  for (const cb of set) cb(v);
}

export function createSimEngine(opts: SimEngineOptions = {}): SimEngine {
  const now = opts.now ?? (() => performance.now());
  const setTimer = opts.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer = opts.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const random = opts.random ?? Math.random;
  let lapRange = opts.lapRange ?? [10000, 15000];
  let auto = opts.auto ?? true;
  let lowFps = false;

  const ls: Listeners = { pass: new Set(), phase: new Set(), event: new Set(), sample: new Set() };
  let settings: DetectionSettings | null = null;
  let phase: EnginePhase = 'stopped';
  let lastStart: Ms | null = null;
  let timers: Timer[] = [];
  let autoTimer: Timer | null = null;
  let run = 0;
  let dropped = 0;

  function setPhase(p: EnginePhase) {
    if (p === phase) return;
    phase = p;
    emit(ls.phase, p);
  }

  /** Timer bound to the current run: dropped if stop()/reset() happened since. */
  function later(ms: Ms, cb: () => void): Timer {
    const r = run;
    const t = setTimer(() => {
      timers = timers.filter((x) => x !== t);
      if (r === run) cb();
    }, ms);
    timers.push(t);
    return t;
  }

  function clearAll() {
    for (const t of timers) clearTimer(t);
    timers = [];
    autoTimer = null;
  }

  function lapMs(): Ms {
    const [lo, hi] = lapRange;
    return Math.max(lo + random() * (hi - lo), settings?.cooldownMs ?? 0);
  }

  function scheduleAuto(ms: Ms) {
    if (autoTimer !== null) clearTimer(autoTimer);
    autoTimer = auto && phase !== 'stopped' ? later(ms, trigger) : null;
  }

  function warmup() {
    clearAll();
    run++;
    lastStart = null;
    setPhase('warmup');
    later(settings?.warmupMs ?? 0, () => {
      setPhase('armed');
      scheduleAuto(SIM_FIRST_PASS_MS);
    });
  }

  function trigger() {
    if (phase !== 'armed' || !settings) return;
    const t0 = now();
    if (lastStart !== null && t0 - lastStart < settings.cooldownMs) {
      emit(ls.event, { type: 'SUPPRESSED', t: t0, reason: 'cooldown' });
      scheduleAuto(lapMs()); // keep auto going
      return;
    }
    const dStart = lastStart === null ? null : t0 - lastStart;
    lastStart = t0;
    setPhase('motion');
    emit(ls.event, { type: 'MOTION_START', t: t0, dStart });
    scheduleAuto(lapMs());
    later(SIM_MOTION_MS, () => {
      const endT = now();
      const peakT = t0 + (endT - t0) / 2;
      const peakRatio = 0.05 + random() * 0.15;
      emit(ls.event, {
        type: 'MOTION_END',
        t: endT,
        startT: t0,
        endT,
        durationMs: endT - t0,
        peakT,
        peakRatio,
        frames: Math.round((endT - t0) / 33),
        dStart,
        dPeak: dStart,
      });
      setPhase('armed');
      emit(ls.pass, { startT: t0, endT, peakT, peakRatio });
    });
  }

  return {
    start(_source: FrameSource, s: DetectionSettings) {
      settings = s;
      warmup();
    },
    stop() {
      clearAll();
      run++;
      setPhase('stopped');
    },
    reset() {
      if (phase !== 'stopped') warmup();
    },
    update(s) {
      settings = s;
    },
    on(e: keyof Listeners, cb: (v: never) => void): Unsubscribe {
      const set = ls[e] as Set<unknown>;
      set.add(cb);
      return () => set.delete(cb);
    },
    stats(): EngineStats {
      const jitter = random() - 0.5;
      if (lowFps) dropped += 2;
      return {
        fps: lowFps ? 14 + jitter : 29.5 + jitter,
        deliveredFps: lowFps ? 15 : 30,
        dropped,
        msPerFrame: lowFps ? 38 + jitter : 6 + jitter,
        ratio: phase === 'motion' ? 0.12 : 0.002,
        tSource: 'now',
      };
    },
    pass: trigger,
    setAuto(on) {
      auto = on;
      if (!on) scheduleAuto(0);
      else if (phase === 'armed') scheduleAuto(lapMs());
    },
    auto: () => auto,
    setLowFps(on) {
      lowFps = on;
    },
    lowFps: () => lowFps,
    setLapRange(range) {
      lapRange = range;
    },
    phase: () => phase,
  } as SimEngine;
}
