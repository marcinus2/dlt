// Real wiring (plan 5.1): CameraSource → FrameAnalyzer → DetectorEngine behind Effects.
// Audio and wake lock only log until M6 / M8.
import { createCameraSource } from '../engine/browser/camera-source.ts';
import { createFrameAnalyzer } from '../engine/browser/frame-analyzer.ts';
import { createDetectorEngine } from '../engine/engine.ts';
import { speechText } from '../session/laps.ts';
import type { SettingsStorage } from '../settings/storage.ts';
import type { Effects } from './effects.ts';

export interface RealOptions {
  settings: SettingsStorage;
  /** Log sink for the not-yet-real effects (console with `?debug=1`). */
  log?: (msg: string) => void;
}

export function createRealEffects(opts: RealOptions): Effects {
  const log = opts.log ?? (() => {});
  return {
    camera: createCameraSource(),
    engine: createDetectorEngine({ analyzer: createFrameAnalyzer() }),
    audio: {
      unlock: () => log('audio.unlock'),
      cue: (cue, lapMs) => {
        const text = speechText(cue, lapMs);
        log(`cue ${cue}${text ? ` “${text}”` : ''}`);
      },
    },
    wakeLock: { acquire: () => log('wakeLock.acquire'), release: () => log('wakeLock.release') },
    settings: opts.settings,
  };
}
