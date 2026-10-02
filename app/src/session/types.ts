import type { Ms } from '../engine/types.ts';

export interface Lap {
  n: number; // starts at 1
  ms: Ms;
  at: Ms; // pass.startT
}
export type Timing = { kind: 'standby' } | { kind: 'running'; refT: Ms };
export interface SessionData {
  laps: Lap[];
  bestIdx: number | null;
  timing: Timing;
  phase: 'arming' | 'ready';
}
export type Cue = 'armed' | 'go' | 'lap' | 'best' | 'paused';
