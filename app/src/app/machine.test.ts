import { describe, expect, it } from 'vitest';
import type { CameraError, PassEvent } from '../engine/types.ts';
import { type AppEvent, type AppState, type Effect, initialState, reduce } from './machine.ts';

const err: CameraError = { kind: 'permission', message: 'denied' };
const lost: CameraError = { kind: 'ended', message: 'track ended' };
const pass = (startT: number): AppEvent => ({
  type: 'PASS',
  pass: { startT, endT: startT + 200, peakT: startT + 100, peakRatio: 0.1 } satisfies PassEvent,
});

/** Runs events from `s` and returns the final state plus the effects of the last event. */
function run(s: AppState, ...events: AppEvent[]): { state: AppState; effects: Effect[] } {
  let r = { state: s, effects: [] as Effect[] };
  for (const e of events) r = reduce(r.state, e);
  return r;
}
const at = (...events: AppEvent[]) => run(initialState, ...events).state;

const getReadyLive = at({ type: 'GET_READY' }, { type: 'CAMERA_LIVE' });
const arming = run(getReadyLive, { type: 'START' }).state;
const standby = run(arming, { type: 'ARMED' }).state;
const timing = run(standby, pass(0)).state;
const withLaps = run(timing, pass(12000), pass(25000)).state; // laps 12.00, 13.00
const pausedWithLaps = run(withLaps, { type: 'STOP' }).state;
const pausedNoLaps = run(arming, { type: 'STOP' }).state;
const config = at({ type: 'NAV_CONFIG' });
const configDirty = run(config, { type: 'CONFIG_CHANGED', dirty: true, valid: true }).state;
const tuningLive = run(config, { type: 'TUNE_START' }, { type: 'CAMERA_LIVE' }).state;

const STOP_ALL: Effect[] = [{ type: 'engine.stop' }, { type: 'camera.stop' }, { type: 'wakeLock.release' }];

/** Every event type, for "unchanged on illegal events" checks. */
const ALL_EVENTS: AppEvent[] = [
  { type: 'NAV_NEW_SESSION' },
  { type: 'NAV_CONFIG' },
  { type: 'SAVE' },
  { type: 'CONFIG_CHANGED', dirty: true, valid: true },
  { type: 'GET_READY' },
  { type: 'CAMERA_LIVE' },
  { type: 'CAMERA_ERROR', error: err },
  { type: 'RETRY' },
  { type: 'START' },
  { type: 'ARMED' },
  pass(99999),
  { type: 'STOP' },
  { type: 'CONTINUE' },
  { type: 'END' },
  { type: 'APP_HIDDEN' },
  { type: 'APP_VISIBLE' },
  { type: 'CAMERA_LOST', error: lost },
  { type: 'TUNE_START' },
  { type: 'TUNE_STOP' },
  { type: 'CONFIRM' },
  { type: 'CANCEL' },
];

function expectIgnored(s: AppState, allowed: AppEvent['type'][]) {
  for (const e of ALL_EVENTS.filter((ev) => !allowed.includes(ev.type))) {
    const r = reduce(s, e);
    expect(r.state, e.type).toBe(s);
    expect(r.effects, e.type).toEqual([]);
  }
}

describe('Welcome', () => {
  it('GET_READY → GetReady/CameraStarting; unlock, camera.start, wakeLock.acquire', () => {
    const r = reduce(initialState, { type: 'GET_READY' });
    expect(r.state).toMatchObject({ screen: 'getReady', camera: 'starting' });
    expect(r.effects).toEqual([
      { type: 'audio.unlock' },
      { type: 'camera.start' },
      { type: 'wakeLock.acquire' },
    ]);
  });

  it('NAV_CONFIG → Configuration (clean), no effects', () => {
    const r = reduce(initialState, { type: 'NAV_CONFIG' });
    expect(r.state).toMatchObject({ screen: 'config', configDirty: false, configValid: true, tuning: false });
    expect(r.effects).toEqual([]);
  });

  it('NAV_NEW_SESSION is a no-op', () => {
    expect(reduce(initialState, { type: 'NAV_NEW_SESSION' }).state).toBe(initialState);
  });

  it('ignores every other event (incl. G5 APP_HIDDEN/APP_VISIBLE)', () => {
    expectIgnored(initialState, ['GET_READY', 'NAV_CONFIG']);
  });
});

describe('GetReady', () => {
  const starting = at({ type: 'GET_READY' });

  it('CAMERA_LIVE → Preview; engine.start', () => {
    const r = reduce(starting, { type: 'CAMERA_LIVE' });
    expect(r.state.camera).toBe('live');
    expect(r.effects).toEqual([{ type: 'engine.start' }]);
  });

  it('CAMERA_ERROR → CameraError(kind)', () => {
    const r = reduce(starting, { type: 'CAMERA_ERROR', error: err });
    expect(r.state.camera).toEqual({ error: err });
    expect(r.effects).toEqual([]);
  });

  it('RETRY → CameraStarting; camera.start', () => {
    const failed = run(starting, { type: 'CAMERA_ERROR', error: err }).state;
    const r = reduce(failed, { type: 'RETRY' });
    expect(r.state.camera).toBe('starting');
    expect(r.effects).toEqual([{ type: 'camera.start' }]);
  });

  it('RETRY without an error is ignored', () => {
    expect(reduce(getReadyLive, { type: 'RETRY' }).state).toBe(getReadyLive);
  });

  it('START with camera live → Session/Arming, empty session, standby; unlock, engine.reset', () => {
    const r = reduce(getReadyLive, { type: 'START' });
    expect(r.state.screen).toBe('session');
    expect(r.state.session).toEqual({
      laps: [],
      bestIdx: null,
      timing: { kind: 'standby' },
      phase: 'arming',
    });
    expect(r.effects).toEqual([{ type: 'audio.unlock' }, { type: 'engine.reset' }]);
  });

  it('G9: START while the camera is starting or in error is ignored', () => {
    expect(reduce(starting, { type: 'START' }).state).toBe(starting);
    const failed = run(starting, { type: 'CAMERA_ERROR', error: err }).state;
    expect(reduce(failed, { type: 'START' }).state).toBe(failed);
  });

  it('APP_HIDDEN stops camera and engine; APP_VISIBLE restarts the camera', () => {
    const hidden = reduce(getReadyLive, { type: 'APP_HIDDEN' });
    expect(hidden.state).toMatchObject({ screen: 'getReady', camera: 'off' });
    expect(hidden.effects).toEqual([{ type: 'engine.stop' }, { type: 'camera.stop' }]);
    const visible = reduce(hidden.state, { type: 'APP_VISIBLE' });
    expect(visible.state.camera).toBe('starting');
    expect(visible.effects).toEqual([{ type: 'camera.start' }]);
  });

  it('APP_VISIBLE without a prior hide is ignored', () => {
    expect(reduce(getReadyLive, { type: 'APP_VISIBLE' }).state).toBe(getReadyLive);
  });

  it('NAV_NEW_SESSION → Welcome; stop all', () => {
    const r = reduce(getReadyLive, { type: 'NAV_NEW_SESSION' });
    expect(r.state).toEqual(initialState);
    expect(r.effects).toEqual(STOP_ALL);
  });

  it('NAV_CONFIG → Configuration; stop all', () => {
    const r = reduce(getReadyLive, { type: 'NAV_CONFIG' });
    expect(r.state).toMatchObject({ screen: 'config', camera: 'off', configDirty: false });
    expect(r.effects).toEqual(STOP_ALL);
  });

  it('G3: PASS leaves the state unchanged', () => {
    expect(reduce(getReadyLive, pass(100)).state).toBe(getReadyLive);
  });

  it('CAMERA_LOST while live → error card; stops engine and camera', () => {
    const r = reduce(getReadyLive, { type: 'CAMERA_LOST', error: lost });
    expect(r.state.camera).toEqual({ error: lost });
    expect(r.effects).toEqual([{ type: 'engine.stop' }, { type: 'camera.stop' }]);
  });

  it('ignores illegal events', () => {
    expectIgnored(getReadyLive, ['START', 'APP_HIDDEN', 'NAV_NEW_SESSION', 'NAV_CONFIG', 'CAMERA_LOST']);
  });
});

describe('Session', () => {
  it('ARMED → StandBy; cue armed', () => {
    const r = reduce(arming, { type: 'ARMED' });
    expect(r.state.session?.phase).toBe('ready');
    expect(r.effects).toEqual([{ type: 'audio.cue', cue: 'armed' }]);
  });

  it('ARMED when already armed is ignored', () => {
    expect(reduce(standby, { type: 'ARMED' }).state).toBe(standby);
  });

  it('PASS in standby → Timing with refT = pass.startT; cue go', () => {
    const r = reduce(standby, pass(5000));
    expect(r.state.session?.timing).toEqual({ kind: 'running', refT: 5000 });
    expect(r.state.session?.laps).toEqual([]);
    expect(r.effects).toEqual([{ type: 'audio.cue', cue: 'go' }]);
  });

  it('PASS while running → lap appended, refT = pass.startT; cue best for a new best', () => {
    const r = reduce(timing, pass(12340));
    expect(r.state.session?.laps).toEqual([{ n: 1, ms: 12340, at: 12340 }]);
    expect(r.state.session?.timing).toEqual({ kind: 'running', refT: 12340 });
    expect(r.effects).toEqual([{ type: 'audio.cue', cue: 'best', lapMs: 12340 }]);
  });

  it('PASS while running → cue lap when not a best', () => {
    const r = reduce(withLaps, pass(40000)); // 15 s
    expect(r.effects).toEqual([{ type: 'audio.cue', cue: 'lap', lapMs: 15000 }]);
  });

  it('G4: PASS while arming is ignored', () => {
    expect(reduce(arming, pass(100)).state).toBe(arming);
  });

  it('STOP → Paused(user), timing standby, laps kept; engine.stop, camera.stop (wake lock kept)', () => {
    const r = reduce(withLaps, { type: 'STOP' });
    expect(r.state).toMatchObject({ screen: 'paused', pauseReason: 'user', camera: 'off' });
    expect(r.state.session?.timing).toEqual({ kind: 'standby' });
    expect(r.state.session?.laps).toHaveLength(2);
    expect(r.effects).toEqual([{ type: 'engine.stop' }, { type: 'camera.stop' }]);
  });

  it('STOP during Arming → Paused, no data change', () => {
    const r = reduce(arming, { type: 'STOP' });
    expect(r.state.screen).toBe('paused');
    expect(r.state.session?.laps).toEqual([]);
  });

  it('APP_HIDDEN → Paused(hidden); as STOP + cue paused', () => {
    const r = reduce(withLaps, { type: 'APP_HIDDEN' });
    expect(r.state).toMatchObject({ screen: 'paused', pauseReason: 'hidden' });
    expect(r.state.session?.timing).toEqual({ kind: 'standby' });
    expect(r.effects).toEqual([
      { type: 'engine.stop' },
      { type: 'camera.stop' },
      { type: 'audio.cue', cue: 'paused' },
    ]);
  });

  it('CAMERA_LOST → Paused(cameraLost, error); as STOP + cue paused', () => {
    const r = reduce(withLaps, { type: 'CAMERA_LOST', error: lost });
    expect(r.state).toMatchObject({ screen: 'paused', pauseReason: 'cameraLost', camera: { error: lost } });
    expect(r.effects).toEqual([
      { type: 'engine.stop' },
      { type: 'camera.stop' },
      { type: 'audio.cue', cue: 'paused' },
    ]);
  });

  it('NAV_NEW_SESSION / NAV_CONFIG with data → dialog leaveSession(to)', () => {
    expect(run(timing, { type: 'NAV_NEW_SESSION' })).toEqual({
      state: { ...timing, dialog: { kind: 'leaveSession', to: 'welcome' } },
      effects: [],
    });
    expect(reduce(withLaps, { type: 'NAV_CONFIG' }).state.dialog).toEqual({
      kind: 'leaveSession',
      to: 'config',
    });
  });

  it('NAV_NEW_SESSION / NAV_CONFIG without data → target, session null; stop all', () => {
    const a = reduce(standby, { type: 'NAV_NEW_SESSION' });
    expect(a.state).toEqual(initialState);
    expect(a.effects).toEqual(STOP_ALL);
    const b = reduce(standby, { type: 'NAV_CONFIG' });
    expect(b.state).toMatchObject({ screen: 'config', session: null });
    expect(b.effects).toEqual(STOP_ALL);
  });

  it('G1: CAMERA_LIVE after CONTINUE → camera live; engine.start', () => {
    const continued = run(pausedWithLaps, { type: 'CONTINUE' }).state;
    const r = reduce(continued, { type: 'CAMERA_LIVE' });
    expect(r.state).toMatchObject({ screen: 'session', camera: 'live' });
    expect(r.state.session?.phase).toBe('arming');
    expect(r.effects).toEqual([{ type: 'engine.start' }]);
  });

  it('G2: CAMERA_ERROR after CONTINUE → back to Paused(cameraLost) with the error', () => {
    const continued = run(pausedWithLaps, { type: 'CONTINUE' }).state;
    const r = reduce(continued, { type: 'CAMERA_ERROR', error: err });
    expect(r.state).toMatchObject({ screen: 'paused', pauseReason: 'cameraLost', camera: { error: err } });
    expect(r.state.session?.laps).toHaveLength(2);
    expect(r.effects).toEqual([]);
  });

  it('CAMERA_LIVE / CAMERA_ERROR when the camera is already live are ignored', () => {
    expect(reduce(timing, { type: 'CAMERA_LIVE' }).state).toBe(timing);
    expect(reduce(timing, { type: 'CAMERA_ERROR', error: err }).state).toBe(timing);
  });

  it('ignores illegal events', () => {
    expectIgnored(timing, ['PASS', 'STOP', 'APP_HIDDEN', 'CAMERA_LOST', 'NAV_NEW_SESSION', 'NAV_CONFIG']);
  });
});

describe('Paused', () => {
  it('CONTINUE → Session/Arming, laps kept, standby; unlock, camera.start', () => {
    const r = reduce(pausedWithLaps, { type: 'CONTINUE' });
    expect(r.state).toMatchObject({ screen: 'session', camera: 'starting', pauseReason: null });
    expect(r.state.session).toMatchObject({ phase: 'arming', timing: { kind: 'standby' } });
    expect(r.state.session?.laps).toHaveLength(2);
    expect(r.effects).toEqual([{ type: 'audio.unlock' }, { type: 'camera.start' }]);
  });

  it('CONTINUE clears a camera error and retries', () => {
    const lostState = run(withLaps, { type: 'CAMERA_LOST', error: lost }).state;
    const r = reduce(lostState, { type: 'CONTINUE' });
    expect(r.state.camera).toBe('starting');
    expect(r.effects).toContainEqual({ type: 'camera.start' });
  });

  it('END with laps ≥ 1 → dialog endSession', () => {
    const r = reduce(pausedWithLaps, { type: 'END' });
    expect(r.state.dialog).toEqual({ kind: 'endSession' });
    expect(r.effects).toEqual([]);
  });

  it('END with 0 laps → Welcome, session null; wakeLock.release', () => {
    const r = reduce(pausedNoLaps, { type: 'END' });
    expect(r.state).toEqual(initialState);
    expect(r.effects).toEqual([{ type: 'wakeLock.release' }]);
  });

  it('CONFIRM (endSession) → Welcome, session null; wakeLock.release', () => {
    const r = run(pausedWithLaps, { type: 'END' }, { type: 'CONFIRM' });
    expect(r.state).toEqual(initialState);
    expect(r.effects).toEqual([{ type: 'wakeLock.release' }]);
  });

  it('NAV_* with data → dialog leaveSession; without data → target with stop all', () => {
    expect(reduce(pausedWithLaps, { type: 'NAV_CONFIG' }).state.dialog).toEqual({
      kind: 'leaveSession',
      to: 'config',
    });
    const r = reduce(pausedNoLaps, { type: 'NAV_NEW_SESSION' });
    expect(r.state).toEqual(initialState);
    expect(r.effects).toEqual(STOP_ALL);
    expect(reduce(pausedNoLaps, { type: 'NAV_CONFIG' }).state.screen).toBe('config');
  });

  it('G5: APP_HIDDEN / APP_VISIBLE change nothing', () => {
    expect(reduce(pausedWithLaps, { type: 'APP_HIDDEN' }).state).toBe(pausedWithLaps);
    expect(reduce(pausedWithLaps, { type: 'APP_VISIBLE' }).state).toBe(pausedWithLaps);
  });

  it('stale camera events (start cancelled by STOP) are ignored', () => {
    const stoppedWhileStarting = run(pausedWithLaps, { type: 'CONTINUE' }, { type: 'STOP' }).state;
    expect(stoppedWhileStarting.camera).toBe('off');
    expect(reduce(stoppedWhileStarting, { type: 'CAMERA_LIVE' }).state).toBe(stoppedWhileStarting);
    expect(reduce(stoppedWhileStarting, { type: 'CAMERA_ERROR', error: err }).state).toBe(
      stoppedWhileStarting,
    );
  });

  it('ignores illegal events', () => {
    expectIgnored(pausedWithLaps, ['CONTINUE', 'END', 'NAV_NEW_SESSION', 'NAV_CONFIG']);
  });
});

describe('Dialogs', () => {
  const leaveDialog = run(withLaps, { type: 'NAV_NEW_SESSION' }).state;

  it('CONFIRM (leaveSession) → target, session null; stop all', () => {
    const a = reduce(leaveDialog, { type: 'CONFIRM' });
    expect(a.state).toEqual(initialState);
    expect(a.effects).toEqual(STOP_ALL);
    const toConfig = run(pausedWithLaps, { type: 'NAV_CONFIG' }, { type: 'CONFIRM' });
    expect(toConfig.state).toMatchObject({ screen: 'config', session: null, dialog: null, camera: 'off' });
    expect(toConfig.effects).toEqual(STOP_ALL);
  });

  it('CANCEL (any dialog) → unchanged, dialog null; no effects', () => {
    for (const s of [
      leaveDialog,
      run(pausedWithLaps, { type: 'END' }).state,
      run(configDirty, { type: 'NAV_NEW_SESSION' }).state,
    ]) {
      const r = reduce(s, { type: 'CANCEL' });
      expect(r.state).toEqual({ ...s, dialog: null });
      expect(r.effects).toEqual([]);
    }
  });

  it('passes are still recorded while a dialog is open', () => {
    const r = reduce(leaveDialog, pass(40000));
    expect(r.state.dialog).toEqual(leaveDialog.dialog);
    expect(r.state.session?.laps).toHaveLength(3);
    expect(r.effects).toEqual([{ type: 'audio.cue', cue: 'lap', lapMs: 15000 }]);
  });

  it('auto-pause under a dialog keeps the dialog', () => {
    const r = reduce(leaveDialog, { type: 'APP_HIDDEN' });
    expect(r.state).toMatchObject({ screen: 'paused', dialog: { kind: 'leaveSession', to: 'welcome' } });
  });

  it('user events behind a dialog are ignored', () => {
    for (const e of [{ type: 'STOP' }, { type: 'NAV_CONFIG' }, { type: 'NAV_NEW_SESSION' }] as AppEvent[]) {
      expect(reduce(leaveDialog, e).state).toBe(leaveDialog);
    }
  });

  it('CONFIRM / CANCEL without a dialog are ignored', () => {
    expect(reduce(timing, { type: 'CONFIRM' }).state).toBe(timing);
    expect(reduce(timing, { type: 'CANCEL' }).state).toBe(timing);
  });
});

describe('Configuration', () => {
  it('CONFIG_CHANGED → dirty / valid flags', () => {
    const r = reduce(config, { type: 'CONFIG_CHANGED', dirty: true, valid: false });
    expect(r.state).toMatchObject({ configDirty: true, configValid: false });
    expect(r.effects).toEqual([]);
    expect(reduce(r.state, { type: 'CONFIG_CHANGED', dirty: true, valid: false }).state).toBe(r.state);
  });

  it('SAVE with a valid draft → Welcome; settings.commit', () => {
    const r = reduce(configDirty, { type: 'SAVE' });
    expect(r.state).toEqual(initialState);
    expect(r.effects).toEqual([{ type: 'settings.commit' }]);
  });

  it('SAVE with an invalid draft is ignored', () => {
    const invalid = run(config, { type: 'CONFIG_CHANGED', dirty: true, valid: false }).state;
    expect(reduce(invalid, { type: 'SAVE' }).state).toBe(invalid);
  });

  it('NAV_NEW_SESSION clean → Welcome', () => {
    const r = reduce(config, { type: 'NAV_NEW_SESSION' });
    expect(r.state).toEqual(initialState);
    expect(r.effects).toEqual([]);
  });

  it('NAV_NEW_SESSION dirty → dialog discardConfig', () => {
    expect(reduce(configDirty, { type: 'NAV_NEW_SESSION' }).state.dialog).toEqual({ kind: 'discardConfig' });
  });

  it('CONFIRM (discardConfig) → Welcome; settings.revert', () => {
    const r = run(configDirty, { type: 'NAV_NEW_SESSION' }, { type: 'CONFIRM' });
    expect(r.state).toEqual(initialState);
    expect(r.effects).toEqual([{ type: 'settings.revert' }]);
  });

  it('ignores illegal events (incl. G5 APP_HIDDEN/APP_VISIBLE with tuning off)', () => {
    expectIgnored(config, ['CONFIG_CHANGED', 'SAVE', 'NAV_NEW_SESSION', 'TUNE_START']);
  });
});

describe('Configuration tuning (G6–G8)', () => {
  it('G7: TUNE_START → camera.start with the draft; CAMERA_LIVE → engine.start with the draft', () => {
    const a = reduce(config, { type: 'TUNE_START' });
    expect(a.state).toMatchObject({ tuning: true, camera: 'starting' });
    expect(a.effects).toEqual([{ type: 'camera.start', draft: true }]);
    const b = reduce(a.state, { type: 'CAMERA_LIVE' });
    expect(b.state.camera).toBe('live');
    expect(b.effects).toEqual([{ type: 'engine.start', draft: true }]);
  });

  it('G7: TUNE_STOP → stop engine and camera', () => {
    const r = reduce(tuningLive, { type: 'TUNE_STOP' });
    expect(r.state).toMatchObject({ tuning: false, camera: 'off' });
    expect(r.effects).toEqual([{ type: 'engine.stop' }, { type: 'camera.stop' }]);
  });

  it('G7: TUNE_START twice / TUNE_STOP when off are ignored', () => {
    expect(reduce(tuningLive, { type: 'TUNE_START' }).state).toBe(tuningLive);
    expect(reduce(config, { type: 'TUNE_STOP' }).state).toBe(config);
  });

  it('G7: leaving Configuration stops tuning (SAVE, NAV clean, discard)', () => {
    const stop: Effect[] = [{ type: 'engine.stop' }, { type: 'camera.stop' }];
    expect(reduce(tuningLive, { type: 'SAVE' }).effects).toEqual([{ type: 'settings.commit' }, ...stop]);
    expect(reduce(tuningLive, { type: 'NAV_NEW_SESSION' }).effects).toEqual(stop);
    const dirty = run(
      tuningLive,
      { type: 'CONFIG_CHANGED', dirty: true, valid: true },
      { type: 'NAV_NEW_SESSION' },
    );
    const r = reduce(dirty.state, { type: 'CONFIRM' });
    expect(r.state).toEqual(initialState);
    expect(r.effects).toEqual([{ type: 'settings.revert' }, ...stop]);
  });

  it('G6: APP_HIDDEN stops tuning; APP_VISIBLE resumes while the panel is open', () => {
    const hidden = reduce(tuningLive, { type: 'APP_HIDDEN' });
    expect(hidden.state).toMatchObject({ tuning: true, camera: 'off' });
    expect(hidden.effects).toEqual([{ type: 'engine.stop' }, { type: 'camera.stop' }]);
    const visible = reduce(hidden.state, { type: 'APP_VISIBLE' });
    expect(visible.state.camera).toBe('starting');
    expect(visible.effects).toEqual([{ type: 'camera.start', draft: true }]);
  });

  it('G6: APP_VISIBLE does not resume once the panel is closed', () => {
    const closed = run(tuningLive, { type: 'APP_HIDDEN' }, { type: 'TUNE_STOP' }).state;
    expect(reduce(closed, { type: 'APP_VISIBLE' }).state).toBe(closed);
  });

  it('tuning camera errors: CAMERA_ERROR → error, RETRY → restart, CAMERA_LOST → error + stop', () => {
    const starting = run(config, { type: 'TUNE_START' }).state;
    const failed = reduce(starting, { type: 'CAMERA_ERROR', error: err }).state;
    expect(failed.camera).toEqual({ error: err });
    expect(reduce(failed, { type: 'RETRY' }).effects).toEqual([{ type: 'camera.start', draft: true }]);
    const r = reduce(tuningLive, { type: 'CAMERA_LOST', error: lost });
    expect(r.state.camera).toEqual({ error: lost });
    expect(r.effects).toEqual([{ type: 'engine.stop' }, { type: 'camera.stop' }]);
  });

  it('ignores illegal events while tuning', () => {
    expectIgnored(tuningLive, [
      'CONFIG_CHANGED',
      'SAVE',
      'NAV_NEW_SESSION',
      'TUNE_STOP',
      'APP_HIDDEN',
      'CAMERA_LOST',
    ]);
  });
});
