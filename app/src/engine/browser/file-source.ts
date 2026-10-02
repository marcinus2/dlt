// FileSource (plan 4.7): a looping video file as a FrameSource for replay and parity checks.
// t = mediaTime·1000 (not wall clock); a loop or seek flags the frame seeked + gapReset.
import type { CameraError, CameraInfo, FrameMeta, FrameSource, Unsubscribe } from '../types.ts';
import { createVideo } from './camera-source.ts';
import { createFrameLoop } from './frame-loop.ts';

export interface FileSource extends FrameSource {
  /** File for the next start(). */
  setFile(file: Blob | null): void;
}

export interface FileSourceOptions {
  video?: HTMLVideoElement;
  url?: { create(b: Blob): string; revoke(u: string): void };
}

export function createFileSource(opts: FileSourceOptions = {}): FileSource {
  const video = opts.video ?? createVideo();
  const url = opts.url ?? { create: (b) => URL.createObjectURL(b), revoke: (u) => URL.revokeObjectURL(u) };
  const frames = new Set<(f: FrameMeta) => void>();
  const ended = new Set<(e: CameraError) => void>();
  const loop = createFrameLoop(video, 'file', (f) => {
    for (const cb of frames) cb(f);
  });
  let file: Blob | null = null;
  let objectUrl: string | null = null;
  let gen = 0;

  const onSeeked = () => loop.markSeek();
  const onError = () => {
    release();
    const e: CameraError = { kind: 'unknown', message: 'Video file could not be played' };
    for (const cb of ended) cb(e);
  };

  function syncLoop() {
    if (objectUrl && frames.size > 0) loop.start();
    else loop.stop();
  }

  function release() {
    loop.stop();
    video.removeEventListener('seeked', onSeeked);
    video.removeEventListener('error', onError);
    if (objectUrl) {
      video.pause();
      video.removeAttribute('src');
      video.load();
      url.revoke(objectUrl);
    }
    objectUrl = null;
    video.loop = false;
  }

  return {
    video,
    setFile(f) {
      file = f;
    },
    async start(): Promise<CameraInfo> {
      release();
      const my = ++gen;
      if (!file) throw { kind: 'notFound', message: 'No video file chosen' } satisfies CameraError;
      objectUrl = url.create(file);
      video.srcObject = null;
      video.loop = true;
      video.src = objectUrl;
      video.addEventListener('seeked', onSeeked);
      video.addEventListener('error', onError);
      try {
        await video.play();
      } catch (err) {
        if (my === gen) release();
        throw {
          kind: 'unknown',
          message: err instanceof Error ? err.message : String(err),
        } satisfies CameraError;
      }
      if (my !== gen) throw { kind: 'unknown', message: 'superseded' } satisfies CameraError;
      syncLoop();
      return { width: video.videoWidth, height: video.videoHeight, fps: null };
    },
    stop() {
      gen++;
      release();
    },
    onFrame(cb): Unsubscribe {
      frames.add(cb);
      syncLoop();
      return () => {
        frames.delete(cb);
        syncLoop();
      };
    },
    onEnded(cb): Unsubscribe {
      ended.add(cb);
      return () => ended.delete(cb);
    },
  };
}
