// Golden replays (plan 4.9): every fixture CSV through detector + lap logic at default settings.
import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../settings/schema.ts';
import { createRecorder } from './recorder.ts';
import { parseFramesCsv, replay } from './replay.ts';

const fixtures = import.meta.glob<string>('../../test/fixtures/**/*.csv', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const name = (path: string) => path.replace('../../test/fixtures/', '');

/** Expected accepted passes per fixture (README). */
const EXPECTED: Record<string, number> = {
  'synthetic/laps-30fps.csv': 6,
};

describe('golden replays', () => {
  it('every fixture has an expected pass count', () => {
    expect(Object.keys(fixtures).map(name).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const [path, csv] of Object.entries(fixtures)) {
    it(name(path), () => {
      const r = replay(parseFramesCsv(csv), DEFAULTS.detection);
      expect(r.passes).toHaveLength(EXPECTED[name(path)] as number);
      const round = (v: number) => Math.round(v * 1000) / 1000;
      expect({
        events: r.events.map((e) => `${e.type}@${round(e.t)}`),
        laps: r.laps.map((l) => ({ n: l.n, ms: round(l.ms) })),
        bestIdx: r.bestIdx,
      }).toMatchSnapshot();
    });
  }

  it('synthetic: suppressed and rejected passes are not laps', () => {
    const csv = fixtures['../../test/fixtures/synthetic/laps-30fps.csv'] as string;
    const types = replay(parseFramesCsv(csv), DEFAULTS.detection).events.map((e) => e.type);
    expect(types.filter((t) => t === 'SUPPRESSED')).toHaveLength(1);
    expect(types.filter((t) => t === 'REJECTED')).toHaveLength(1);
  });
});

describe('replay', () => {
  const rows = (spec: [number, number, 0 | 1, string?][]) =>
    spec.map(([t, ratio, global, state = 'IDLE']) => ({
      t,
      ratio,
      globalRatio: 0,
      global: global === 1,
      state,
    }));
  const s = { ...DEFAULTS.detection, warmupMs: 0, cooldownMs: 500 };
  const pass = (t0: number): [number, number, 0 | 1][] =>
    [0, 100, 200, 300, 400, 500].map((d, i) => [t0 + d, i < 3 ? 0.05 : 0, 0]);

  it('first pass starts timing, later passes are laps with the best marked', () => {
    const r = replay(rows([...pass(0), ...pass(5000), ...pass(9000)]), s);
    expect(r.laps).toEqual([
      { n: 1, ms: 5000, at: 5000 },
      { n: 2, ms: 4000, at: 9000 },
    ]);
    expect(r.bestIdx).toBe(1);
  });

  it('skips calibration rows', () => {
    const calib: [number, number, 0 | 1, string][] = pass(0).map(([t, r, g]) => [t, r, g, 'CALIB']);
    expect(replay(rows([...calib, ...pass(5000)]), s).passes).toHaveLength(1);
  });

  it('a backwards time jump (file loop) resets the detector', () => {
    const r = replay(rows([...pass(40000), ...pass(0)]), { ...s, cooldownMs: 100000 });
    expect(r.passes).toHaveLength(2); // the reset clears the cooldown
  });

  it('round-trips the recorder CSV', () => {
    const rec = createRecorder(4);
    rec.addFrame(0, 0, 0, true, 'WARMUP');
    rec.addFrame(33.333, 0.0123, 0.4, false, 'IDLE');
    expect(parseFramesCsv(rec.framesCsv())).toEqual([
      { t: 0, ratio: 0, globalRatio: 0, global: true, state: 'WARMUP' },
      { t: 33.333, ratio: 0.0123, globalRatio: 0.4, global: false, state: 'IDLE' },
    ]);
  });

  it('missing column -> error', () => {
    expect(() => parseFramesCsv('t,ratio\n1,0\n')).toThrow(/globalRatio/);
  });
});
