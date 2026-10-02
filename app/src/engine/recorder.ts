// Debug recorder + CSV builders, ported 1:1 from the PoC `recorder.js`. Per-frame rows live in
// preallocated typed arrays (≈ 5 MB at the default cap), so only create one on the debug page.
import type { DetectorEvent, Ms } from './types.ts';

const STATES = ['OFF', 'WARMUP', 'IDLE', 'CANDIDATE', 'MOTION', 'CALIB'] as const;
export type RecordedState = (typeof STATES)[number];
const EVENT_COLS = [
  'type',
  't',
  'startT',
  'endT',
  'durationMs',
  'peakT',
  'peakRatio',
  'frames',
  'dStart',
  'dPeak',
  'reason',
] as const;

export interface Recorder {
  /** false once the cap is reached. */
  addFrame(t: Ms, ratio: number, globalRatio: number, global: boolean, state: RecordedState): boolean;
  addEvent(e: DetectorEvent): void;
  clear(): void;
  readonly frameCount: number;
  readonly eventCount: number;
  eventsCsv(): string;
  /** Same format as the PoC export: `t,ratio,globalRatio,global,state`. */
  framesCsv(): string;
}

const cell = (v: unknown) =>
  v === undefined || v === null ? '' : typeof v === 'number' ? String(+v.toFixed(6)) : String(v);

export function createRecorder(cap = 200000): Recorder {
  // 200k rows ≈ 55 min @ 60 fps
  const t = new Float64Array(cap);
  const ratio = new Float64Array(cap);
  const gRatio = new Float64Array(cap);
  const global = new Uint8Array(cap);
  const state = new Uint8Array(cap);
  let n = 0;
  let events: DetectorEvent[] = [];

  return {
    addFrame(ft, r, gr, g, st) {
      if (n >= cap) return false;
      t[n] = ft;
      ratio[n] = r;
      gRatio[n] = gr;
      global[n] = g ? 1 : 0;
      state[n] = Math.max(0, STATES.indexOf(st));
      n++;
      return true;
    },
    addEvent(e) {
      events.push(e);
    },
    clear() {
      n = 0;
      events = [];
    },
    get frameCount() {
      return n;
    },
    get eventCount() {
      return events.length;
    },
    eventsCsv() {
      const rows = events.map((e) =>
        EVENT_COLS.map((c) => cell((e as Record<string, unknown>)[c])).join(','),
      );
      return `${[EVENT_COLS.join(','), ...rows].join('\n')}\n`;
    },
    framesCsv() {
      const rows = ['t,ratio,globalRatio,global,state'];
      for (let i = 0; i < n; i++)
        rows.push(
          `${+(t[i] as number).toFixed(3)},${ratio[i]},${gRatio[i]},${global[i]},${STATES[state[i] as number]}`,
        );
      return `${rows.join('\n')}\n`;
    },
  };
}
