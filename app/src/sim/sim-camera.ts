// Simulated FrameSource (plan 2.5): the real camera preview when getUserMedia works,
// otherwise an animated canvas.captureStream() placeholder. Can simulate every CameraError
// kind on start and a mid-session `ended`. Emits no frames (SimEngine needs none). The placeholder
// lists two fake devices so the Configuration picker and capability report can be tried.
import type { CameraPort } from '../app/effects.ts';
import type { CameraDevice, CameraError, CameraInfo, CameraSettings, Unsubscribe } from '../engine/types.ts';

export interface SimCamera extends CameraPort {
  /** Every start fails with this kind until cleared (null). */
  setFailure(kind: CameraError['kind'] | null): void;
  failure(): CameraError['kind'] | null;
  /** Ends the running camera as if the track ended (permission revoked, unplugged). */
  drop(): void;
}

export interface SimCameraOptions {
  /** Try getUserMedia first (default true). false = placeholder only (gallery, e2e). */
  real?: boolean;
  startDelayMs?: number;
}

const MESSAGES: Record<CameraError['kind'], string> = {
  permission: 'Permission denied (simulated)',
  notFound: 'Requested device not found (simulated)',
  busy: 'Could not start video source (simulated)',
  overconstrained: 'Constraints could not be satisfied (simulated)',
  insecure: 'getUserMedia requires a secure context (simulated)',
  ended: 'Camera track ended (simulated)',
  unknown: 'Unknown camera error (simulated)',
};

export const SIM_DEVICES: readonly (CameraDevice & { facing: CameraSettings['facing'] })[] = [
  { deviceId: 'sim-user', label: 'Simulated front camera', facing: 'user' },
  { deviceId: 'sim-environment', label: 'Simulated rear camera', facing: 'environment' },
];

export function createSimCamera(opts: SimCameraOptions = {}): SimCamera {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.setAttribute('playsinline', '');

  let settings: CameraSettings | null = null;
  let failure: CameraError['kind'] | null = null;
  let stream: MediaStream | null = null;
  let raf = 0;
  let gen = 0;
  const ended = new Set<(e: CameraError) => void>();

  function release() {
    cancelAnimationFrame(raf);
    for (const t of stream?.getTracks() ?? []) t.stop();
    stream = null;
    video.srcObject = null;
  }

  function lose(error: CameraError) {
    release();
    for (const cb of ended) cb(error);
  }

  async function realStream(s: CameraSettings): Promise<MediaStream | null> {
    if (opts.real === false || !navigator.mediaDevices?.getUserMedia) return null;
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: s.facing },
          width: { ideal: s.width },
          height: { ideal: s.height },
          frameRate: { ideal: s.fps },
        },
      });
    } catch {
      return null; // denied / no camera → placeholder
    }
  }

  function placeholder(s: CameraSettings): MediaStream | null {
    const canvas = document.createElement('canvas');
    canvas.width = s.width;
    canvas.height = s.height;
    const ctx = canvas.getContext('2d');
    if (!ctx || typeof canvas.captureStream !== 'function') return null;
    const { width: w, height: h } = canvas;
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#1b2333');
    sky.addColorStop(1, '#0d1118');
    const font = `600 ${Math.round(w / 14)}px system-ui, sans-serif`;
    const draw = (t: number) => {
      // Ceiling: dark gradient, a light, a slowly circling "drone".
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(240,242,243,0.10)';
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 0.3, Math.min(w, h) * 0.18, 0, Math.PI * 2);
      ctx.fill();
      const a = t / 1400;
      ctx.fillStyle = '#05070a';
      ctx.beginPath();
      ctx.arc(w * (0.5 + 0.32 * Math.cos(a)), h * (0.5 + 0.36 * Math.sin(a * 0.7)), w * 0.06, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(154,166,182,0.8)';
      ctx.font = font;
      ctx.textAlign = 'center';
      // The UI mirrors the front camera; pre-mirror the label so it reads correctly.
      if (s.facing === 'user') ctx.setTransform(-1, 0, 0, 1, w, 0);
      ctx.fillText('SIMULATED CAMERA', w / 2, h - w / 10);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return canvas.captureStream(30);
  }

  return {
    video,
    configure(s) {
      settings = s;
    },
    async start(): Promise<CameraInfo> {
      release();
      const my = ++gen;
      const s = settings;
      if (!s) throw { kind: 'unknown', message: 'camera not configured' } satisfies CameraError;
      await new Promise((r) => setTimeout(r, opts.startDelayMs ?? 400));
      if (failure) throw { kind: failure, message: MESSAGES[failure] } satisfies CameraError;
      const real = await realStream(s);
      if (my !== gen) {
        for (const t of real?.getTracks() ?? []) t.stop();
        throw { kind: 'unknown', message: 'superseded' } satisfies CameraError;
      }
      const device =
        SIM_DEVICES.find((d) => d.deviceId === s.deviceId) ?? SIM_DEVICES.find((d) => d.facing === s.facing);
      const facing = real ? s.facing : (device?.facing ?? s.facing);
      stream = real ?? placeholder({ ...s, facing });
      const track = stream?.getVideoTracks()[0];
      track?.addEventListener('ended', () => lose({ kind: 'ended', message: 'Camera track ended' }));
      video.srcObject = stream;
      video.play().catch(() => {}); // muted autoplay; a rejected play() only delays the preview
      const ts = track?.getSettings?.() ?? {};
      const base = { width: ts.width ?? s.width, height: ts.height ?? s.height, fps: ts.frameRate ?? s.fps };
      if (real)
        return { ...base, facing: ts.facingMode ?? s.facing, deviceId: ts.deviceId, label: track?.label };
      const unsupported = { supported: false };
      return {
        ...base,
        facing,
        deviceId: device?.deviceId,
        label: device?.label,
        exposure: unsupported,
        focus: unsupported,
      };
    },
    stop() {
      gen++;
      release();
    },
    onFrame: () => () => {},
    async listCameras() {
      const md = opts.real === false ? null : navigator.mediaDevices;
      if (!md?.enumerateDevices) return SIM_DEVICES.map(({ deviceId, label }) => ({ deviceId, label }));
      const all = await md.enumerateDevices();
      return all
        .filter((d) => d.kind === 'videoinput' && d.deviceId !== '')
        .map((d) => ({ deviceId: d.deviceId, label: d.label }));
    },
    onDeviceChange(cb) {
      const md = opts.real === false ? null : navigator.mediaDevices;
      md?.addEventListener?.('devicechange', cb);
      return () => md?.removeEventListener?.('devicechange', cb);
    },
    onEnded(cb): Unsubscribe {
      ended.add(cb);
      return () => ended.delete(cb);
    },
    setFailure(kind) {
      failure = kind;
    },
    failure: () => failure,
    drop() {
      if (stream) lose({ kind: 'ended', message: MESSAGES.ended });
    },
  };
}
