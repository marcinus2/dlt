import { describe, expect, it } from 'vitest';
import { applyPass, formatLap, hasData, newSession, speechText, stop } from './laps.ts';
import type { SessionData } from './types.ts';

function passes(s: SessionData, ...ts: number[]): SessionData {
  return ts.reduce((acc, t) => applyPass(acc, t).session, s);
}

describe('applyPass', () => {
  it('first pass starts the reference without a lap and says go', () => {
    const { session, cue } = applyPass(newSession(), 1000);
    expect(cue).toBe('go');
    expect(session.laps).toEqual([]);
    expect(session.timing).toEqual({ kind: 'running', refT: 1000 });
  });

  it('later passes record laps from the previous pass', () => {
    const s = passes(newSession(), 1000, 13340, 25000);
    expect(s.laps).toEqual([
      { n: 1, ms: 12340, at: 13340 },
      { n: 2, ms: 11660, at: 25000 },
    ]);
    expect(s.timing).toEqual({ kind: 'running', refT: 25000 });
  });

  it('marks the first lap and every faster lap as best', () => {
    let s = passes(newSession(), 0);
    let r = applyPass(s, 12000);
    expect(r.cue).toBe('best');
    s = r.session;
    r = applyPass(s, 25000); // 13 s
    expect(r.cue).toBe('lap');
    expect(r.session.bestIdx).toBe(0);
    r = applyPass(r.session, 36000); // 11 s
    expect(r.cue).toBe('best');
    expect(r.session.bestIdx).toBe(2);
  });

  it('ties keep the earlier lap as best', () => {
    const r = applyPass(passes(newSession(), 0, 10000), 20000);
    expect(r.cue).toBe('lap');
    expect(r.session.bestIdx).toBe(0);
  });

  it('does not mutate the input', () => {
    const s = passes(newSession(), 0, 10000);
    const before = structuredClone(s);
    applyPass(s, 20000);
    expect(s).toEqual(before);
  });
});

describe('stop / continue boundary', () => {
  it('drops the in-progress lap and keeps laps', () => {
    const s = stop(passes(newSession(), 0, 10000));
    expect(s.timing).toEqual({ kind: 'standby' });
    expect(s.laps).toHaveLength(1);
  });

  it('no lap spans a pause: the first pass after it only sets the reference', () => {
    const paused = stop(passes(newSession(), 0, 10000, 15000)); // 2 laps, lap 3 dropped
    const first = applyPass(paused, 100000);
    expect(first.cue).toBe('go');
    expect(first.session.laps).toHaveLength(2);
    const second = applyPass(first.session, 112000);
    expect(second.session.laps.at(-1)).toEqual({ n: 3, ms: 12000, at: 112000 });
  });

  it('stop in standby is a no-op', () => {
    const s = newSession();
    expect(stop(s)).toBe(s);
  });
});

describe('hasData', () => {
  it('is true with laps or running timing', () => {
    expect(hasData(null)).toBe(false);
    expect(hasData(newSession())).toBe(false);
    expect(hasData(passes(newSession(), 0))).toBe(true);
    expect(hasData(stop(passes(newSession(), 0, 5000)))).toBe(true);
    expect(hasData(stop(passes(newSession(), 0)))).toBe(false);
  });
});

describe('formatLap', () => {
  it.each([
    [0, '0.00'],
    [1234, '1.23'],
    [12340, '12.34'],
    [12345, '12.35'],
    [12344.9, '12.34'],
    [59990, '59.99'],
    [59994, '59.99'],
    [59995, '1:00.00'],
    [60000, '1:00.00'],
    [65340, '1:05.34'],
    [125004, '2:05.00'],
    [3600000, '60:00.00'],
  ])('%d ms → %s', (ms, text) => {
    expect(formatLap(ms)).toBe(text);
  });
});

describe('speechText', () => {
  it.each([
    ['go', undefined, 'Go'],
    ['paused', undefined, 'Paused'],
    ['armed', undefined, ''],
    ['lap', 12340, '12.34'],
    ['best', 12340, 'Best, 12.34'],
    ['lap', 65340, '1 minute 5.34'],
    ['best', 59995, 'Best, 1 minute 0.00'],
    ['lap', 125000, '2 minutes 5.00'],
    ['lap', undefined, ''],
    ['best', undefined, ''],
  ] as const)('%s %s → %s', (cue, ms, text) => {
    expect(speechText(cue, ms)).toBe(text);
  });
});
