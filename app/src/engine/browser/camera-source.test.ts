import { describe, expect, it, vi } from 'vitest';
import { DEFAULTS } from '../../settings/schema.ts';
import type { CameraSettings, FrameMeta } from '../types.ts';
import {
  type CameraSource,
  constraintsFor,
  createCameraSource,
  type MediaDevicesLike,
} from './camera-source.ts';
import { type FakeVideo, fakeMediaDevices, fakeTrack, fakeVideo } from './test/fake-video.ts';

const cam: CameraSettings = { ...DEFAULTS.camera, exposureManual: false };

function setup(
  script: Parameters<typeof fakeMediaDevices>[0],
  s: Partial<CameraSettings> = {},
  secure = true,
) {
  const md = fakeMediaDevices(script);
  const video = fakeVideo();
  const source = createCameraSource({
    video: video as unknown as HTMLVideoElement,
    mediaDevices: md as unknown as MediaDevicesLike,
    secure: () => secure,
  });
  source.configure({ ...cam, ...s });
  return { md, video, source };
}

const videoOf = (c: MediaStreamConstraints) => c.video as MediaTrackConstraints;

describe('constraintsFor', () => {
  it('follows spec §2.1', () => {
    expect(
      constraintsFor(
        { ...cam, deviceId: 'abc', fpsExact: true },
        { device: true, facing: true, fpsExact: true },
      ),
    ).toEqual({
      audio: false,
      video: {
        deviceId: { exact: 'abc' },
        facingMode: { ideal: 'user' },
        width: { ideal: 240 },
        height: { ideal: 480 },
        frameRate: { exact: 30 },
      },
    });
    const any = videoOf(constraintsFor(cam, { device: false, facing: false, fpsExact: false }));
    expect(any).toEqual({ width: { ideal: 240 }, height: { ideal: 480 }, frameRate: { ideal: 30 } });
  });
});

describe('CameraSource start', () => {
  it('returns what the track reports', async () => {
    const { source } = setup([
      fakeTrack({ width: 480, height: 640, frameRate: 24, facingMode: 'environment' }),
    ]);
    expect(await source.start()).toEqual({
      width: 480,
      height: 640,
      fps: 24,
      facing: 'environment',
      deviceId: 'cam-1',
      fpsFallback: false,
      deviceFallback: false,
      exposure: { supported: false },
      focus: { supported: false },
    });
  });

  it('saved deviceId missing -> retries with facingMode, reported as deviceFallback', async () => {
    const { md, source } = setup([{ name: 'OverconstrainedError', constraint: 'deviceId' }, fakeTrack()], {
      deviceId: 'gone',
    });
    expect((await source.start()).deviceFallback).toBe(true);
    expect(videoOf(md.calls[0] as MediaStreamConstraints).deviceId).toEqual({ exact: 'gone' });
    expect(videoOf(md.calls[1] as MediaStreamConstraints).deviceId).toBeUndefined();
    expect(videoOf(md.calls[1] as MediaStreamConstraints).facingMode).toEqual({ ideal: 'user' });
  });

  it('NotFoundError for the facing camera -> any camera', async () => {
    const { md, source } = setup([{ name: 'NotFoundError' }, fakeTrack()], { deviceId: null });
    await source.start();
    expect(videoOf(md.calls[1] as MediaStreamConstraints).facingMode).toBeUndefined();
  });

  it('fpsExact not met -> ideal frame rate, reported as fpsFallback', async () => {
    const { md, source } = setup([{ name: 'OverconstrainedError', constraint: 'frameRate' }, fakeTrack()], {
      fpsExact: true,
    });
    expect((await source.start()).fpsFallback).toBe(true);
    expect(videoOf(md.calls[0] as MediaStreamConstraints).frameRate).toEqual({ exact: 30 });
    expect(videoOf(md.calls[1] as MediaStreamConstraints).frameRate).toEqual({ ideal: 30 });
  });

  it('chain: deviceId -> fps -> facing -> fail with the last error', async () => {
    const over = (constraint: string) => ({ name: 'OverconstrainedError', constraint });
    const { md, source } = setup([over('deviceId'), over('frameRate'), over('width'), over('width')], {
      deviceId: 'x',
      fpsExact: true,
    });
    await expect(source.start()).rejects.toMatchObject({ kind: 'overconstrained' });
    expect(md.calls).toHaveLength(4);
  });

  it.each([
    ['NotAllowedError', 'permission'],
    ['SecurityError', 'permission'],
    ['NotReadableError', 'busy'],
    ['AbortError', 'busy'],
    ['TypeError', 'unknown'],
  ])('%s -> %s, no retry', async (name, kind) => {
    const { md, source } = setup([{ name }]);
    await expect(source.start()).rejects.toMatchObject({ kind });
    expect(md.calls).toHaveLength(1);
  });

  it('insecure context -> insecure, getUserMedia not called', async () => {
    const { md, source } = setup([fakeTrack()], {}, false);
    await expect(source.start()).rejects.toMatchObject({ kind: 'insecure' });
    expect(md.calls).toHaveLength(0);
  });

  it('no mediaDevices -> notFound', async () => {
    const source = createCameraSource({
      video: fakeVideo() as unknown as HTMLVideoElement,
      mediaDevices: null,
      secure: () => true,
    });
    source.configure(cam);
    await expect(source.start()).rejects.toMatchObject({ kind: 'notFound' });
  });

  it('stop() while getUserMedia is pending -> the late stream is stopped, start rejects', async () => {
    const track = fakeTrack();
    const { md, source } = setup([track]);
    md.hold = true;
    const p = source.start();
    await Promise.resolve();
    source.stop();
    md.release();
    await expect(p).rejects.toMatchObject({ message: 'superseded' });
    expect(track.readyState).toBe('ended');
  });
});

describe('CameraSource frames and stop', () => {
  async function live(): Promise<{ video: FakeVideo; source: CameraSource; frames: FrameMeta[] }> {
    const { video, source } = setup([fakeTrack()]);
    await source.start();
    const frames: FrameMeta[] = [];
    source.onFrame((f) => frames.push({ ...f }));
    return { video, source, frames };
  }

  it('one frame per rVFC callback: captureTime, dropped from presentedFrames', async () => {
    const { video, frames } = await live();
    video.frame(1000, { captureTime: 990, presentedFrames: 10 });
    video.frame(1033, { captureTime: 1023, presentedFrames: 13 });
    video.frame(1066, { presentedFrames: 14 });
    expect(frames).toEqual([
      { t: 990, dropped: 0, presented: 10, gapReset: false, seeked: false, tSource: 'captureTime' },
      { t: 1023, dropped: 2, presented: 13, gapReset: false, seeked: false, tSource: 'captureTime' },
      { t: 1066, dropped: 0, presented: 14, gapReset: false, seeked: false, tSource: 'now' },
    ]);
  });

  it('a large frame gap is not a source reset (the engine applies resetGapMs)', async () => {
    const { video, frames } = await live();
    video.frame(1000);
    video.frame(5000);
    expect(frames[1]).toMatchObject({ gapReset: false, seeked: false });
  });

  it('stop(): tracks stopped, rVFC cancelled, no frames afterwards', async () => {
    const track = fakeTrack();
    const { video, source } = setup([track]);
    await source.start();
    const cb = vi.fn();
    source.onFrame(cb);
    expect(video.pending()).toBe(1);
    source.stop();
    expect(track.readyState).toBe('ended');
    expect(video.pending()).toBe(0);
    expect(video.srcObject).toBeNull();
    video.lastCallback?.(2000, { mediaTime: 0, presentedFrames: 1 } as VideoFrameCallbackMetadata); // late frame
    expect(cb).not.toHaveBeenCalled();
    expect(source.info()).toBeNull();
  });

  it('frames only run while someone listens', async () => {
    const { video, source } = setup([fakeTrack()]);
    await source.start();
    expect(video.pending()).toBe(0);
    const off = source.onFrame(() => {});
    expect(video.pending()).toBe(1);
    off();
    expect(video.pending()).toBe(0);
  });

  it('track ended -> onEnded(ended), loop stopped', async () => {
    const track = fakeTrack();
    const { video, source } = setup([track]);
    const ended = vi.fn();
    source.onEnded(ended);
    await source.start();
    source.onFrame(() => {});
    track.end();
    expect(ended).toHaveBeenCalledWith({ kind: 'ended', message: 'Camera track ended' });
    expect(video.pending()).toBe(0);
  });

  it('a listener may stop the source from inside a frame', async () => {
    const { video, source } = setup([fakeTrack()]);
    await source.start();
    const cb = vi.fn(() => source.stop());
    source.onFrame(cb);
    video.frame(1000);
    expect(video.pending()).toBe(0);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('rAF fallback without rVFC: skips repeated frames, t = now', async () => {
    const queue: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => queue.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    try {
      const video = fakeVideo({ rvfc: false });
      const source = createCameraSource({
        video: video as unknown as HTMLVideoElement,
        mediaDevices: fakeMediaDevices([fakeTrack()]) as unknown as MediaDevicesLike,
        secure: () => true,
      });
      source.configure(cam);
      await source.start();
      const frames: FrameMeta[] = [];
      source.onFrame((f) => frames.push({ ...f }));
      const tick = (now: number) => queue.shift()?.(now);
      video.currentTime = 0.033;
      tick(100);
      tick(116); // same currentTime -> skipped
      video.currentTime = 0.066;
      tick(133);
      expect(frames.map((f) => [f.t, f.tSource, f.presented])).toEqual([
        [100, 'now', null],
        [133, 'now', null],
      ]);
      source.stop();
      tick(150);
      expect(frames).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('CameraSource controls', () => {
  const exposureCaps = { exposureMode: ['manual', 'continuous'], exposureTime: { min: 10, max: 50 } };

  it('exposureManual applies a clamped manual exposure on start', async () => {
    const track = fakeTrack({}, exposureCaps);
    const { source } = setup([track], { exposureManual: true, exposureTime: 100 });
    await source.start();
    expect(track.applied).toEqual([{ advanced: [{ exposureMode: 'manual', exposureTime: 50 }] }]);
    expect(source.controls().exposure).toEqual({
      supported: true,
      mode: 'manual',
      value: 50,
      range: { min: 10, max: 50 },
    });
  });

  it('auto exposure is left alone on start; its capability and value are still reported', async () => {
    const track = fakeTrack({ exposureMode: 'continuous', exposureTime: 33 }, exposureCaps);
    const { source } = setup([track], { exposureManual: false });
    const info = await source.start();
    expect(track.applied).toEqual([]);
    const report = { supported: true, mode: 'continuous', value: 33, range: { min: 10, max: 50 } };
    expect(source.controls().exposure).toEqual(report);
    expect(info.exposure).toEqual(report);
    expect(info.focus).toEqual({ supported: false });
    source.stop();
    expect(source.controls()).toEqual({ exposure: null, focus: null });
  });

  it('reports the track label', async () => {
    const track = Object.assign(fakeTrack(), { label: 'camera2 1, facing back' });
    const { source } = setup([track]);
    expect((await source.start()).label).toBe('camera2 1, facing back');
  });

  it('unsupported and failing controls are reported, start still succeeds', async () => {
    const { source } = setup([fakeTrack()], { exposureManual: true, focusLock: true });
    await source.start();
    expect(source.controls()).toEqual({ exposure: { supported: false }, focus: { supported: false } });
    expect(source.info()?.exposure).toEqual({ supported: false });

    const track = fakeTrack({}, exposureCaps);
    track.applyError = new Error('nope');
    const b = setup([track], { exposureManual: true });
    await b.source.start();
    expect(b.source.controls().exposure).toMatchObject({ supported: true, error: 'nope' });
  });

  it('focusLock freezes the current focus distance, clamped', async () => {
    const track = fakeTrack(
      { focusDistance: 2 },
      { focusMode: ['manual', 'continuous'], focusDistance: { min: 0, max: 1 } },
    );
    const { source } = setup([track], { focusLock: true });
    await source.start();
    expect(track.applied).toEqual([{ advanced: [{ focusMode: 'manual', focusDistance: 1 }] }]);
  });

  it('apply without a running camera -> null', async () => {
    const { source } = setup([]);
    expect(await source.applyExposure()).toBeNull();
    expect(await source.applyFocus()).toBeNull();
  });
});

describe('CameraSource devices', () => {
  it('lists video inputs with a deviceId only and reports devicechange', async () => {
    const { md, source } = setup([]);
    expect(await source.listCameras()).toEqual([
      { deviceId: 'cam-1', label: 'Front' },
      { deviceId: 'cam-2', label: 'Back' },
    ]);
    const cb = vi.fn();
    const off = source.onDeviceChange(cb);
    md.fireDeviceChange();
    off();
    md.fireDeviceChange();
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
