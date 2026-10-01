// --- pure core (no DOM, caller-allocated buffers) ---

// RGBA -> luma into `out` (length = pixel count). Returns the mean luma.
export function toLuma(rgba, out) {
  const n = out.length;
  let sum = 0;
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const y = (77 * rgba[j] + 150 * rgba[j + 1] + 29 * rgba[j + 2]) >> 8;
    out[i] = y;
    sum += y;
  }
  return sum / n;
}

// Counts pixels where |curr - prev - offset| > pixelDiffThreshold, offset = mean shift when normalising.
// opts.exclude: Uint8Array, non-zero = pixel ignored (not counted).
// mask: optional Uint32Array over RGBA pixels (e.g. an ImageData buffer), changed = white, else black.
export function diffLuma(curr, prev, meanCurr, meanPrev, opts, mask) {
  const { pixelDiffThreshold, brightnessNormalize, exclude } = opts;
  const offset = brightnessNormalize ? meanCurr - meanPrev : 0;
  const n = curr.length;
  let changed = 0;
  for (let i = 0; i < n; i++) {
    let hit = false;
    if (!exclude || !exclude[i]) {
      const d = curr[i] - prev[i] - offset;
      hit = (d < 0 ? -d : d) > pixelDiffThreshold;
      if (hit) changed++;
    }
    if (mask) mask[i] = hit ? 0xffffffff : 0xff000000;
  }
  return changed;
}

// --- canvas glue ---

const GUARD_W = 80, GUARD_H = 60;

// process(video, roi) -> { ratio, globalRatio, global }. roi is relative 0–1.
// Frames with no previous frame to diff against (first / after reset() / ROI change) come back
// global: true, i.e. neutral for the detector. The global guard is off unless opts.globalGuard.
export function createMotion(config, { globalGuard = false } = {}) {
  const ctx = makeCtx(1, 1), gctx = makeCtx(GUARD_W, GUARD_H);
  const diffCanvas = document.createElement('canvas');
  const dctx = diffCanvas.getContext('2d');
  let cur = null, prev = null, meanCur = 0, meanPrev = 0, hasPrev = false;
  let pw = 0, ph = 0, mask = null, diffImage = null;
  let roiKey = '';
  const gSize = GUARD_W * GUARD_H;
  let gCur = new Uint8Array(gSize), gPrev = new Uint8Array(gSize);
  let gMeanCur = 0, gMeanPrev = 0, gHasPrev = false;
  const exclude = new Uint8Array(gSize);
  let excluded = 0;

  function makeCtx(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c.getContext('2d', { willReadFrequently: true });
  }

  function reset() { hasPrev = false; gHasPrev = false; }

  function setGuardExclusion(roi) {
    excluded = 0;
    const x0 = Math.floor(roi.x * GUARD_W), x1 = Math.ceil((roi.x + roi.width) * GUARD_W);
    const y0 = Math.floor(roi.y * GUARD_H), y1 = Math.ceil((roi.y + roi.height) * GUARD_H);
    for (let y = 0; y < GUARD_H; y++) {
      for (let x = 0; x < GUARD_W; x++) {
        const inside = x >= x0 && x < x1 && y >= y0 && y < y1 ? 1 : 0;
        exclude[y * GUARD_W + x] = inside;
        excluded += inside;
      }
    }
  }

  function process(video, roi) {
    const vw = video.videoWidth, vh = video.videoHeight;
    const sx = Math.min(vw - 1, Math.max(0, Math.round(roi.x * vw)));
    const sy = Math.min(vh - 1, Math.max(0, Math.round(roi.y * vh)));
    const sw = Math.max(1, Math.min(vw - sx, Math.round(roi.width * vw)));
    const sh = Math.max(1, Math.min(vh - sy, Math.round(roi.height * vh)));
    const scale = Math.min(1, config.processingMaxSize / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));

    const key = `${sx},${sy},${sw},${sh},${w},${h}`;
    if (key !== roiKey) {
      roiKey = key;
      hasPrev = false;
      setGuardExclusion(roi);
    }
    if (w !== pw || h !== ph) {          // buffers only change when the processing size does
      pw = w; ph = h;
      ctx.canvas.width = diffCanvas.width = w;
      ctx.canvas.height = diffCanvas.height = h;
      cur = new Uint8Array(w * h);
      prev = new Uint8Array(w * h);
      diffImage = dctx.createImageData(w, h);
      mask = new Uint32Array(diffImage.data.buffer);
    }

    // ROI crop at full resolution. getImageData itself allocates; there is no read-into API.
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
    meanCur = toLuma(ctx.getImageData(0, 0, w, h).data, cur);
    let ratio = 0;
    const valid = hasPrev;
    if (hasPrev) {
      ratio = diffLuma(cur, prev, meanCur, meanPrev, config, mask) / (w * h);
      dctx.putImageData(diffImage, 0, 0);
    }
    [cur, prev] = [prev, cur];           // swap, don't copy
    meanPrev = meanCur;
    hasPrev = true;

    let globalRatio = 0, global = !valid;
    if (globalGuard) {
      gctx.drawImage(video, 0, 0, vw, vh, 0, 0, GUARD_W, GUARD_H);
      gMeanCur = toLuma(gctx.getImageData(0, 0, GUARD_W, GUARD_H).data, gCur);
      const denom = gSize - excluded;
      if (gHasPrev && denom > 0) {
        const opts = { pixelDiffThreshold: config.pixelDiffThreshold, brightnessNormalize: config.brightnessNormalize, exclude };
        globalRatio = diffLuma(gCur, gPrev, gMeanCur, gMeanPrev, opts) / denom;
        if (globalRatio > config.globalGuardRatio) global = true;
      }
      [gCur, gPrev] = [gPrev, gCur];
      gMeanPrev = gMeanCur;
      gHasPrev = true;
    }
    return { ratio, globalRatio, global };
  }

  return { process, reset, diffCanvas };
}
