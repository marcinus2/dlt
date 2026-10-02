// FrameAnalyzer (plan 4.5), refactored from the PoC `createMotion`: ROI crop → luma → diff,
// plus the optional 80×60 global guard. The 2D context comes from an injected factory
// (DOM canvas now, OffscreenCanvas in a worker later). No per-frame allocation except
// getImageData, which has no read-into API.
import { type DiffOptions, diffLuma, toLuma } from '../motion-core.ts';
import type { DetectionSettings, FrameAnalyzer, Roi } from '../types.ts';

export const GUARD_W = 80;
export const GUARD_H = 60;

/** The part of CanvasRenderingContext2D / OffscreenCanvasRenderingContext2D the analyzer uses. */
export interface AnalyzerContext {
  readonly canvas: { width: number; height: number };
  drawImage(
    img: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  getImageData(sx: number, sy: number, sw: number, sh: number): { readonly data: Uint8ClampedArray };
}

/** New 2D context on a fresh w×h canvas. Context attributes are fixed at creation. */
export type ContextFactory = (w: number, h: number, willReadFrequently: boolean) => AnalyzerContext;

export const domContext: ContextFactory = (w, h, willReadFrequently) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently });
  if (!ctx) throw new Error('2D canvas unavailable');
  return ctx;
};

/** ms of the last frame per stage, overwritten in place (HUD). */
export interface AnalyzerTiming {
  roi: number;
  diff: number;
  guard: number;
}

export interface Analyzer extends FrameAnalyzer {
  readonly timing: Readonly<AnalyzerTiming>;
  /** Current processing size of the ROI (debug). */
  readonly size: { readonly width: number; readonly height: number };
}

export interface AnalyzerOptions {
  context?: ContextFactory;
  now?: () => number;
}

/**
 * process() returns one reused result object. `global` is true when the guard trips and when
 * there is no previous frame to diff against (first frame, reset(), frame size or ROI change).
 */
export function createFrameAnalyzer(opts: AnalyzerOptions = {}): Analyzer {
  const make = opts.context ?? domContext;
  const now = opts.now ?? (() => performance.now());
  const result = { ratio: 0, globalRatio: 0, global: true };
  const timing: AnalyzerTiming = { roi: 0, diff: 0, guard: 0 };
  const size = { width: 0, height: 0 };

  let ctx: AnalyzerContext | null = null;
  let gctx: AnalyzerContext | null = null;
  let hint: boolean | null = null;
  let cur = new Uint8Array(0);
  let prev = new Uint8Array(0);
  let meanPrev = 0;
  let hasPrev = false;
  // last crop: video size, source rect (px), processing size
  let kvw = 0;
  let kvh = 0;
  let ksx = -1;
  let ksy = -1;
  let ksw = 0;
  let ksh = 0;

  const gSize = GUARD_W * GUARD_H;
  let gCur = new Uint8Array(gSize);
  let gPrev = new Uint8Array(gSize);
  let gMeanPrev = 0;
  let gHasPrev = false;
  const exclude = new Uint8Array(gSize);
  let excluded = 0;
  const guardOpts: DiffOptions = { pixelDiffThreshold: 0, brightnessNormalize: false, exclude };

  function setGuardExclusion(roi: Roi) {
    excluded = 0;
    const x0 = Math.floor(roi.x * GUARD_W);
    const x1 = Math.ceil((roi.x + roi.width) * GUARD_W);
    const y0 = Math.floor(roi.y * GUARD_H);
    const y1 = Math.ceil((roi.y + roi.height) * GUARD_H);
    for (let y = 0; y < GUARD_H; y++) {
      for (let x = 0; x < GUARD_W; x++) {
        const inside = x >= x0 && x < x1 && y >= y0 && y < y1 ? 1 : 0;
        exclude[y * GUARD_W + x] = inside;
        excluded += inside;
      }
    }
  }

  function neutral() {
    result.ratio = 0;
    result.globalRatio = 0;
    result.global = true;
    return result;
  }

  function process(img: CanvasImageSource, vw: number, vh: number, s: DetectionSettings) {
    const t0 = now();
    if (hint !== s.readbackHint || !ctx || !gctx) {
      hint = s.readbackHint;
      ctx = make(1, 1, hint);
      gctx = make(GUARD_W, GUARD_H, hint);
      size.width = size.height = 0;
      hasPrev = gHasPrev = false;
    }
    if (vw <= 0 || vh <= 0) {
      hasPrev = gHasPrev = false;
      return neutral();
    }
    const { roi } = s;
    const sx = Math.min(vw - 1, Math.max(0, Math.round(roi.x * vw)));
    const sy = Math.min(vh - 1, Math.max(0, Math.round(roi.y * vh)));
    const sw = Math.max(1, Math.min(vw - sx, Math.round(roi.width * vw)));
    const sh = Math.max(1, Math.min(vh - sy, Math.round(roi.height * vh)));
    const scale = Math.min(1, s.processingMaxSize / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * scale));
    const h = Math.max(1, Math.round(sh * scale));

    if (vw !== kvw || vh !== kvh) gHasPrev = false; // the guard frame changed too
    if (vw !== kvw || vh !== kvh || sx !== ksx || sy !== ksy || sw !== ksw || sh !== ksh) {
      kvw = vw;
      kvh = vh;
      ksx = sx;
      ksy = sy;
      ksw = sw;
      ksh = sh;
      hasPrev = false;
      setGuardExclusion(roi);
    }
    if (w !== size.width || h !== size.height) {
      // buffers only change when the processing size does
      size.width = w;
      size.height = h;
      ctx.canvas.width = w;
      ctx.canvas.height = h;
      cur = new Uint8Array(w * h);
      prev = new Uint8Array(w * h);
      hasPrev = false;
    }

    // ROI crop at full resolution, scaled down to the processing size.
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    const meanCur = toLuma(ctx.getImageData(0, 0, w, h).data, cur);
    const t1 = now();
    const valid = hasPrev;
    result.ratio = valid ? diffLuma(cur, prev, meanCur, meanPrev, s) / (w * h) : 0;
    const t2 = now();
    [cur, prev] = [prev, cur]; // swap, don't copy
    meanPrev = meanCur;
    hasPrev = true;

    result.globalRatio = 0;
    result.global = !valid;
    if (!s.globalGuard)
      gHasPrev = false; // don't diff against a stale frame when re-enabled
    else {
      gctx.drawImage(img, 0, 0, vw, vh, 0, 0, GUARD_W, GUARD_H);
      const gMeanCur = toLuma(gctx.getImageData(0, 0, GUARD_W, GUARD_H).data, gCur);
      const denom = gSize - excluded;
      if (gHasPrev && denom > 0) {
        guardOpts.pixelDiffThreshold = s.pixelDiffThreshold;
        guardOpts.brightnessNormalize = s.brightnessNormalize;
        result.globalRatio = diffLuma(gCur, gPrev, gMeanCur, gMeanPrev, guardOpts) / denom;
        if (result.globalRatio > s.globalGuardRatio) result.global = true;
      }
      [gCur, gPrev] = [gPrev, gCur];
      gMeanPrev = gMeanCur;
      gHasPrev = true;
    }
    timing.roi = t1 - t0;
    timing.diff = t2 - t1;
    timing.guard = now() - t2;
    return result;
  }

  return {
    process,
    reset() {
      hasPrev = gHasPrev = false;
    },
    timing,
    size,
  };
}
