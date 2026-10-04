// CameraSource (plan 4.6, spec §2.1), refactored from the PoC `source.js`: getUserMedia with the
// deviceId → facingMode → any-camera fallback chain, fpsExact → ideal retry, errors mapped to
// CameraError, rVFC frame loop, track `ended`, exposure/focus via applyConstraints.
import { toCameraError } from '../camera-error.ts';
import type {
  CameraDevice,
  CameraError,
  CameraInfo,
  CameraSettings,
  ControlReport,
  FrameMeta,
  FrameSource,
  Unsubscribe,
} from '../types.ts';
import { createFrameLoop } from './frame-loop.ts';

export type MediaDevicesLike = Pick<
  MediaDevices,
  'getUserMedia' | 'enumerateDevices' | 'addEventListener' | 'removeEventListener'
>;

export type { CameraDevice, ControlReport };

export interface CameraSource extends FrameSource {
  /** Settings for the next start(). */
  configure(s: CameraSettings): void;
  info(): CameraInfo | null;
  /** Reports of the running camera; null without one. */
  controls(): { exposure: ControlReport | null; focus: ControlReport | null };
  /** Re-apply after a settings change; null without a running camera. */
  applyExposure(): Promise<ControlReport | null>;
  applyFocus(): Promise<ControlReport | null>;
  listCameras(): Promise<CameraDevice[]>;
  onDeviceChange(cb: () => void): Unsubscribe;
}

export interface CameraSourceOptions {
  video?: HTMLVideoElement;
  mediaDevices?: MediaDevicesLike | null;
  secure?: () => boolean;
}

// Image Capture extensions (mostly Android Chrome), missing from lib.dom.
type Range = { min: number; max: number };
type Caps = MediaTrackCapabilities & {
  exposureMode?: string[];
  exposureTime?: Range;
  focusMode?: string[];
  focusDistance?: Range;
};
type TrackSettings = MediaTrackSettings & {
  exposureMode?: string;
  exposureTime?: number;
  focusMode?: string;
  focusDistance?: number;
};

export interface Attempt {
  device: boolean;
  facing: boolean;
  fpsExact: boolean;
}

/** getUserMedia constraints per spec §2.1 for one attempt of the fallback chain. */
export function constraintsFor(s: CameraSettings, a: Attempt): MediaStreamConstraints {
  return {
    audio: false,
    video: {
      ...(a.device && s.deviceId ? { deviceId: { exact: s.deviceId } } : {}),
      ...(a.facing ? { facingMode: { ideal: s.facing } } : {}),
      width: { ideal: s.width },
      height: { ideal: s.height },
      frameRate: a.fpsExact ? { exact: s.fps } : { ideal: s.fps },
    },
  };
}

/**
 * Fallback chain: saved deviceId (exact) → facingMode → any camera; fpsExact that can't be met →
 * `ideal` with fpsFallback. Other errors (permission, busy, …) are thrown as-is.
 */
export async function openStream(
  md: MediaDevicesLike,
  s: CameraSettings,
): Promise<{ stream: MediaStream; fpsFallback: boolean }> {
  const a: Attempt = { device: s.deviceId !== null, facing: true, fpsExact: s.fpsExact };
  let fpsFallback = false;
  for (;;) {
    try {
      return { stream: await md.getUserMedia(constraintsFor(s, a)), fpsFallback };
    } catch (err) {
      const { name, constraint } = (err ?? {}) as { name?: string; constraint?: string };
      const over = name === 'OverconstrainedError';
      const missing = over || name === 'NotFoundError';
      if (over && a.fpsExact && (constraint === 'frameRate' || !constraint)) {
        a.fpsExact = false;
        fpsFallback = true;
      } else if (missing && a.device) a.device = false;
      else if (missing && a.facing) a.facing = false;
      else throw err;
    }
  }
}

const clamp = (v: number, r?: Range) => (r ? Math.min(r.max, Math.max(r.min, v)) : v);
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

const CONTROL = {
  exposure: { mode: 'exposureMode', value: 'exposureTime' },
  focus: { mode: 'focusMode', value: 'focusDistance' },
} as const;

/** Capability and current value of a control, without changing it. */
export function readControl(track: MediaStreamTrack, kind: keyof typeof CONTROL): ControlReport {
  const k = CONTROL[kind];
  const caps: Caps = track.getCapabilities?.() ?? {};
  if (!caps[k.mode]) return { supported: false };
  const st: TrackSettings = track.getSettings();
  return { supported: true, mode: st[k.mode], value: st[k.value], range: caps[k.value] };
}

async function apply(
  track: MediaStreamTrack,
  kind: keyof typeof CONTROL,
  advanced: Record<string, unknown>,
): Promise<ControlReport> {
  try {
    await track.applyConstraints({ advanced: [advanced as MediaTrackConstraintSet] });
  } catch (err) {
    const caps: Caps = track.getCapabilities?.() ?? {};
    return { supported: true, range: caps[CONTROL[kind].value], error: message(err) };
  }
  return readControl(track, kind);
}

async function exposureReport(track: MediaStreamTrack, s: CameraSettings): Promise<ControlReport> {
  const caps: Caps = track.getCapabilities?.() ?? {};
  if (!caps.exposureMode) return { supported: false };
  return apply(
    track,
    'exposure',
    s.exposureManual
      ? { exposureMode: 'manual', exposureTime: clamp(s.exposureTime, caps.exposureTime) }
      : { exposureMode: 'continuous' },
  );
}

// Freeze autofocus where it settled (focusDistance read back from the track), or release it.
async function focusReport(track: MediaStreamTrack, s: CameraSettings): Promise<ControlReport> {
  const caps: Caps = track.getCapabilities?.() ?? {};
  if (!caps.focusMode) return { supported: false };
  const current = (track.getSettings() as TrackSettings).focusDistance;
  const advanced: Record<string, unknown> = { focusMode: s.focusLock ? 'manual' : 'continuous' };
  if (s.focusLock && current != null) advanced.focusDistance = clamp(current, caps.focusDistance);
  return apply(track, 'focus', advanced);
}

export function createCameraSource(opts: CameraSourceOptions = {}): CameraSource {
  const md =
    opts.mediaDevices === undefined ? (globalThis.navigator?.mediaDevices ?? null) : opts.mediaDevices;
  const secure = opts.secure ?? (() => globalThis.isSecureContext !== false);
  const video = opts.video ?? createVideo();
  const frames = new Set<(f: FrameMeta) => void>();
  const ended = new Set<(e: CameraError) => void>();
  const loop = createFrameLoop(video, 'camera', (f) => {
    for (const cb of frames) cb(f);
  });

  let settings: CameraSettings | null = null;
  let stream: MediaStream | null = null;
  let track: MediaStreamTrack | null = null;
  let info: CameraInfo | null = null;
  let exposure: ControlReport | null = null;
  let focus: ControlReport | null = null;
  let gen = 0;

  function syncLoop() {
    if (track && frames.size > 0) loop.start();
    else loop.stop();
  }

  function release() {
    loop.stop();
    track?.removeEventListener('ended', onTrackEnded);
    for (const t of stream?.getTracks() ?? []) t.stop();
    stream = track = null;
    info = exposure = focus = null;
    video.srcObject = null;
  }

  function onTrackEnded() {
    release();
    const e: CameraError = { kind: 'ended', message: 'Camera track ended' };
    for (const cb of ended) cb(e);
  }

  const superseded = (): CameraError => ({ kind: 'unknown', message: 'superseded' });

  async function applyExposure(): Promise<ControlReport | null> {
    if (!track || !settings) return null;
    exposure = await exposureReport(track, settings);
    return exposure;
  }

  async function applyFocus(): Promise<ControlReport | null> {
    if (!track || !settings) return null;
    focus = await focusReport(track, settings);
    return focus;
  }

  return {
    video,
    configure(s) {
      settings = s;
    },
    async start() {
      release();
      const my = ++gen;
      if (!secure())
        throw { kind: 'insecure', message: 'Camera needs a secure (HTTPS) page' } satisfies CameraError;
      if (!md?.getUserMedia)
        throw { kind: 'notFound', message: 'No camera API in this browser' } satisfies CameraError;
      const s = settings;
      if (!s) throw { kind: 'unknown', message: 'camera not configured' } satisfies CameraError;
      let opened: Awaited<ReturnType<typeof openStream>>;
      try {
        opened = await openStream(md, s);
      } catch (err) {
        throw toCameraError(err);
      }
      if (my !== gen) {
        for (const t of opened.stream.getTracks()) t.stop();
        throw superseded();
      }
      stream = opened.stream;
      track = stream.getVideoTracks()[0] ?? null;
      track?.addEventListener('ended', onTrackEnded);
      video.srcObject = stream;
      await video.play().catch(() => {}); // muted autoplay; a rejected play() only delays frames
      if (my !== gen) throw superseded();
      // Leave the camera's auto modes alone unless asked; report the capability either way.
      if (s.exposureManual) await applyExposure();
      if (s.focusLock) await applyFocus();
      if (my !== gen) throw superseded();
      if (track) {
        exposure ??= readControl(track, 'exposure');
        focus ??= readControl(track, 'focus');
      }
      const ts: TrackSettings = track?.getSettings() ?? {};
      info = {
        width: ts.width ?? video.videoWidth,
        height: ts.height ?? video.videoHeight,
        fps: ts.frameRate ?? null,
        facing: ts.facingMode,
        deviceId: ts.deviceId,
        label: track?.label || undefined,
        fpsFallback: opened.fpsFallback,
        ...(exposure ? { exposure } : {}),
        ...(focus ? { focus } : {}),
      };
      syncLoop();
      return info;
    },
    stop() {
      gen++;
      release();
    },
    onFrame(cb) {
      frames.add(cb);
      syncLoop();
      return () => {
        frames.delete(cb);
        syncLoop();
      };
    },
    onEnded(cb) {
      ended.add(cb);
      return () => ended.delete(cb);
    },
    info: () => info,
    controls: () => ({ exposure, focus }),
    applyExposure,
    applyFocus,
    async listCameras() {
      if (!md) return [];
      const devices = await md.enumerateDevices();
      // Before a grant some browsers list one entry with an empty deviceId: nothing to pick.
      return devices
        .filter((d) => d.kind === 'videoinput' && d.deviceId !== '')
        .map((d) => ({ deviceId: d.deviceId, label: d.label }));
    },
    onDeviceChange(cb) {
      md?.addEventListener('devicechange', cb);
      return () => md?.removeEventListener('devicechange', cb);
    },
  };
}

/** iOS needs playsinline + muted for inline autoplay (spec §2.1). */
export function createVideo(): HTMLVideoElement {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.setAttribute('playsinline', '');
  return video;
}
