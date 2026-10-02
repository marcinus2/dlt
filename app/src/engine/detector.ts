// Pure motion state machine, ported 1:1 from the PoC `detector.js` (rules: PoC dev-plan §5).
// Reads the passed settings object on every update, so the owner can tune it live.
import type { DetectionSettings, DetectorEvent, MotionSample, Ms } from './types.ts';

export type DetectorState = 'WARMUP' | 'IDLE' | 'CANDIDATE' | 'MOTION';
export type DetectorSettings = Pick<
  DetectionSettings,
  'startRatio' | 'endRatio' | 'minMotionMs' | 'endHoldMs' | 'cooldownMs' | 'maxMotionMs' | 'warmupMs'
>;
export type DetectorSample = Pick<MotionSample, 't' | 'ratio'> &
  Partial<Pick<MotionSample, 'global' | 'gapReset'>>;

export interface Detector {
  /** Events of this sample. The empty result is a shared frozen array (no per-frame allocation). */
  update(sample: DetectorSample): readonly DetectorEvent[];
  /** Back to WARMUP until t + warmupMs (from the next sample when t is omitted). */
  reset(t?: Ms): void;
  readonly state: DetectorState;
}

const NONE: readonly DetectorEvent[] = Object.freeze([]);

interface Pass {
  startT: Ms;
  peakT: Ms;
  peakRatio: number;
  frames: number;
  prevStartT: Ms | null;
  prevPeakT: Ms | null;
}

export function createDetector(config: DetectorSettings): Detector {
  let state: DetectorState = 'WARMUP';
  let warmUntil: Ms | null = null; // null = set from the first sample after reset()
  let lastStartT: Ms | null = null; // last accepted (backdated) startT
  let lastPeakT: Ms | null = null; // peakT of the last accepted, finished pass
  let pass: Pass | null = null;
  let suppressed = false;
  let firstT = 0;
  let candFrames = 0;
  let candPeakT = 0;
  let candPeak = 0;
  let quiet = 0; // quiet frame count
  let quietT: Ms | null = null; // time of the first quiet frame
  let activeT = 0;
  let rearm = false; // after a long motion: need endHoldMs of quiet before IDLE can trigger
  let events: DetectorEvent[] | null = null;

  const emit = (e: DetectorEvent) => {
    events ??= [];
    events.push(e);
  };

  function reset(t?: Ms) {
    state = 'WARMUP';
    warmUntil = t === undefined ? null : t + config.warmupMs;
    pass = null;
    suppressed = false;
    quiet = 0;
    quietT = null;
    rearm = false;
    lastStartT = lastPeakT = null; // the time base may have jumped (file loop/seek): old times are meaningless
  }

  // CANDIDATE confirmed: start the pass record, or suppress it inside the cooldown.
  function confirm(t: Ms) {
    suppressed = lastStartT !== null && firstT - lastStartT < config.cooldownMs;
    pass = {
      startT: firstT,
      peakT: candPeakT,
      peakRatio: candPeak,
      frames: candFrames,
      prevStartT: lastStartT,
      prevPeakT: lastPeakT,
    };
    quiet = 0;
    quietT = null;
    activeT = t;
    state = 'MOTION';
    if (suppressed) {
      emit({ type: 'SUPPRESSED', t: firstT, reason: 'cooldown' });
    } else {
      const dStart = lastStartT === null ? null : firstT - lastStartT;
      lastStartT = firstT;
      emit({ type: 'MOTION_START', t: firstT, dStart });
    }
  }

  function step(sample: DetectorSample) {
    const { t, ratio } = sample;
    if (warmUntil === null) warmUntil = t + config.warmupMs;
    if (state === 'WARMUP') {
      if (t < warmUntil) return;
      state = 'IDLE';
    }
    const neutral = sample.global || sample.gapReset;

    if (state === 'IDLE') {
      if (rearm) {
        if (neutral) return;
        if (ratio >= config.endRatio) quietT = null;
        else {
          if (quietT === null) quietT = t;
          if (t - quietT >= config.endHoldMs) {
            rearm = false;
            quietT = null;
          }
        }
        return;
      }
      if (neutral || ratio < config.startRatio) return;
      firstT = t;
      candFrames = 1;
      candPeakT = t;
      candPeak = ratio;
      state = 'CANDIDATE';
      if (t - firstT >= config.minMotionMs) confirm(t);
    } else if (state === 'CANDIDATE') {
      if (neutral) return;
      if (ratio < config.startRatio) {
        state = 'IDLE';
        return;
      }
      candFrames++;
      if (ratio > candPeak) {
        candPeak = ratio;
        candPeakT = t;
      }
      if (t - firstT >= config.minMotionMs) confirm(t);
    } else if (pass) {
      // MOTION: maxMotionMs runs on t, so neutral frames count toward it
      if (t - pass.startT > config.maxMotionMs) {
        if (!suppressed) {
          // a rejected pass isn't a lap: restore the previous start for Δstart / cooldown
          lastStartT = pass.prevStartT;
          emit({
            type: 'REJECTED',
            reason: 'LONG_MOTION',
            startT: pass.startT,
            t,
            durationMs: t - pass.startT,
          });
        }
        state = 'IDLE';
        pass = null;
        rearm = true;
        quiet = 0;
        quietT = null;
        return;
      }
      if (neutral) return;
      pass.frames++;
      if (ratio > pass.peakRatio) {
        pass.peakRatio = ratio;
        pass.peakT = t;
      }
      if (ratio >= config.endRatio) {
        quiet = 0;
        quietT = null;
        activeT = t;
        return;
      }
      quiet++;
      if (quietT === null) quietT = t;
      if (t - quietT < config.endHoldMs) return;
      // the pass ended at its last active frame; the quiet frames don't belong to it
      if (!suppressed) {
        emit({
          type: 'MOTION_END',
          t: activeT,
          startT: pass.startT,
          endT: activeT,
          durationMs: activeT - pass.startT,
          peakT: pass.peakT,
          peakRatio: pass.peakRatio,
          frames: pass.frames - quiet,
          dStart: pass.prevStartT === null ? null : pass.startT - pass.prevStartT,
          dPeak: pass.prevPeakT === null ? null : pass.peakT - pass.prevPeakT,
        });
        lastPeakT = pass.peakT;
      }
      state = 'IDLE';
      pass = null;
    }
  }

  return {
    update(sample) {
      events = null;
      step(sample);
      return events ?? NONE;
    },
    reset,
    get state() {
      return state;
    },
  };
}
