// Fake <video>, MediaStream track and mediaDevices for source tests. No DOM.

type FrameCb = (now: number, meta: VideoFrameCallbackMetadata) => void;

export interface FakeVideo {
  srcObject: unknown;
  src: string;
  loop: boolean;
  currentTime: number;
  readyState: number;
  videoWidth: number;
  videoHeight: number;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
  addEventListener(type: string, cb: () => void): void;
  removeEventListener(type: string, cb: () => void): void;
  requestVideoFrameCallback?(cb: FrameCb): number;
  cancelVideoFrameCallback?(h: number): void;
  /** Delivers one frame to the pending rVFC callbacks. */
  frame(now: number, meta?: Partial<VideoFrameCallbackMetadata>): void;
  /** The last requested callback, even if cancelled (to simulate a late frame). */
  lastCallback: FrameCb | null;
  pending(): number;
  fire(type: string): void;
  plays: number;
}

export function fakeVideo({ rvfc = true } = {}): FakeVideo {
  const pending = new Map<number, FrameCb>();
  const listeners = new Map<string, Set<() => void>>();
  let id = 0;
  const v: FakeVideo = {
    srcObject: null,
    src: '',
    loop: false,
    currentTime: 0,
    readyState: 4,
    videoWidth: 240,
    videoHeight: 480,
    plays: 0,
    async play() {
      v.plays++;
    },
    pause() {},
    load() {},
    removeAttribute(name) {
      if (name === 'src') v.src = '';
    },
    addEventListener(type, cb) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(cb);
    },
    removeEventListener(type, cb) {
      listeners.get(type)?.delete(cb);
    },
    frame(now, meta = {}) {
      const cbs = [...pending.values()];
      pending.clear();
      const m = { mediaTime: v.currentTime, presentedFrames: 0, ...meta } as VideoFrameCallbackMetadata;
      for (const cb of cbs) cb(now, m);
    },
    lastCallback: null,
    pending: () => pending.size,
    fire(type) {
      for (const cb of listeners.get(type) ?? []) cb();
    },
  };
  if (rvfc) {
    v.requestVideoFrameCallback = (cb) => {
      pending.set(++id, cb);
      v.lastCallback = cb;
      return id;
    };
    v.cancelVideoFrameCallback = (h) => {
      pending.delete(h);
    };
  }
  return v;
}

export interface FakeTrack {
  readyState: 'live' | 'ended';
  settings: Record<string, unknown>;
  caps: Record<string, unknown>;
  applied: unknown[];
  applyError: Error | null;
  stop(): void;
  getSettings(): Record<string, unknown>;
  getCapabilities(): Record<string, unknown>;
  applyConstraints(c: { advanced?: Record<string, unknown>[] }): Promise<void>;
  addEventListener(type: string, cb: () => void): void;
  removeEventListener(type: string, cb: () => void): void;
  /** Ends the track as the browser would (permission revoked, unplugged). */
  end(): void;
}

export function fakeTrack(
  settings: Record<string, unknown> = {},
  caps: Record<string, unknown> = {},
): FakeTrack {
  const ended = new Set<() => void>();
  const t: FakeTrack = {
    readyState: 'live',
    settings: { width: 240, height: 480, frameRate: 30, facingMode: 'user', deviceId: 'cam-1', ...settings },
    caps,
    applied: [],
    applyError: null,
    stop() {
      t.readyState = 'ended';
    },
    getSettings: () => ({ ...t.settings }),
    getCapabilities: () => t.caps,
    async applyConstraints(c) {
      if (t.applyError) throw t.applyError;
      t.applied.push(c);
      Object.assign(t.settings, c.advanced?.[0]);
    },
    addEventListener(type, cb) {
      if (type === 'ended') ended.add(cb);
    },
    removeEventListener(type, cb) {
      if (type === 'ended') ended.delete(cb);
    },
    end() {
      t.readyState = 'ended';
      for (const cb of ended) cb();
    },
  };
  return t;
}

export const fakeStream = (track: FakeTrack) =>
  ({ getTracks: () => [track], getVideoTracks: () => [track] }) as unknown as MediaStream;

/** getUserMedia answers from `script` in order: an error object to throw or a track to return. */
export function fakeMediaDevices(script: (FakeTrack | { name: string; constraint?: string })[]) {
  const calls: MediaStreamConstraints[] = [];
  const listeners = new Set<() => void>();
  let resolveNext: (() => void) | null = null;
  const md = {
    calls,
    /** When set, getUserMedia waits for release() before answering. */
    hold: false,
    release() {
      resolveNext?.();
    },
    async getUserMedia(c: MediaStreamConstraints) {
      calls.push(c);
      if (md.hold)
        await new Promise<void>((r) => {
          resolveNext = r;
        });
      const next = script.shift();
      if (!next) throw { name: 'NotFoundError', message: 'no more cameras' };
      if ('stop' in next) return fakeStream(next);
      throw { message: next.name, ...next };
    },
    async enumerateDevices() {
      return [
        { kind: 'audioinput', deviceId: 'mic', label: 'Mic' },
        { kind: 'videoinput', deviceId: 'cam-1', label: 'Front' },
        { kind: 'videoinput', deviceId: 'cam-2', label: 'Back' },
      ] as MediaDeviceInfo[];
    },
    addEventListener(_type: string, cb: () => void) {
      listeners.add(cb);
    },
    removeEventListener(_type: string, cb: () => void) {
      listeners.delete(cb);
    },
    fireDeviceChange() {
      for (const cb of listeners) cb();
    },
  };
  return md;
}
