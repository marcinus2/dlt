import { describe, expect, it } from 'vitest';
import { ROI_PRESETS } from '../settings/schema.ts';
import { cropRect, processedRoi } from './roi.ts';

describe('cropRect', () => {
  it('maps every preset to frame pixels', () => {
    expect(cropRect(ROI_PRESETS.full, 240, 480)).toEqual({ sx: 0, sy: 0, sw: 240, sh: 480 });
    expect(cropRect(ROI_PRESETS.box, 240, 480)).toEqual({ sx: 48, sy: 120, sw: 144, sh: 240 });
    expect(cropRect(ROI_PRESETS.vLine, 240, 480)).toEqual({ sx: 102, sy: 48, sw: 36, sh: 384 });
    expect(cropRect(ROI_PRESETS.hLine, 240, 480)).toEqual({ sx: 24, sy: 204, sw: 192, sh: 72 });
  });

  it('stays inside the frame and at least 1×1; writes into out', () => {
    const out = { sx: 0, sy: 0, sw: 0, sh: 0 };
    expect(cropRect({ x: 1, y: 1, width: 0, height: 0 }, 10, 10, out)).toBe(out);
    expect(out).toEqual({ sx: 9, sy: 9, sw: 1, sh: 1 });
  });
});

describe('processedRoi', () => {
  it('is the crop as fractions: rounding to pixels shows on small frames', () => {
    expect(processedRoi(ROI_PRESETS.vLine, 240, 480)).toEqual({ x: 0.425, y: 0.1, width: 0.15, height: 0.8 });
    const r = processedRoi({ x: 0.333, y: 0, width: 0.333, height: 1 }, 10, 10);
    expect(r).toEqual({ x: 0.3, y: 0, width: 0.3, height: 1 });
  });
});
