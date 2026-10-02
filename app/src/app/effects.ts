// Effect runner: executes reducer effects against injected implementations
// (real engine from M5, sim/ before). Gesture-bound effects run synchronously.
import type { Announcer } from '../audio/announcer.ts';
import { toCameraError } from '../engine/camera-error.ts';
import type {
  CameraInfo,
  CameraSettings,
  DetectorEngine,
  EngineStats,
  FrameSource,
  Ms,
  Settings,
  Unsubscribe,
} from '../engine/types.ts';
import type { SettingsStorage } from '../settings/storage.ts';
import type { AppEvent, AppState, Cue, Effect } from './machine.ts';

export interface CameraPort extends FrameSource {
  /** Settings for the next start(). */
  configure(s: CameraSettings): void;
}

export interface Effects {
  camera: CameraPort;
  engine: DetectorEngine;
  audio: Announcer;
  wakeLock: { acquire(): void; release(): void };
  settings: SettingsStorage;
}

/** What the runner needs from the store. */
export interface RunnerHost {
  state(): AppState;
  saved(): Settings;
  draft(): Settings;
  dispatch(e: AppEvent): void;
  committed(ok: boolean): void;
  reverted(): void;
  cameraInfo(info: CameraInfo | null): void;
  passFlash(): void;
  stats(stats: EngineStats | null, lowFps: boolean): void;
  audioLocked(locked: boolean): void;
  voiceAvailable(available: boolean): void;
  speechLatency(l: SpeechLatency): void;
}

/** Speech latency probe (plan 6.6): MOTION_END frame time → utterance start. */
export interface SpeechLatency {
  last: Ms;
  p90: Ms;
  n: number;
}

export const LATENCY_WINDOW = 20;
/** Lap time spoken by the Diagnostics sound check. */
export const SAMPLE_LAP_MS = 12340;

export { toCameraError };

export const STATS_INTERVAL_MS = 500; // ≤ 4 Hz store updates
export const LOW_FPS = 20;
export const LOW_FPS_HOLD_MS = 2000;

/** Low-fps chip (spec §3.4): fps below LOW_FPS for LOW_FPS_HOLD_MS; clears once fps recovers. */
export function lowFpsTracker() {
  let since: number | null = null;
  return {
    update(fps: number, now: Ms): boolean {
      if (fps >= LOW_FPS) since = null;
      else since ??= now;
      return since !== null && now - since >= LOW_FPS_HOLD_MS;
    },
    reset() {
      since = null;
    },
  };
}

/** p90 (nearest rank) over the last `size` samples. */
export function latencyWindow(size = LATENCY_WINDOW) {
  const xs: Ms[] = [];
  return {
    add(ms: Ms): SpeechLatency {
      xs.push(ms);
      if (xs.length > size) xs.shift();
      const sorted = [...xs].sort((a, b) => a - b);
      const p90 = sorted[Math.ceil(0.9 * sorted.length) - 1] ?? ms;
      return { last: ms, p90, n: xs.length };
    },
  };
}

export function createEffectRunner(fx: Effects, host: RunnerHost) {
  let cameraGen = 0;
  let engineRun = 0;
  let engineSubs: Unsubscribe[] = [];
  let statsTimer: ReturnType<typeof setInterval> | null = null;
  const lowFps = lowFpsTracker();
  const latency = latencyWindow();
  /** MOTION_END frame time of the pass being dispatched; its cue starts the latency probe. */
  let passT: Ms | null = null;

  const settingsFor = (draft?: true) => (draft ? host.draft() : host.saved());

  fx.camera.onEnded((error) => host.dispatch({ type: 'CAMERA_LOST', error }));
  fx.audio.onLockChange(host.audioLocked);
  fx.audio.onVoiceChange(host.voiceAvailable);

  /** New engine run: listeners of older runs drop their events. */
  function subscribe() {
    for (const off of engineSubs) off();
    const run = ++engineRun;
    engineSubs = [
      fx.engine.on('pass', (pass) => {
        if (run !== engineRun) return;
        host.passFlash();
        passT = pass.t;
        host.dispatch({ type: 'PASS', pass });
        passT = null;
      }),
      fx.engine.on('phase', (phase) => {
        if (run === engineRun && phase === 'armed') host.dispatch({ type: 'ARMED' });
      }),
    ];
  }

  function startStats() {
    if (statsTimer !== null) return;
    lowFps.reset();
    statsTimer = setInterval(() => {
      const stats = fx.engine.stats();
      host.stats(stats, lowFps.update(stats.fps, performance.now()));
    }, STATS_INTERVAL_MS);
  }

  function stopStats() {
    if (statsTimer !== null) clearInterval(statsTimer);
    statsTimer = null;
    host.stats(null, false);
  }

  function startCamera(draft?: true, onLive: () => void = () => host.dispatch({ type: 'CAMERA_LIVE' })) {
    fx.camera.configure(settingsFor(draft).camera);
    const gen = ++cameraGen;
    fx.camera.start().then(
      (info) => {
        if (gen !== cameraGen) return;
        host.cameraInfo(info);
        onLive();
      },
      (err: unknown) => {
        if (gen === cameraGen) host.dispatch({ type: 'CAMERA_ERROR', error: toCameraError(err) });
      },
    );
  }

  function run(e: Effect) {
    switch (e.type) {
      case 'camera.start':
        startCamera(e.draft);
        break;
      case 'camera.stop':
        cameraGen++;
        fx.camera.stop();
        host.cameraInfo(null);
        break;
      case 'engine.start':
        subscribe();
        fx.engine.start(fx.camera, settingsFor(e.draft).detection);
        startStats();
        break;
      case 'engine.reset':
        subscribe();
        fx.engine.reset();
        break;
      case 'engine.stop':
        for (const off of engineSubs) off();
        engineSubs = [];
        engineRun++;
        fx.engine.stop();
        stopStats();
        break;
      case 'audio.unlock':
        fx.audio.unlock();
        break;
      case 'audio.cue': {
        const t = passT;
        const probe = t === null ? undefined : () => host.speechLatency(latency.add(performance.now() - t));
        fx.audio.cue(e.cue, e.lapMs, host.saved().audio, probe);
        break;
      }
      case 'wakeLock.acquire':
        fx.wakeLock.acquire();
        break;
      case 'wakeLock.release':
        fx.wakeLock.release();
        break;
      case 'settings.commit':
        host.committed(fx.settings.save(host.draft()));
        break;
      case 'settings.revert':
        host.reverted();
        break;
    }
  }

  return {
    run,
    /** Banner tap (plan 6.5); inside the gesture. */
    unlockAudio: () => fx.audio.unlock(),
    /** Diagnostics sound check with the draft audio toggles; inside the gesture. */
    testCue(cue: Cue) {
      fx.audio.unlock();
      fx.audio.cue(cue, cue === 'armed' || cue === 'go' ? undefined : SAMPLE_LAP_MS, host.draft().audio);
    },
    /** Gallery boot into a live state: start camera + engine without dispatching. */
    resumeLive() {
      const draft = host.state().tuning ? true : undefined;
      startCamera(draft, () => run({ type: 'engine.start', draft }));
    },
  };
}

export type EffectRunner = ReturnType<typeof createEffectRunner>;
