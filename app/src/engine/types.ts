// Engine contracts (spec §5.2). Implemented by the real engine (M4) and by sim/ (M2).

export type Ms = number; // frame clock: performance.now() or mediaTime*1000
export type Unsubscribe = () => void;
export interface Roi {
  x: number;
  y: number;
  width: number;
  height: number;
} // relative 0–1

export interface DetectionSettings {
  pixelDiffThreshold: number;
  brightnessNormalize: boolean;
  globalGuard: boolean;
  globalGuardRatio: number;
  processingMaxSize: number;
  readbackHint: boolean;
  startRatio: number;
  endRatio: number;
  minMotionMs: Ms;
  endHoldMs: Ms;
  cooldownMs: Ms;
  maxMotionMs: Ms;
  warmupMs: Ms;
  resetGapMs: Ms;
  roi: Roi;
}
export interface CameraSettings {
  facing: 'user' | 'environment';
  deviceId: string | null;
  width: number;
  height: number;
  fps: number;
  fpsExact: boolean;
  exposureManual: boolean;
  exposureTime: number;
  focusLock: boolean;
}
export interface AudioSettings {
  beep: boolean;
  voice: boolean;
  announceBest: boolean;
}
export interface CalibrationSettings {
  durationMs: Ms;
  k: number;
}
export interface Settings {
  version: 2;
  camera: CameraSettings;
  detection: DetectionSettings;
  calibration: CalibrationSettings;
  audio: AudioSettings;
}

export interface FrameMeta {
  t: Ms;
  dropped: number;
  presented: number | null;
  gapReset: boolean;
  seeked: boolean;
  tSource: 'captureTime' | 'now' | 'mediaTime';
}
export interface MotionSample {
  t: Ms;
  ratio: number;
  globalRatio: number;
  global: boolean;
  gapReset: boolean;
}

export type DetectorEvent =
  | { type: 'MOTION_START'; t: Ms; dStart: Ms | null }
  | {
      type: 'MOTION_END';
      t: Ms;
      startT: Ms;
      endT: Ms;
      durationMs: Ms;
      peakT: Ms;
      peakRatio: number;
      frames: number;
      dStart: Ms | null;
      dPeak: Ms | null;
    }
  | { type: 'SUPPRESSED'; t: Ms; reason: 'cooldown' }
  | { type: 'REJECTED'; t: Ms; reason: 'LONG_MOTION'; startT: Ms; durationMs: Ms };

/** An accepted, finished pass (from MOTION_END). The only thing the lap logic consumes. */
export interface PassEvent {
  startT: Ms;
  endT: Ms;
  peakT: Ms;
  peakRatio: number;
}

export type EnginePhase = 'stopped' | 'warmup' | 'armed' | 'motion';
export interface EngineStats {
  fps: number;
  deliveredFps: number | null;
  dropped: number;
  msPerFrame: number;
  ratio: number;
  tSource: FrameMeta['tSource'];
}
export interface CameraError {
  kind: 'permission' | 'notFound' | 'busy' | 'overconstrained' | 'insecure' | 'ended' | 'unknown';
  message: string;
}

export interface CameraInfo {
  width: number;
  height: number;
  fps: number | null;
  facing?: string;
}

export interface FrameSource {
  readonly video: HTMLVideoElement;
  start(): Promise<CameraInfo>;
  stop(): void; // stops tracks and cancels rVFC
  onFrame(cb: (f: FrameMeta) => void): Unsubscribe;
  onEnded(cb: (e: CameraError) => void): Unsubscribe;
}

export interface FrameAnalyzer {
  // browser/frame-analyzer.ts; worker-swappable later
  process(
    img: CanvasImageSource,
    w: number,
    h: number,
    s: DetectionSettings,
  ): { ratio: number; globalRatio: number; global: boolean }; // global=true when no previous frame / size changed
  reset(): void;
}

export interface DetectorEngine {
  start(source: FrameSource, s: DetectionSettings): void; // source already started; enters warm-up
  stop(): void; // synchronous; no events after it returns
  reset(): void; // back to warm-up (START, CONTINUE)
  update(s: DetectionSettings): void; // live tuning only (Configuration)
  on(e: 'pass', cb: (p: PassEvent) => void): Unsubscribe;
  on(e: 'phase', cb: (p: EnginePhase) => void): Unsubscribe;
  on(e: 'event', cb: (ev: DetectorEvent) => void): Unsubscribe; // debug log
  on(e: 'sample', cb: (s: MotionSample) => void): Unsubscribe; // meter/graph; consumers throttle
  stats(): EngineStats; // polled ≤ 4 Hz
}
