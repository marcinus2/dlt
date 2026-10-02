// Lap semantics (spec §3.3). Pure.
import type { Ms } from '../engine/types.ts';
import type { Cue, Lap, SessionData } from './types.ts';

export function newSession(): SessionData {
  return { laps: [], bestIdx: null, timing: { kind: 'standby' }, phase: 'arming' };
}

/** "Has data" guard for the leave/end confirmations (spec §3.2). */
export function hasData(s: SessionData | null): boolean {
  return s !== null && (s.laps.length > 0 || s.timing.kind === 'running');
}

/**
 * Accepted pass at `t` (backdated startT). standby → running (no lap, "go");
 * running → append lap (`lap` or `best`).
 */
export function applyPass(s: SessionData, t: Ms): { session: SessionData; cue: 'go' | 'lap' | 'best' } {
  if (s.timing.kind === 'standby') {
    return { session: { ...s, timing: { kind: 'running', refT: t } }, cue: 'go' };
  }
  const lap: Lap = { n: s.laps.length + 1, ms: t - s.timing.refT, at: t };
  const laps = [...s.laps, lap];
  const prevBest = s.bestIdx === null ? undefined : s.laps[s.bestIdx];
  // Strictly smaller: ties keep the earlier lap.
  const isBest = prevBest === undefined || lap.ms < prevBest.ms;
  return {
    session: {
      ...s,
      laps,
      bestIdx: isBest ? laps.length - 1 : s.bestIdx,
      timing: { kind: 'running', refT: t },
    },
    cue: isBest ? 'best' : 'lap',
  };
}

/** STOP: the in-progress lap is dropped, laps are kept. */
export function stop(s: SessionData): SessionData {
  return s.timing.kind === 'standby' ? s : { ...s, timing: { kind: 'standby' } };
}

function split(ms: Ms): { min: number; sec: number; cs: number } {
  const totalCs = Math.round(ms / 10);
  return { min: Math.floor(totalCs / 6000), sec: Math.floor(totalCs / 100) % 60, cs: totalCs % 100 };
}

/** `ss.cc` below 60 s, `m:ss.cc` above; rounded to 10 ms. */
export function formatLap(ms: Ms): string {
  const { min, sec, cs } = split(ms);
  const cc = String(cs).padStart(2, '0');
  return min === 0 ? `${sec}.${cc}` : `${min}:${String(sec).padStart(2, '0')}.${cc}`;
}

function spokenTime(ms: Ms): string {
  const { min, sec, cs } = split(ms);
  const s = `${sec}.${String(cs).padStart(2, '0')}`;
  return min === 0 ? s : `${min} ${min === 1 ? 'minute' : 'minutes'} ${s}`;
}

/** Spoken phrase per cue (D9). `armed` is a tone only. */
export function speechText(cue: Cue, lapMs?: Ms): string {
  switch (cue) {
    case 'go':
      return 'Go';
    case 'paused':
      return 'Paused';
    case 'lap':
      return lapMs === undefined ? '' : spokenTime(lapMs);
    case 'best':
      return lapMs === undefined ? '' : `Best, ${spokenTime(lapMs)}`;
    case 'armed':
      return '';
  }
}
