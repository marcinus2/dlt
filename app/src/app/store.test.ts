import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CameraError,
  CameraInfo,
  CameraSettings,
  DetectionSettings,
  DetectorEngine,
  EnginePhase,
  EngineStats,
  PassEvent,
} from '../engine/types.ts';
import { DEFAULTS, setSetting } from '../settings/schema.ts';
import { createSettingsStorage, memoryBackend } from '../settings/storage.ts';
import { type Effects, lowFpsTracker, STATS_INTERVAL_MS, toCameraError } from './effects.ts';
import { initialState } from './machine.ts';
import { createAppStore, STORAGE_TOAST } from './store.ts';

const info: CameraInfo = { width: 240, height: 480, fps: 30, facing: 'user' };
const stats: EngineStats = { fps: 30, deliveredFps: 30, dropped: 0, msPerFrame: 6, ratio: 0, tSource: 'now' };
const pass = (startT: number): PassEvent => ({
  startT,
  endT: startT + 200,
  peakT: startT + 100,
  peakRatio: 0.1,
});

function fakeEffects() {
  const log: string[] = [];
  const listeners = { pass: new Set<(p: PassEvent) => void>(), phase: new Set<(p: EnginePhase) => void>() };
  let ended: ((e: CameraError) => void) | null = null;
  let pending: { resolve(i: CameraInfo): void; reject(e: unknown): void } | null = null;
  const configured: CameraSettings[] = [];
  const started: DetectionSettings[] = [];
  const updated: DetectionSettings[] = [];
  let engineStats = stats;

  const engine = {
    start: (_src: unknown, s: DetectionSettings) => {
      log.push('engine.start');
      started.push(s);
    },
    stop: () => log.push('engine.stop'),
    reset: () => log.push('engine.reset'),
    update: (s: DetectionSettings) => updated.push(s),
    on: (e: 'pass' | 'phase', cb: never) => {
      const set = listeners[e] as Set<unknown>;
      set.add(cb);
      return () => set.delete(cb);
    },
    stats: () => engineStats,
  } as unknown as DetectorEngine;

  const backend = memoryBackend();
  let saveFails = false;
  const storage = createSettingsStorage(backend);

  const effects: Effects = {
    camera: {
      video: {} as HTMLVideoElement,
      configure: (s) => configured.push(s),
      start: () => {
        log.push('camera.start');
        return new Promise<CameraInfo>((resolve, reject) => {
          pending = { resolve, reject };
        });
      },
      stop: () => log.push('camera.stop'),
      onFrame: () => () => {},
      onEnded: (cb) => {
        ended = cb;
        return () => {};
      },
    },
    engine,
    audio: {
      unlock: () => log.push('audio.unlock'),
      cue: (c, ms) => log.push(`cue:${c}${ms ? `:${ms}` : ''}`),
    },
    wakeLock: { acquire: () => log.push('wakeLock.acquire'), release: () => log.push('wakeLock.release') },
    settings: { load: storage.load, save: (s) => (saveFails ? false : storage.save(s)) },
  };

  return {
    effects,
    log,
    configured,
    started,
    updated,
    backend,
    failSaves: () => {
      saveFails = true;
    },
    setStats: (s: EngineStats) => {
      engineStats = s;
    },
    emitPass: (p: PassEvent) => {
      for (const cb of [...listeners.pass]) cb(p);
    },
    emitPhase: (p: EnginePhase) => {
      for (const cb of [...listeners.phase]) cb(p);
    },
    passListeners: () => [...listeners.pass],
    endTrack: (e: CameraError) => ended?.(e),
    resolveCamera: async (i = info) => {
      pending?.resolve(i);
      await Promise.resolve();
      await Promise.resolve();
    },
    rejectCamera: async (e: unknown) => {
      pending?.reject(e);
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

function setup() {
  const f = fakeEffects();
  const store = createAppStore({ effects: f.effects });
  const dispatch = store.getState().dispatch;
  return { f, store, dispatch, state: () => store.getState().state };
}

async function inSession() {
  const t = setup();
  t.dispatch({ type: 'GET_READY' });
  await t.f.resolveCamera();
  t.dispatch({ type: 'START' });
  t.f.emitPhase('armed');
  return t;
}

describe('store + effect runner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs gesture-bound effects synchronously inside dispatch', () => {
    const { f, dispatch, state } = setup();
    dispatch({ type: 'GET_READY' });
    // No await: unlock, camera.start and wake lock already happened.
    expect(f.log).toEqual(['audio.unlock', 'camera.start', 'wakeLock.acquire']);
    expect(f.configured).toEqual([DEFAULTS.camera]);
    expect(state()).toMatchObject({ screen: 'getReady', camera: 'starting' });
  });

  it('camera start → CAMERA_LIVE → engine.start with the saved detection settings', async () => {
    const { f, store, dispatch, state } = setup();
    dispatch({ type: 'GET_READY' });
    await f.resolveCamera();
    expect(state().camera).toBe('live');
    expect(f.started).toEqual([DEFAULTS.detection]);
    expect(store.getState().ui.cameraInfo).toEqual(info);
  });

  it('camera start failure → CAMERA_ERROR with the mapped kind', async () => {
    const { f, dispatch, state } = setup();
    dispatch({ type: 'GET_READY' });
    await f.rejectCamera({ name: 'NotAllowedError', message: 'Permission denied' });
    expect(state().camera).toEqual({ error: { kind: 'permission', message: 'Permission denied' } });
  });

  it('a camera start that finishes after camera.stop is dropped', async () => {
    const { f, dispatch, state } = setup();
    dispatch({ type: 'GET_READY' });
    dispatch({ type: 'NAV_NEW_SESSION' });
    await f.resolveCamera();
    expect(state()).toEqual(initialState);
    expect(f.started).toEqual([]);
  });

  it('engine phase armed → ARMED; pass → PASS with lap cues', async () => {
    const { f, dispatch, state } = await inSession();
    expect(state().session?.phase).toBe('ready');
    f.emitPass(pass(1000));
    f.emitPass(pass(13340));
    expect(state().session?.laps).toEqual([{ n: 1, ms: 12340, at: 13340 }]);
    expect(f.log.slice(-3)).toEqual(['cue:armed', 'cue:go', 'cue:best:12340']);
    dispatch({ type: 'STOP' });
    expect(f.log.slice(-2)).toEqual(['engine.stop', 'camera.stop']);
  });

  it('a PASS from an old run id is ignored', async () => {
    const { f, dispatch, state } = await inSession();
    f.emitPass(pass(0));
    const stale = f.passListeners();
    dispatch({ type: 'STOP' });
    dispatch({ type: 'CONTINUE' });
    await f.resolveCamera();
    f.emitPhase('armed');
    for (const cb of stale) cb(pass(10000)); // late event of the stopped run
    expect(state().session?.laps).toEqual([]);
    expect(state().session?.timing).toEqual({ kind: 'standby' });
    f.emitPass(pass(20000));
    expect(state().session?.timing).toEqual({ kind: 'running', refT: 20000 });
  });

  it('engine.reset starts a new run (passes before START are dropped)', async () => {
    const { f, dispatch, state } = setup();
    dispatch({ type: 'GET_READY' });
    await f.resolveCamera();
    const getReadyRun = f.passListeners();
    dispatch({ type: 'START' });
    f.emitPhase('armed');
    for (const cb of getReadyRun) cb(pass(5));
    expect(state().session?.timing).toEqual({ kind: 'standby' });
  });

  it('passes on Get Ready flash the ROI and leave the state alone (G3)', async () => {
    const { f, store, dispatch, state } = setup();
    dispatch({ type: 'GET_READY' });
    await f.resolveCamera();
    const before = state();
    f.emitPass(pass(100));
    expect(store.getState().ui.passFlash).toBe(1);
    expect(state()).toBe(before);
  });

  it('track ended → CAMERA_LOST → Paused + cue', async () => {
    const { f, state } = await inSession();
    f.endTrack({ kind: 'ended', message: 'gone' });
    expect(state()).toMatchObject({ screen: 'paused', pauseReason: 'cameraLost' });
    expect(f.log.at(-1)).toBe('cue:paused');
  });

  it('polls engine stats ≤ 4 Hz while running; low fps after 2 s below 20', async () => {
    const { f, store, dispatch } = await inSession();
    vi.advanceTimersByTime(STATS_INTERVAL_MS);
    expect(store.getState().ui.stats).toEqual(stats);
    f.setStats({ ...stats, fps: 12 });
    vi.advanceTimersByTime(STATS_INTERVAL_MS);
    expect(store.getState().ui.lowFps).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(store.getState().ui.lowFps).toBe(true);
    dispatch({ type: 'STOP' });
    expect(store.getState().ui).toMatchObject({ stats: null, lowFps: false });
  });

  it('draft edits dispatch CONFIG_CHANGED with dirty/valid; SAVE commits and persists', () => {
    const { f, store, dispatch, state } = setup();
    dispatch({ type: 'NAV_CONFIG' });
    store.getState().setDraft('camera.fps', 60);
    expect(state()).toMatchObject({ configDirty: true, configValid: true });
    store.getState().setDraft('camera.width', 5);
    expect(state()).toMatchObject({ configDirty: true, configValid: false });
    expect(store.getState().errors['camera.width']).toMatch(/^Must be/);
    dispatch({ type: 'SAVE' });
    expect(state().screen).toBe('config'); // invalid → ignored
    store.getState().setDraft('camera.width', 240);
    dispatch({ type: 'SAVE' });
    expect(state().screen).toBe('welcome');
    expect(store.getState().saved.camera.fps).toBe(60);
    expect(JSON.parse(f.backend.getItem('dronelap.settings.v2') ?? '{}').camera.fps).toBe(60);
  });

  it('editing back to the saved value is clean again', () => {
    const { store, dispatch, state } = setup();
    dispatch({ type: 'NAV_CONFIG' });
    store.getState().setDraft('camera.fps', 60);
    store.getState().setDraft('camera.fps', 30);
    expect(state().configDirty).toBe(false);
  });

  it('discard reverts the draft; Reset to defaults sets the draft only', () => {
    const { store, dispatch, state } = setup();
    dispatch({ type: 'NAV_CONFIG' });
    store.getState().setDraft('audio.voice', false);
    dispatch({ type: 'NAV_NEW_SESSION' });
    dispatch({ type: 'CONFIRM' });
    expect(store.getState().draft).toEqual(DEFAULTS);
    expect(state().screen).toBe('welcome');
    dispatch({ type: 'NAV_CONFIG' });
    store.getState().setDraft('audio.voice', false);
    store.getState().resetDraft();
    expect(store.getState().draft).toEqual(DEFAULTS);
    expect(state().configDirty).toBe(false);
  });

  it('a failed save keeps the settings in memory and shows the storage toast', () => {
    const { f, store, dispatch } = setup();
    f.failSaves();
    dispatch({ type: 'NAV_CONFIG' });
    store.getState().setDraft('camera.fps', 15);
    dispatch({ type: 'SAVE' });
    expect(store.getState().saved.camera.fps).toBe(15);
    expect(store.getState().ui.toast?.text).toBe(STORAGE_TOAST);
    const id = store.getState().ui.toast?.id ?? -1;
    store.getState().dismissToast(id + 1);
    expect(store.getState().ui.toast).not.toBeNull();
    store.getState().dismissToast(id);
    expect(store.getState().ui.toast).toBeNull();
  });

  it('G8: tuning runs camera and engine with the draft; draft edits reach engine.update', async () => {
    const { f, store, dispatch } = setup();
    dispatch({ type: 'NAV_CONFIG' });
    store.getState().setDraft('camera.fps', 60);
    dispatch({ type: 'TUNE_START' });
    expect(f.configured.at(-1)?.fps).toBe(60);
    await f.resolveCamera();
    store.getState().setDraft('detection.pixelDiffThreshold', 25);
    expect(f.started.at(-1)?.pixelDiffThreshold).toBe(10);
    expect(f.updated.at(-1)?.pixelDiffThreshold).toBe(25);
    store.getState().setDraft('detection.pixelDiffThreshold', 0); // invalid: not sent
    expect(f.updated).toHaveLength(1);
  });

  it('logs ignored events in debug mode only', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const f = fakeEffects();
    createAppStore({ effects: f.effects }).getState().dispatch({ type: 'STOP' });
    expect(debug).not.toHaveBeenCalled();
    createAppStore({ effects: f.effects, debug: true }).getState().dispatch({ type: 'STOP' });
    expect(debug).toHaveBeenCalledWith('[machine] welcome: ignored STOP');
    debug.mockRestore();
  });

  it('boots into a preset state and resumes a live camera without dispatching', async () => {
    const f = fakeEffects();
    const live = { ...initialState, screen: 'getReady' as const, camera: 'live' as const };
    const store = createAppStore({
      effects: f.effects,
      state: live,
      draft: setSetting(DEFAULTS, 'camera.fps', 60),
    });
    store.resumeLive();
    await f.resolveCamera();
    expect(f.started).toEqual([DEFAULTS.detection]);
    expect(store.getState().state).toBe(live);
    expect(store.getState().state.configDirty).toBe(false);
  });
});

describe('toCameraError', () => {
  it('maps DOMException names and keeps CameraErrors', () => {
    expect(toCameraError({ name: 'NotFoundError', message: 'x' }).kind).toBe('notFound');
    expect(toCameraError({ name: 'NotReadableError', message: 'x' }).kind).toBe('busy');
    expect(toCameraError({ name: 'OverconstrainedError', message: 'x' }).kind).toBe('overconstrained');
    expect(toCameraError({ name: 'Weird', message: 'x' }).kind).toBe('unknown');
    expect(toCameraError({ kind: 'insecure', message: 'http' })).toEqual({
      kind: 'insecure',
      message: 'http',
    });
    expect(toCameraError('boom')).toEqual({ kind: 'unknown', message: 'boom' });
  });
});

describe('lowFpsTracker', () => {
  it('needs 2 s below 20 fps and clears on recovery', () => {
    const t = lowFpsTracker();
    expect(t.update(15, 0)).toBe(false);
    expect(t.update(15, 1999)).toBe(false);
    expect(t.update(15, 2000)).toBe(true);
    expect(t.update(25, 2100)).toBe(false);
    expect(t.update(15, 2200)).toBe(false);
  });
});
