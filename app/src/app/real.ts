// Real wiring (plan 5.1): CameraSource → FrameAnalyzer → DetectorEngine behind Effects, plus
// the announcer (M6) and the platform glue (M8).
import { type Announcer, createAnnouncer, loggedAnnouncer } from '../audio/announcer.ts';
import { createCameraSource } from '../engine/browser/camera-source.ts';
import { createFrameAnalyzer } from '../engine/browser/frame-analyzer.ts';
import { createDetectorEngine } from '../engine/engine.ts';
import { loggedWakeLock } from '../platform/wake-lock.ts';
import type { SettingsStorage } from '../settings/storage.ts';
import type { Effects, PlatformPort, WakeLockPort } from './effects.ts';

export interface RealOptions {
  settings: SettingsStorage;
  wakeLock: WakeLockPort;
  platform: PlatformPort;
  /** Log sink for audio cues (console with `?debug=1`). */
  log?: (msg: string) => void;
}

export function createRealEffects(opts: RealOptions): Effects {
  const audio: Announcer = createAnnouncer();
  const camera = createCameraSource();
  const analyzer = createFrameAnalyzer();
  const engine = createDetectorEngine({ analyzer });
  return {
    camera,
    engine,
    audio: opts.log ? loggedAnnouncer(audio, opts.log) : audio,
    wakeLock: opts.log ? loggedWakeLock(opts.wakeLock, opts.log) : opts.wakeLock,
    platform: opts.platform,
    settings: opts.settings,
    diag: { engine, analyzer, camera },
  };
}
