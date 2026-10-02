// Simulation mode wiring (G11): SimEngine + SimCamera behind the real Effects interface.
// Sound comes from the real announcer (M6); wake lock only logs until M8. Loaded as a lazy chunk.
import type { Effects } from '../app/effects.ts';
import type { SimControls } from '../app/store.ts';
import { type Announcer, loggedAnnouncer } from '../audio/announcer.ts';
import type { Ms } from '../engine/types.ts';
import type { SettingsStorage } from '../settings/storage.ts';
import { createSimCamera } from './sim-camera.ts';
import { createSimEngine } from './sim-engine.ts';

export interface SimOptions {
  settings: SettingsStorage;
  audio: Announcer;
  /** false = placeholder camera only (gallery, e2e: `?cam=fake`). */
  realCamera?: boolean;
  /** Fixed lap time (`?lap=<s>`); default 10–15 s random. */
  lapMs?: Ms;
  auto?: boolean;
  /** Extra log sink (e.g. console in debug). */
  log?: (msg: string) => void;
}

const RANDOM_LAPS: [Ms, Ms] = [10000, 15000];
const LOG_LINES = 4;

export function createSim(opts: SimOptions): { effects: Effects; controls: SimControls } {
  let lines: { id: number; text: string }[] = [];
  let lineId = 0;
  const listeners = new Set<() => void>();
  const log = (msg: string) => {
    opts.log?.(msg);
    lines = [{ id: ++lineId, text: msg }, ...lines].slice(0, LOG_LINES);
    for (const cb of listeners) cb();
  };
  let lapMs = opts.lapMs ?? null;
  const camera = createSimCamera({ real: opts.realCamera ?? true });
  const engine = createSimEngine({ auto: opts.auto ?? true, lapRange: lapMs ? [lapMs, lapMs] : RANDOM_LAPS });
  const effects: Effects = {
    camera,
    engine,
    audio: loggedAnnouncer(opts.audio, log),
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
    setLapMs(ms) {
      lapMs = ms;
      engine.setLapRange(ms ? [ms, ms] : RANDOM_LAPS);
    },
    lapMs: () => lapMs,
    log: () => lines,
    onLog(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  return { effects, controls };
}
