// Simulation mode wiring (G11): SimEngine + SimCamera behind the real Effects interface.
// Audio and wake lock only log until M6 / M8. Loaded as a lazy chunk.
import type { Effects } from '../app/effects.ts';
import type { SimControls } from '../app/store.ts';
import type { Ms } from '../engine/types.ts';
import type { SettingsStorage } from '../settings/storage.ts';
import { createSimCamera } from './sim-camera.ts';
import { createSimEngine } from './sim-engine.ts';

export interface SimOptions {
  settings: SettingsStorage;
  /** false = placeholder camera only (gallery, e2e: `?cam=fake`). */
  realCamera?: boolean;
  /** Fixed lap time (`?lap=<s>`); default 10–15 s random. */
  lapMs?: Ms;
  auto?: boolean;
  log?: (msg: string) => void;
}

export function createSim(opts: SimOptions): { effects: Effects; controls: SimControls } {
  const log = opts.log ?? ((msg: string) => console.info(`[sim] ${msg}`));
  const camera = createSimCamera({ real: opts.realCamera ?? true });
  const engine = createSimEngine({
    auto: opts.auto ?? true,
    lapRange: opts.lapMs ? [opts.lapMs, opts.lapMs] : undefined,
  });
  const effects: Effects = {
    camera,
    engine,
    audio: {
      unlock: () => log('audio.unlock'),
      cue: (cue, lapMs) => log(`audio.cue ${cue}${lapMs === undefined ? '' : ` ${lapMs.toFixed(0)} ms`}`),
    },
    wakeLock: { acquire: () => log('wakeLock.acquire'), release: () => log('wakeLock.release') },
    settings: opts.settings,
  };
  const controls: SimControls = {
    pass: engine.pass,
    setAuto: engine.setAuto,
    auto: engine.auto,
    setLowFps: engine.setLowFps,
    lowFps: engine.lowFps,
    dropCamera: camera.drop,
    setCameraFailure: camera.setFailure,
    cameraFailure: camera.failure,
  };
  return { effects, controls };
}
