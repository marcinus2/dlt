// Port parity (plan 4.2): random sample streams through the frozen PoC detector and the TS port
// must give identical events and states, sample by sample.
import { expect, it } from 'vitest';
// @ts-expect-error untyped PoC module (plain JS, frozen)
import { createDetector as createPocDetector } from '../../../drone-lap-poc/src/detector.js';
import { DEFAULTS } from '../settings/schema.ts';
import { createDetector, type DetectorSample, type DetectorSettings } from './detector.ts';
import { parseFramesCsv, replay } from './replay.ts';
import { mulberry32 } from './test/synthetic.ts';

const LEVELS = [0, 0.004, 0.008, 0.015, 0.03, 0.08];
const FPS = [10, 20, 30, 60];

function stream(random: () => number, n: number): DetectorSample[] {
  const out: DetectorSample[] = [];
  let t = 0;
  let level = 0;
  for (let i = 0; i < n; i++) {
    if (random() < 0.15) level = LEVELS[Math.floor(random() * LEVELS.length)] ?? 0;
    t += random() < 0.02 ? 300 + random() * 500 : 1000 / (FPS[Math.floor(random() * FPS.length)] ?? 30);
    out.push({ t, ratio: level, global: random() < 0.03, gapReset: random() < 0.02 });
  }
  return out;
}

it('TS detector matches the PoC on random streams', () => {
  const seen = new Map<string, number>();
  for (let seed = 1; seed <= 40; seed++) {
    const random = mulberry32(seed);
    const cfg: DetectorSettings = {
      ...DEFAULTS.detection,
      warmupMs: Math.floor(random() * 1000),
      minMotionMs: Math.floor(random() * 80),
      endHoldMs: Math.floor(random() * 150),
      cooldownMs: 200 + Math.floor(random() * 2000),
      maxMotionMs: 500 + Math.floor(random() * 3000),
    };
    const poc = createPocDetector({ ...cfg });
    const ts = createDetector({ ...cfg });
    for (const [i, s] of stream(random, 3000).entries()) {
      if (i % 997 === 996) {
        poc.reset(s.t);
        ts.reset(s.t);
      }
      const events = [...ts.update(s)];
      expect(events, `seed ${seed} sample ${i}`).toEqual(poc.update(s));
      for (const e of events) seen.set(e.type, (seen.get(e.type) ?? 0) + 1);
      expect(ts.state).toBe(poc.state);
    }
  }
  // every event type is exercised
  for (const type of ['MOTION_START', 'MOTION_END', 'SUPPRESSED', 'REJECTED'])
    expect(seen.get(type), type).toBeGreaterThan(20);
});

it('golden fixtures replay to the same events through the PoC detector', () => {
  const fixtures = import.meta.glob<string>('../../test/fixtures/**/*.csv', {
    query: '?raw',
    import: 'default',
    eager: true,
  });
  for (const [path, csv] of Object.entries(fixtures)) {
    const rows = parseFramesCsv(csv);
    const poc = createPocDetector({ ...DEFAULTS.detection });
    const pocEvents = rows.flatMap((r) => poc.update(r));
    expect(replay(rows, DEFAULTS.detection).events, path).toEqual(pocEvents);
  }
});
