// Synthetic frames through motion-core + detector (plan 4.4): exactly N passes at every fps.
import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../settings/schema.ts';
import { createDetector } from './detector.ts';
import { type DiffOptions, diffLuma } from './motion-core.ts';
import { type ClipOptions, syntheticClip } from './test/synthetic.ts';
import type { DetectorEvent } from './types.ts';

const detection = DEFAULTS.detection;

/** Runs a clip through diff + detector at default settings; returns all events. */
function pipeline(o: ClipOptions): DetectorEvent[] {
  const clip = syntheticClip(o);
  const n = clip.width * clip.height;
  let cur = new Uint8Array(n);
  let prev = new Uint8Array(n);
  const det = createDetector(detection);
  const opts: DiffOptions = detection;
  const events: DetectorEvent[] = [];
  for (let i = 0; i < clip.frameCount; i++) {
    clip.render(i, cur);
    const first = i === 0;
    const ratio = first ? 0 : diffLuma(cur, prev, 0, 0, opts) / n;
    events.push(...det.update({ t: clip.t(i), ratio, global: first, gapReset: false }));
    [cur, prev] = [prev, cur];
  }
  return events;
}

const PASS_AT = [2000, 6000, 10000, 14000, 18000];

describe('synthetic pipeline', () => {
  for (const fps of [10, 20, 30, 60]) {
    it(`${PASS_AT.length} passes at ${fps} fps, lap gaps exact to one frame`, () => {
      const events = pipeline({ fps, durationMs: 21000, passAt: PASS_AT });
      expect(events.map((e) => e.type)).toEqual(PASS_AT.flatMap(() => ['MOTION_START', 'MOTION_END']));
      const starts = events.filter((e) => e.type === 'MOTION_START').map((e) => e.t);
      for (const [k, at] of PASS_AT.entries()) {
        // Detected while the blob is in the frame (latency: the entering edge must reach startRatio).
        const d = (starts[k] as number) - at;
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(150);
        if (k > 0)
          expect(Math.abs(d - ((starts[0] as number) - (PASS_AT[0] as number)))).toBeLessThanOrEqual(
            1000 / fps,
          );
      }
    });
  }

  it('static noisy background -> no events', () => {
    expect(pipeline({ fps: 30, durationMs: 10000, passAt: [] })).toEqual([]);
  });

  it('passes closer than the cooldown -> SUPPRESSED, not a pass', () => {
    const events = pipeline({ fps: 30, durationMs: 6000, passAt: [2000, 2800] });
    expect(events.map((e) => e.type)).toEqual(['MOTION_START', 'MOTION_END', 'SUPPRESSED']);
  });
});
