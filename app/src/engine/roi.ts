// ROI → source crop in frame pixels. Pure; shared by the analyzer and the preview overlay so the
// overlay shows exactly the processed area (plan 7.3).
import type { Roi } from './types.ts';

export interface Crop {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** Writes into `out` (frame loop: no allocation). At least 1×1 and inside the frame. */
export function cropRect(roi: Roi, vw: number, vh: number, out: Crop = { sx: 0, sy: 0, sw: 1, sh: 1 }): Crop {
  out.sx = Math.min(vw - 1, Math.max(0, Math.round(roi.x * vw)));
  out.sy = Math.min(vh - 1, Math.max(0, Math.round(roi.y * vh)));
  out.sw = Math.max(1, Math.min(vw - out.sx, Math.round(roi.width * vw)));
  out.sh = Math.max(1, Math.min(vh - out.sy, Math.round(roi.height * vh)));
  return out;
}

/** The processed area as fractions of the frame (overlay position). */
export function processedRoi(roi: Roi, vw: number, vh: number): Roi {
  const c = cropRect(roi, vw, vh);
  return { x: c.sx / vw, y: c.sy / vh, width: c.sw / vw, height: c.sh / vh };
}
