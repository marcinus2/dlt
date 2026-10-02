// Real wiring (plan 5.1): CameraSource → FrameAnalyzer → DetectorEngine behind Effects, plus
// the announcer (M6). Wake lock only logs until M8.
import { type Announcer, createAnnouncer, loggedAnnouncer } from '../audio/announcer.ts';
import { createCameraSource } from '../engine/browser/camera-source.ts';
import { createFrameAnalyzer } from '../engine/browser/frame-analyzer.ts';
import { createDetectorEngine } from '../engine/engine.ts';
import type { SettingsStorage } from '../settings/storage.ts';
import type { Effects } from './effects.ts';

export interface RealOptions {
  settings: SettingsStorage;
  /** Log sink for the not-yet-real effects (console with `?debug=1`). */
  log?: (msg: string) => void;
}

export function createRealEffects(opts: RealOptions): Effects {
  const log = opts.log ?? (() => {});
  const audio: Announcer = createAnnouncer();
  return {
    camera: createCameraSource(),
    engine: createDetectorEngine({ analyzer: createFrameAnalyzer() }),
    audio: opts.log ? loggedAnnouncer(audio, log) : audio,
    wakeLock: { acquire: () => log('wakeLock.acquire'), release: () => log('wakeLock.release') },
    settings: opts.settings,
  };
}
