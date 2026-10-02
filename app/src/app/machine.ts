// App state machine (spec §3.2 + plan §14 gaps). Pure: reduce(state, event) → { state, effects }.
import type { CameraError, Ms, PassEvent } from '../engine/types.ts';
import { applyPass, hasData, newSession, stop } from '../session/laps.ts';
import type { Cue, SessionData } from '../session/types.ts';

export type { Cue } from '../session/types.ts';

export type Screen = 'welcome' | 'getReady' | 'session' | 'paused' | 'config';
export type PauseReason = 'user' | 'hidden' | 'cameraLost';
export type CameraState = 'off' | 'starting' | 'live' | { error: CameraError };
export type Dialog =
  | null
  | { kind: 'leaveSession'; to: 'welcome' | 'config' }
  | { kind: 'endSession' }
  | { kind: 'discardConfig' };

export interface AppState {
  screen: Screen;
  camera: CameraState;
  session: SessionData | null;
  pauseReason: PauseReason | null;
  dialog: Dialog;
  configDirty: boolean;
  configValid: boolean;
  /** Test & calibrate panel open on Configuration (G7). */
  tuning: boolean;
}

export type AppEvent =
  | { type: 'NAV_NEW_SESSION' }
  | { type: 'NAV_CONFIG' }
  | { type: 'SAVE' }
  | { type: 'CONFIG_CHANGED'; dirty: boolean; valid: boolean }
  | { type: 'GET_READY' }
  | { type: 'CAMERA_LIVE' }
  | { type: 'CAMERA_ERROR'; error: CameraError }
  | { type: 'RETRY' }
  | { type: 'START' }
  | { type: 'ARMED' }
  | { type: 'PASS'; pass: PassEvent }
  | { type: 'STOP' }
  | { type: 'CONTINUE' }
  | { type: 'END' }
  | { type: 'APP_HIDDEN' }
  | { type: 'APP_VISIBLE' }
  | { type: 'CAMERA_LOST'; error: CameraError }
  | { type: 'TUNE_START' }
  | { type: 'TUNE_STOP' }
  | { type: 'CONFIRM' }
  | { type: 'CANCEL' };

export type Effect =
  | { type: 'camera.start'; draft?: true } // draft = tuning uses the draft settings (G8)
  | { type: 'camera.stop' }
  | { type: 'engine.start'; draft?: true }
  | { type: 'engine.reset' }
  | { type: 'engine.stop' }
  | { type: 'audio.unlock' }
  | { type: 'audio.cue'; cue: Cue; lapMs?: Ms }
  | { type: 'wakeLock.acquire' }
  | { type: 'wakeLock.release' }
  | { type: 'settings.commit' }
  | { type: 'settings.revert' };

export interface Result {
  state: AppState;
  effects: Effect[];
}

export const initialState: AppState = {
  screen: 'welcome',
  camera: 'off',
  session: null,
  pauseReason: null,
  dialog: null,
  configDirty: false,
  configValid: true,
  tuning: false,
};

const ENGINE_STOP: Effect = { type: 'engine.stop' };
const CAMERA_STOP: Effect = { type: 'camera.stop' };
const STOP_ALL: Effect[] = [ENGINE_STOP, CAMERA_STOP, { type: 'wakeLock.release' }];
const cue = (c: Cue, lapMs?: Ms): Effect =>
  lapMs === undefined ? { type: 'audio.cue', cue: c } : { type: 'audio.cue', cue: c, lapMs };

const same = (s: AppState): Result => ({ state: s, effects: [] });
const to = (state: AppState, effects: Effect[] = []): Result => ({ state, effects });

/** Events a dialog lets through: everything the user can't trigger behind a modal. */
const SYSTEM_EVENTS = new Set<AppEvent['type']>([
  'ARMED',
  'PASS',
  'CAMERA_LIVE',
  'CAMERA_ERROR',
  'CAMERA_LOST',
  'APP_HIDDEN',
  'APP_VISIBLE',
]);

export function reduce(s: AppState, e: AppEvent): Result {
  if (s.dialog === null) return reduceScreen(s, e);
  if (e.type === 'CANCEL') return to({ ...s, dialog: null });
  if (e.type === 'CONFIRM') return confirm(s);
  // Detection keeps running under a dialog (spec §3.2).
  return SYSTEM_EVENTS.has(e.type) ? reduceScreen(s, e) : same(s);
}

function confirm(s: AppState): Result {
  switch (s.dialog?.kind) {
    case 'leaveSession':
      return to(leaveTo(s, s.dialog.to), STOP_ALL);
    case 'endSession':
      return to(leaveTo(s, 'welcome'), [{ type: 'wakeLock.release' }]);
    case 'discardConfig':
      return to(leaveTo(s, 'welcome'), [{ type: 'settings.revert' }, ...stopTuning(s)]);
    default:
      return same(s);
  }
}

/** Fresh Welcome or Configuration: no session, camera off, clean config. */
function leaveTo(s: AppState, screen: 'welcome' | 'config'): AppState {
  return {
    ...s,
    screen,
    camera: 'off',
    session: null,
    pauseReason: null,
    dialog: null,
    configDirty: false,
    configValid: true,
    tuning: false,
  };
}

function stopTuning(s: AppState): Effect[] {
  return s.tuning || s.camera !== 'off' ? [ENGINE_STOP, CAMERA_STOP] : [];
}

function pause(s: AppState, reason: PauseReason, camera: CameraState = 'off'): Result {
  const session = s.session ? stop(s.session) : newSession();
  const effects: Effect[] = [ENGINE_STOP, CAMERA_STOP];
  if (reason !== 'user') effects.push(cue('paused'));
  return to({ ...s, screen: 'paused', pauseReason: reason, camera, session }, effects);
}

function leaveSession(s: AppState, target: 'welcome' | 'config'): Result {
  if (hasData(s.session)) return to({ ...s, dialog: { kind: 'leaveSession', to: target } });
  return to(leaveTo(s, target), STOP_ALL);
}

const isError = (c: CameraState): c is { error: CameraError } => typeof c === 'object';

function reduceScreen(s: AppState, e: AppEvent): Result {
  switch (s.screen) {
    case 'welcome':
      return welcome(s, e);
    case 'getReady':
      return getReady(s, e);
    case 'session':
      return session(s, e);
    case 'paused':
      return paused(s, e);
    case 'config':
      return config(s, e);
  }
}

function welcome(s: AppState, e: AppEvent): Result {
  switch (e.type) {
    case 'GET_READY':
      return to({ ...s, screen: 'getReady', camera: 'starting' }, [
        { type: 'audio.unlock' },
        { type: 'camera.start' },
        { type: 'wakeLock.acquire' },
      ]);
    case 'NAV_CONFIG':
      return to(leaveTo(s, 'config'));
    default:
      return same(s);
  }
}

function getReady(s: AppState, e: AppEvent): Result {
  switch (e.type) {
    case 'CAMERA_LIVE':
      return s.camera === 'starting' ? to({ ...s, camera: 'live' }, [{ type: 'engine.start' }]) : same(s);
    case 'CAMERA_ERROR':
      return s.camera === 'starting' ? to({ ...s, camera: { error: e.error } }) : same(s);
    case 'CAMERA_LOST':
      return s.camera === 'live'
        ? to({ ...s, camera: { error: e.error } }, [ENGINE_STOP, CAMERA_STOP])
        : same(s);
    case 'RETRY':
      return isError(s.camera) ? to({ ...s, camera: 'starting' }, [{ type: 'camera.start' }]) : same(s);
    case 'START':
      if (s.camera !== 'live') return same(s); // G9
      return to({ ...s, screen: 'session', session: newSession(), pauseReason: null }, [
        { type: 'audio.unlock' },
        { type: 'engine.reset' },
      ]);
    case 'APP_HIDDEN':
      return s.camera === 'off' ? same(s) : to({ ...s, camera: 'off' }, [ENGINE_STOP, CAMERA_STOP]);
    case 'APP_VISIBLE':
      return s.camera === 'off' ? to({ ...s, camera: 'starting' }, [{ type: 'camera.start' }]) : same(s);
    case 'NAV_NEW_SESSION':
      return to(leaveTo(s, 'welcome'), STOP_ALL);
    case 'NAV_CONFIG':
      return to(leaveTo(s, 'config'), STOP_ALL);
    default:
      return same(s); // incl. PASS (G3: the ROI flash is a UI signal)
  }
}

function session(s: AppState, e: AppEvent): Result {
  const data = s.session;
  if (!data) return same(s);
  switch (e.type) {
    case 'ARMED':
      return data.phase === 'arming'
        ? to({ ...s, session: { ...data, phase: 'ready' } }, [cue('armed')])
        : same(s);
    case 'PASS': {
      if (data.phase !== 'ready') return same(s); // G4
      const r = applyPass(data, e.pass.startT);
      const lap = r.cue === 'go' ? undefined : r.session.laps.at(-1)?.ms;
      return to({ ...s, session: r.session }, [cue(r.cue, lap)]);
    }
    case 'STOP':
      return pause(s, 'user');
    case 'APP_HIDDEN':
      return pause(s, 'hidden');
    case 'CAMERA_LOST':
      return pause(s, 'cameraLost', { error: e.error });
    case 'CAMERA_LIVE': // G1
      return s.camera === 'starting' ? to({ ...s, camera: 'live' }, [{ type: 'engine.start' }]) : same(s);
    case 'CAMERA_ERROR': // G2
      if (s.camera !== 'starting') return same(s);
      return to({
        ...s,
        screen: 'paused',
        pauseReason: 'cameraLost',
        camera: { error: e.error },
        session: stop(data),
      });
    case 'NAV_NEW_SESSION':
      return leaveSession(s, 'welcome');
    case 'NAV_CONFIG':
      return leaveSession(s, 'config');
    default:
      return same(s);
  }
}

function paused(s: AppState, e: AppEvent): Result {
  const data = s.session;
  if (!data) return same(s);
  switch (e.type) {
    case 'CONTINUE':
      return to(
        {
          ...s,
          screen: 'session',
          pauseReason: null,
          camera: 'starting',
          session: { ...stop(data), phase: 'arming' },
        },
        [{ type: 'audio.unlock' }, { type: 'camera.start' }],
      );
    case 'END':
      if (data.laps.length > 0) return to({ ...s, dialog: { kind: 'endSession' } });
      return to(leaveTo(s, 'welcome'), [{ type: 'wakeLock.release' }]);
    case 'NAV_NEW_SESSION':
      return leaveSession(s, 'welcome');
    case 'NAV_CONFIG':
      return leaveSession(s, 'config');
    default:
      return same(s); // incl. APP_HIDDEN/APP_VISIBLE (G5) and stale camera events
  }
}

function config(s: AppState, e: AppEvent): Result {
  switch (e.type) {
    case 'CONFIG_CHANGED':
      return e.dirty === s.configDirty && e.valid === s.configValid
        ? same(s)
        : to({ ...s, configDirty: e.dirty, configValid: e.valid });
    case 'SAVE':
      return s.configValid
        ? to(leaveTo(s, 'welcome'), [{ type: 'settings.commit' }, ...stopTuning(s)])
        : same(s);
    case 'NAV_NEW_SESSION':
      if (s.configDirty) return to({ ...s, dialog: { kind: 'discardConfig' } });
      return to(leaveTo(s, 'welcome'), stopTuning(s));
    case 'TUNE_START':
      return s.tuning
        ? same(s)
        : to({ ...s, tuning: true, camera: 'starting' }, [{ type: 'camera.start', draft: true }]);
    case 'TUNE_STOP':
      return s.tuning ? to({ ...s, tuning: false, camera: 'off' }, [ENGINE_STOP, CAMERA_STOP]) : same(s);
    default:
      return s.tuning ? tuningCamera(s, e) : same(s);
  }
}

/** Camera lifecycle of the Test & calibrate panel (G6–G8). */
function tuningCamera(s: AppState, e: AppEvent): Result {
  switch (e.type) {
    case 'CAMERA_LIVE':
      return s.camera === 'starting'
        ? to({ ...s, camera: 'live' }, [{ type: 'engine.start', draft: true }])
        : same(s);
    case 'CAMERA_ERROR':
      return s.camera === 'starting' ? to({ ...s, camera: { error: e.error } }) : same(s);
    case 'CAMERA_LOST':
      return s.camera === 'live'
        ? to({ ...s, camera: { error: e.error } }, [ENGINE_STOP, CAMERA_STOP])
        : same(s);
    case 'RETRY':
      return isError(s.camera)
        ? to({ ...s, camera: 'starting' }, [{ type: 'camera.start', draft: true }])
        : same(s);
    case 'APP_HIDDEN':
      return s.camera === 'off' ? same(s) : to({ ...s, camera: 'off' }, [ENGINE_STOP, CAMERA_STOP]);
    case 'APP_VISIBLE':
      return s.camera === 'off'
        ? to({ ...s, camera: 'starting' }, [{ type: 'camera.start', draft: true }])
        : same(s);
    default:
      return same(s);
  }
}
