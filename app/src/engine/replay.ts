// Replay (plan 4.9): recorded frames-CSV rows (PoC export format) through the detector and the
// lap logic, so real sessions can be re-checked after any detector change.
import { applyPass, newSession } from '../session/laps.ts';
import type { Lap } from '../session/types.ts';
import { createDetector, type DetectorSettings } from './detector.ts';
import type { DetectorEvent, Ms, PassEvent } from './types.ts';

export interface FrameRow {
  t: Ms;
  ratio: number;
  globalRatio: number;
  global: boolean;
  state: string;
}

export interface ReplayResult {
  events: DetectorEvent[];
  passes: PassEvent[];
  laps: Lap[];
  bestIdx: number | null;
}

/** Parses `t,ratio,globalRatio,global,state` (header required, columns by name). */
export function parseFramesCsv(text: string): FrameRow[] {
  const lines = text.trim().split(/\r?\n/);
  const header = (lines.shift() ?? '').split(',');
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`frames CSV: missing column ${name}`);
    return i;
  };
  const [ti, ri, gri, gi, si] = ['t', 'ratio', 'globalRatio', 'global', 'state'].map(col) as number[];
  return lines
    .filter((l) => l !== '')
    .map((l) => {
      const c = l.split(',');
      return {
        t: Number(c[ti as number]),
        ratio: Number(c[ri as number]),
        globalRatio: Number(c[gri as number]),
        global: c[gi as number] === '1',
        state: c[si as number] ?? '',
      };
    });
}

/**
 * Detector from WARMUP at the first row (as the PoC's Start detection). Calibration rows are
 * skipped; a backwards time jump (file loop) resets the detector, as a seeked frame does live.
 */
export function replay(rows: readonly FrameRow[], settings: DetectorSettings): ReplayResult {
  const det = createDetector(settings);
  let session = newSession();
  const events: DetectorEvent[] = [];
  const passes: PassEvent[] = [];
  let lastT: Ms | null = null;
  for (const row of rows) {
    if (row.state === 'CALIB' || row.state === 'OFF') continue;
    if (lastT !== null && row.t < lastT) det.reset(row.t);
    lastT = row.t;
    for (const e of det.update(row)) {
      events.push(e);
      if (e.type !== 'MOTION_END') continue;
      passes.push({ startT: e.startT, endT: e.endT, peakT: e.peakT, peakRatio: e.peakRatio });
      session = applyPass(session, e.startT).session;
    }
  }
  return { events, passes, laps: session.laps, bestIdx: session.bestIdx };
}
