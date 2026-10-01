// Pure motion state machine, no DOM. Rules: docs/dev-plan.md §5 and brainstorm §4.
// update({ t, ratio, global, gapReset }) -> events[]
export const WARMUP = 'WARMUP';
export const IDLE = 'IDLE';
export const CANDIDATE = 'CANDIDATE';
export const MOTION = 'MOTION';

export function createDetector(config) {
  let state = WARMUP;
  let warmUntil = null;      // null = set from the first sample after reset()
  let lastStartT = null;     // last accepted (backdated) startT
  let lastPeakT = null;      // peakT of the last accepted, finished pass
  let pass = null;           // pass record: startT, peakT, peakRatio, frames, prevStartT, prevPeakT
  let suppressed = false;
  let firstT = 0, candFrames = 0, candPeakT = 0, candPeak = 0;
  let quiet = 0, activeT = 0;

  function reset(t) {
    state = WARMUP;
    warmUntil = t === undefined ? null : t + config.warmupMs;
    pass = null;
    suppressed = false;
    quiet = 0;
  }

  // CANDIDATE confirmed: start the pass record, or suppress it inside the cooldown.
  function confirm(t, events) {
    suppressed = lastStartT !== null && firstT - lastStartT < config.cooldownMs;
    pass = {
      startT: firstT, peakT: candPeakT, peakRatio: candPeak, frames: candFrames,
      prevStartT: lastStartT, prevPeakT: lastPeakT,
    };
    quiet = 0;
    activeT = t;
    state = MOTION;
    if (suppressed) {
      events.push({ type: 'SUPPRESSED', t: firstT, reason: 'cooldown' });
    } else {
      const dStart = lastStartT === null ? null : firstT - lastStartT;
      lastStartT = firstT;
      events.push({ type: 'MOTION_START', t: firstT, dStart });
    }
  }

  function update(sample) {
    const { t, ratio } = sample;
    const events = [];
    if (warmUntil === null) warmUntil = t + config.warmupMs;
    if (state === WARMUP) {
      if (t < warmUntil) return events;
      state = IDLE;
    }
    const neutral = sample.global || sample.gapReset;

    if (state === IDLE) {
      if (neutral || ratio < config.startRatio) return events;
      firstT = t; candFrames = 1; candPeakT = t; candPeak = ratio;
      state = CANDIDATE;
      if (candFrames >= config.minMotionFrames) confirm(t, events);
    } else if (state === CANDIDATE) {
      if (neutral) return events;
      if (ratio < config.startRatio) { state = IDLE; return events; }
      candFrames++;
      if (ratio > candPeak) { candPeak = ratio; candPeakT = t; }
      if (candFrames >= config.minMotionFrames) confirm(t, events);
    } else {
      // MOTION: maxMotionMs runs on t, so neutral frames count toward it
      if (t - pass.startT > config.maxMotionMs) {
        if (!suppressed) {
          // a rejected pass isn't a lap: restore the previous start for Δstart / cooldown
          lastStartT = pass.prevStartT;
          events.push({ type: 'REJECTED', reason: 'LONG_MOTION', startT: pass.startT, t, durationMs: t - pass.startT });
        }
        state = IDLE;
        pass = null;
        return events;
      }
      if (neutral) return events;
      pass.frames++;
      if (ratio > pass.peakRatio) { pass.peakRatio = ratio; pass.peakT = t; }
      if (ratio >= config.endRatio) { quiet = 0; activeT = t; return events; }
      if (++quiet < config.endHoldFrames) return events;
      // the pass ended at its last active frame; the quiet frames don't belong to it
      if (!suppressed) {
        events.push({
          type: 'MOTION_END', t: activeT, startT: pass.startT, endT: activeT,
          durationMs: activeT - pass.startT, peakT: pass.peakT, peakRatio: pass.peakRatio,
          frames: pass.frames - quiet,
          dStart: pass.prevStartT === null ? null : pass.startT - pass.prevStartT,
          dPeak: pass.prevPeakT === null ? null : pass.peakT - pass.prevPeakT,
        });
        lastPeakT = pass.peakT;
      }
      state = IDLE;
      pass = null;
    }
    return events;
  }

  return { update, reset, get state() { return state; } };
}
