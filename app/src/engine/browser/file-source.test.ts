import { describe, expect, it, vi } from 'vitest';
import type { FrameMeta } from '../types.ts';
import { createFileSource } from './file-source.ts';
import { fakeVideo } from './test/fake-video.ts';

function setup() {
  const video = fakeVideo();
  const url = { create: vi.fn(() => 'blob:clip'), revoke: vi.fn() };
  const source = createFileSource({ video: video as unknown as HTMLVideoElement, url });
  const frames: FrameMeta[] = [];
  source.onFrame((f) => frames.push({ ...f }));
  return { video, url, source, frames };
}

describe('FileSource', () => {
  it('plays the file looped from an object URL', async () => {
    const { video, url, source } = setup();
    source.setFile(new Blob(['x']));
    expect(await source.start()).toEqual({ width: 240, height: 480, fps: null });
    expect(video.src).toBe('blob:clip');
    expect(video.loop).toBe(true);
    expect(url.create).toHaveBeenCalledTimes(1);
  });

  it('no file -> notFound', async () => {
    await expect(setup().source.start()).rejects.toMatchObject({ kind: 'notFound' });
  });

  it('t = mediaTime·1000; a loop back to 0 is a seek', async () => {
    const { video, source, frames } = setup();
    source.setFile(new Blob(['x']));
    await source.start();
    video.frame(5, { mediaTime: 1.0, presentedFrames: 1 });
    video.frame(6, { mediaTime: 1.5, presentedFrames: 2 });
    video.frame(7, { mediaTime: 0.0, presentedFrames: 3 }); // loop
    video.frame(8, { mediaTime: 0.1, presentedFrames: 4 });
    expect(frames.map((f) => [f.t, f.seeked, f.gapReset, f.tSource])).toEqual([
      [1000, false, false, 'mediaTime'],
      [1500, false, false, 'mediaTime'],
      [0, true, true, 'mediaTime'],
      [100, false, false, 'mediaTime'],
    ]);
  });

  it('a forward seek (seeked event) flags the next frame', async () => {
    const { video, source, frames } = setup();
    source.setFile(new Blob(['x']));
    await source.start();
    video.frame(1, { mediaTime: 1 });
    video.fire('seeked');
    video.frame(2, { mediaTime: 9 });
    expect(frames[1]).toMatchObject({ t: 9000, seeked: true, gapReset: true });
  });

  it('stop() revokes the URL, clears src, stops frames', async () => {
    const { video, url, source, frames } = setup();
    source.setFile(new Blob(['x']));
    await source.start();
    source.stop();
    expect(url.revoke).toHaveBeenCalledWith('blob:clip');
    expect(video.src).toBe('');
    expect(video.pending()).toBe(0);
    video.lastCallback?.(1, { mediaTime: 1, presentedFrames: 1 } as VideoFrameCallbackMetadata);
    expect(frames).toHaveLength(0);
  });

  it('a playback error ends the source', async () => {
    const { video, source } = setup();
    const ended = vi.fn();
    source.onEnded(ended);
    source.setFile(new Blob(['x']));
    await source.start();
    video.fire('error');
    expect(ended).toHaveBeenCalledWith(expect.objectContaining({ kind: 'unknown' }));
    expect(video.pending()).toBe(0);
  });

  it('play() rejected -> start rejects and releases', async () => {
    const { video, url, source } = setup();
    video.play = () => Promise.reject(new Error('unsupported format'));
    source.setFile(new Blob(['x']));
    await expect(source.start()).rejects.toMatchObject({ kind: 'unknown', message: 'unsupported format' });
    expect(url.revoke).toHaveBeenCalled();
  });
});
