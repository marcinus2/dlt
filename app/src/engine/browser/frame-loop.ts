// Frame clock shared by CameraSource and FileSource (from the PoC `source.js`): one callback per
// video frame via requestVideoFrameCallback, rAF fallback that skips repeated frames.
// t = captureTime ?? now for cameras, mediaTime·1000 for files. A backwards jump (loop / seek)
// or markSeek() flags the next frame seeked + gapReset; the resetGapMs time gap is the engine's job.
import type { FrameMeta } from '../types.ts';

export interface FrameLoop {
  /** Idempotent. */
  start(): void;
  /** Cancels rVFC / rAF; no frame is emitted after it returns. */
  stop(): void;
  /** Flags the next frame as seeked (file `seeked` event). */
  markSeek(): void;
  readonly running: boolean;
}

type Handle = number;
interface Raf {
  request(cb: FrameRequestCallback): Handle;
  cancel(h: Handle): void;
}

const globalRaf: Raf = {
  request: (cb) => requestAnimationFrame(cb),
  cancel: (h) => cancelAnimationFrame(h),
};

/** `emit` gets one reused FrameMeta; copy what you keep. */
export function createFrameLoop(
  video: HTMLVideoElement,
  kind: 'camera' | 'file',
  emit: (f: FrameMeta) => void,
  raf: Raf = globalRaf,
): FrameLoop {
  const file = kind === 'file';
  const rvfc = typeof video.requestVideoFrameCallback === 'function';
  const meta: FrameMeta = {
    t: 0,
    dropped: 0,
    presented: null,
    gapReset: false,
    seeked: false,
    tSource: 'now',
  };
  let running = false;
  let handle: Handle | null = null;
  let lastT: number | null = null;
  let lastPresented: number | null = null;
  let lastTime = -1;
  let seekPending = false;

  function frame(now: number, m: VideoFrameCallbackMetadata | null) {
    const mediaTime = m ? m.mediaTime : video.currentTime;
    const capture = !file && m?.captureTime != null;
    const t = file ? mediaTime * 1000 : capture ? (m?.captureTime as number) : now;
    const seeked = seekPending || (lastT !== null && t < lastT);
    seekPending = false;
    let dropped = 0;
    const presented = m?.presentedFrames ?? null;
    if (presented !== null) {
      if (lastPresented !== null && !seeked) dropped = Math.max(0, presented - lastPresented - 1);
      lastPresented = presented;
    }
    lastT = t;
    meta.t = t;
    meta.dropped = dropped;
    meta.presented = presented;
    meta.gapReset = seeked;
    meta.seeked = seeked;
    meta.tSource = file ? 'mediaTime' : capture ? 'captureTime' : 'now';
    emit(meta);
  }

  const onVideoFrame: VideoFrameRequestCallback = (now, m) => {
    if (!running) return;
    frame(now, m);
    if (running) handle = video.requestVideoFrameCallback(onVideoFrame);
  };

  const onAnimationFrame: FrameRequestCallback = (now) => {
    if (!running) return;
    if (video.currentTime !== lastTime && video.readyState >= 2) {
      // same frame again -> skip
      lastTime = video.currentTime;
      frame(now, null);
    }
    if (running) handle = raf.request(onAnimationFrame);
  };

  return {
    start() {
      if (running) return;
      running = true;
      lastT = lastPresented = null;
      lastTime = -1;
      handle = rvfc ? video.requestVideoFrameCallback(onVideoFrame) : raf.request(onAnimationFrame);
    },
    stop() {
      running = false;
      if (handle !== null) {
        if (rvfc) video.cancelVideoFrameCallback(handle);
        else raf.cancel(handle);
      }
      handle = null;
    },
    markSeek() {
      seekPending = true;
    },
    get running() {
      return running;
    },
  };
}
