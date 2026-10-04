import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULTS } from '../../settings/schema.ts';
import { type FakeContext, type FakeImage, fakeContexts, rect, solid } from '../test/fake-canvas.ts';
import type { DetectionSettings } from '../types.ts';
import { type Analyzer, createFrameAnalyzer, GUARD_H, GUARD_W } from './frame-analyzer.ts';

const W = 240;
const H = 480;
const base: DetectionSettings = { ...DEFAULTS.detection, roi: { x: 0, y: 0, width: 1, height: 1 } };

describe('FrameAnalyzer', () => {
  let analyzer: Analyzer;
  let created: FakeContext[];
  let s: DetectionSettings;
  const run = (img: FakeImage, settings = s) => ({
    ...analyzer.process(img as unknown as CanvasImageSource, img.width, img.height, settings),
  });

  beforeEach(() => {
    const fake = fakeContexts();
    created = fake.created;
    analyzer = createFrameAnalyzer({ context: fake.factory });
    s = { ...base, roi: { ...base.roi } };
  });

  it('first frame is neutral; an identical frame diffs to 0', () => {
    expect(run(solid(W, H, 100))).toEqual({ ratio: 0, globalRatio: 0, global: true });
    expect(run(solid(W, H, 100))).toEqual({ ratio: 0, globalRatio: 0, global: false });
  });

  it('a changed frame gives the changed fraction', () => {
    run(solid(W, H, 100));
    expect(run(rect(W, H, { x: 0, y: 0, w: W, h: H / 4 }, 200, 100)).ratio).toBeCloseTo(0.25, 2);
  });

  it('returns one reused result object', () => {
    const img = solid(W, H, 100) as unknown as CanvasImageSource;
    expect(analyzer.process(img, W, H, s)).toBe(analyzer.process(img, W, H, s));
  });

  it('crops the ROI and scales to processingMaxSize', () => {
    run(solid(W, H, 100), { ...s, roi: { x: 0.5, y: 0, width: 0.5, height: 1 }, processingMaxSize: 320 });
    expect(created[0]?.draws.at(-1)).toEqual({ sx: 120, sy: 0, sw: 120, sh: 480, dw: 80, dh: 320 });
    expect(analyzer.size).toEqual({ width: 80, height: 320 });
  });

  it('frame size change -> the next frame is neutral', () => {
    run(solid(W, H, 100));
    run(solid(W, H, 100));
    expect(run(solid(H, W, 100)).global).toBe(true); // rotated
    expect(run(solid(H, W, 180)).global).toBe(false);
  });

  it('ROI change -> the next frame is neutral, even at the same processing size', () => {
    run(solid(W, H, 100));
    s.roi = { x: 0.5, y: 0, width: 0.5, height: 1 };
    expect(run(solid(W, H, 100)).global).toBe(true);
    s.roi = { x: 0, y: 0, width: 0.5, height: 1 }; // same size, other half
    expect(run(solid(W, H, 100)).global).toBe(true);
    expect(run(solid(W, H, 100)).global).toBe(false);
  });

  it('luma(): latest and previous frame of the crop, valid once a pair exists', () => {
    expect(analyzer.luma().valid).toBe(false);
    run(solid(W, H, 100));
    expect(analyzer.luma().valid).toBe(false);
    run(solid(W, H, 180));
    const p = analyzer.luma();
    expect(p).toMatchObject({ width: 160, height: 320, valid: true });
    expect(p.latest[0]).toBe(180);
    expect(p.previous[0]).toBe(100);
    analyzer.reset();
    expect(analyzer.luma().valid).toBe(false);
  });

  it('reset() -> the next frame is neutral', () => {
    run(solid(W, H, 100));
    analyzer.reset();
    expect(run(solid(W, H, 200))).toMatchObject({ ratio: 0, global: true });
  });

  it('no video size yet -> neutral, nothing drawn', () => {
    expect(run(solid(0, 0, 100)).global).toBe(true);
    expect(created[0]?.draws).toHaveLength(0);
  });

  it('readbackHint change recreates the contexts with the new attribute and resets', () => {
    run(solid(W, H, 100));
    expect(created.map((c) => c.willReadFrequently)).toEqual([true, true]);
    s.readbackHint = false;
    expect(run(solid(W, H, 100)).global).toBe(true);
    expect(created.map((c) => c.willReadFrequently)).toEqual([true, true, false, false]);
  });

  describe('global guard', () => {
    const roi = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
    beforeEach(() => {
      s = { ...s, globalGuard: true, globalGuardRatio: 0.2, roi };
    });

    it('change outside the ROI flags the frame', () => {
      run(solid(W, H, 100));
      const r = run(rect(W, H, { x: 0, y: 0, w: W, h: H / 4 }, 200, 100)); // top quarter, outside the ROI
      expect(r.ratio).toBe(0);
      expect(r.globalRatio).toBeGreaterThan(0.2);
      expect(r.global).toBe(true);
    });

    it('change inside the ROI is excluded from the guard', () => {
      run(solid(W, H, 100));
      const r = run(rect(W, H, { x: W / 4, y: H / 4, w: W / 2, h: H / 2 }, 200, 100));
      expect(r.ratio).toBe(1);
      expect(r.globalRatio).toBe(0);
      expect(r.global).toBe(false);
    });

    it('draws the full frame at 80×60, and nothing when off', () => {
      run(solid(W, H, 100));
      expect(created[1]?.draws.at(-1)).toEqual({ sx: 0, sy: 0, sw: W, sh: H, dw: GUARD_W, dh: GUARD_H });
      s.globalGuard = false;
      const n = created[1]?.draws.length;
      run(solid(W, H, 100));
      expect(created[1]?.draws.length).toBe(n);
    });

    it('re-enabled guard does not diff against a stale frame', () => {
      run(solid(W, H, 100));
      s.globalGuard = false;
      run(solid(W, H, 100));
      s.globalGuard = true;
      expect(run(solid(W, H, 250)).globalRatio).toBe(0); // no previous guard frame
    });
  });
});
