// State gallery presets (plan 2.11): each preset is a sequence of real machine events plus UI
// flags, so every state shown is one the reducer can actually reach.
import { type AppEvent, type AppState, initialState, reduce } from '../../app/machine.ts';
import { STORAGE_TOAST, type UiState } from '../../app/store.ts';
import type { CameraError, Settings } from '../../engine/types.ts';
import { DEFAULTS, setSetting } from '../../settings/schema.ts';
import { equalSettings, isValid } from '../../settings/validate.ts';

export interface Preset {
  id: string;
  title: string;
  group: string;
  events: AppEvent[];
  ui?: Partial<UiState>;
  draft?: Settings;
}

const GET_READY: AppEvent[] = [{ type: 'GET_READY' }];
const LIVE: AppEvent[] = [...GET_READY, { type: 'CAMERA_LIVE' }];
const ARMING: AppEvent[] = [...LIVE, { type: 'START' }];
const STANDBY: AppEvent[] = [...ARMING, { type: 'ARMED' }];

/** Passes for the given lap times (s), starting with the reference pass. */
function laps(...secs: number[]): AppEvent[] {
  const pass = (startT: number): AppEvent => ({
    type: 'PASS',
    pass: { t: startT + 180, startT, endT: startT + 180, peakT: startT + 90, peakRatio: 0.1 },
  });
  let t = 10_000;
  const events = [pass(t)];
  for (const s of secs) {
    t += s * 1000;
    events.push(pass(t));
  }
  return events;
}

const SOME_LAPS = laps(14.02, 13.4, 11.98, 12.87, 12.34);
const errorOf = (kind: CameraError['kind']): CameraError => ({ kind, message: `Simulated ${kind} error` });
const CAMERA_KINDS: CameraError['kind'][] = [
  'permission',
  'notFound',
  'busy',
  'overconstrained',
  'insecure',
  'ended',
  'unknown',
];
const dirtyDraft = setSetting(setSetting(DEFAULTS, 'camera.fps', 60), 'detection.cooldownMs', 2500);
const invalidDraft = setSetting(
  setSetting(dirtyDraft, 'detection.pixelDiffThreshold', 250),
  'detection.endRatio',
  0.05,
);

export const PRESETS: Preset[] = [
  { id: 'welcome', title: 'Welcome', group: 'Start', events: [] },
  {
    id: 'installPrompt',
    title: 'Install link (Android)',
    group: 'Start',
    events: [],
    ui: { install: 'prompt' },
  },
  { id: 'installHint', title: 'iOS install hint', group: 'Start', events: [], ui: { install: 'iosHint' } },
  { id: 'updateToast', title: 'Update toast', group: 'Start', events: [], ui: { updateAvailable: true } },
  {
    id: 'storageToast',
    title: 'Storage toast',
    group: 'Start',
    events: [],
    ui: { toast: { id: 1, text: STORAGE_TOAST } },
  },

  { id: 'cameraStarting', title: 'Camera starting', group: 'Get Ready', events: GET_READY },
  { id: 'getReady', title: 'Preview live', group: 'Get Ready', events: LIVE },
  { id: 'getReadyLowFps', title: 'Low frame rate', group: 'Get Ready', events: LIVE, ui: { lowFps: true } },
  ...CAMERA_KINDS.map((kind) => ({
    id: `cameraError-${kind}`,
    title: `Camera error: ${kind}`,
    group: 'Get Ready',
    events: [...GET_READY, { type: 'CAMERA_ERROR', error: errorOf(kind) } as AppEvent],
  })),

  { id: 'arming', title: 'Arming', group: 'Session', events: ARMING },
  { id: 'standby', title: 'Stand-by', group: 'Session', events: STANDBY },
  { id: 'lap1Running', title: 'Lap 1 running', group: 'Session', events: [...STANDBY, ...laps()] },
  { id: 'timing', title: 'Timing', group: 'Session', events: [...STANDBY, ...SOME_LAPS] },
  {
    id: 'latestBest',
    title: 'Latest is best',
    group: 'Session',
    events: [...STANDBY, ...laps(14.02, 13.4, 12.87, 11.98)],
  },
  { id: 'longLap', title: 'Lap over a minute', group: 'Session', events: [...STANDBY, ...laps(12.3, 65.34)] },
  {
    id: 'laps600',
    title: '600 laps',
    group: 'Session',
    events: [...STANDBY, ...laps(...Array.from({ length: 600 }, (_, i) => 10 + ((i * 37) % 50) / 10))],
  },
  {
    id: 'sessionLowFps',
    title: 'Low frame rate',
    group: 'Session',
    events: [...STANDBY, ...SOME_LAPS],
    ui: { lowFps: true },
  },
  {
    id: 'audioLocked',
    title: 'Tap to enable sound',
    group: 'Session',
    events: [...STANDBY, ...SOME_LAPS],
    ui: { audioLocked: true },
  },
  {
    id: 'wakeLock',
    title: 'Wake-lock banner',
    group: 'Session',
    events: [...STANDBY, ...SOME_LAPS],
    ui: { wakeLockBanner: true },
  },

  {
    id: 'pausedUser',
    title: 'Paused (STOP)',
    group: 'Paused',
    events: [...STANDBY, ...SOME_LAPS, { type: 'STOP' }],
  },
  {
    id: 'pausedHidden',
    title: 'Paused (background)',
    group: 'Paused',
    events: [...STANDBY, ...SOME_LAPS, { type: 'APP_HIDDEN' }],
  },
  {
    id: 'pausedCameraLost',
    title: 'Paused (camera lost)',
    group: 'Paused',
    events: [...STANDBY, ...SOME_LAPS, { type: 'CAMERA_LOST', error: errorOf('ended') }],
  },
  { id: 'pausedNoLaps', title: 'Paused, no laps', group: 'Paused', events: [...ARMING, { type: 'STOP' }] },

  {
    id: 'dialogLeave',
    title: 'End session? (New session)',
    group: 'Dialogs',
    events: [...STANDBY, ...SOME_LAPS, { type: 'NAV_NEW_SESSION' }],
  },
  {
    id: 'dialogLeaveRunning',
    title: 'End session? (lap in progress)',
    group: 'Dialogs',
    events: [...STANDBY, ...laps(), { type: 'NAV_CONFIG' }],
  },
  {
    id: 'dialogEnd',
    title: 'End session? (END)',
    group: 'Dialogs',
    events: [...STANDBY, ...SOME_LAPS, { type: 'STOP' }, { type: 'END' }],
  },
  {
    id: 'dialogDiscard',
    title: 'Discard changes?',
    group: 'Dialogs',
    events: [{ type: 'NAV_CONFIG' }, { type: 'NAV_NEW_SESSION' }],
    draft: dirtyDraft,
  },

  { id: 'configClean', title: 'Clean', group: 'Configuration', events: [{ type: 'NAV_CONFIG' }] },
  {
    id: 'configDirty',
    title: 'Dirty',
    group: 'Configuration',
    events: [{ type: 'NAV_CONFIG' }],
    draft: dirtyDraft,
  },
  {
    id: 'configInvalid',
    title: 'Invalid',
    group: 'Configuration',
    events: [{ type: 'NAV_CONFIG' }],
    draft: invalidDraft,
  },
  {
    id: 'configUpdate',
    title: 'Update toast',
    group: 'Configuration',
    events: [{ type: 'NAV_CONFIG' }],
    ui: { updateAvailable: true },
  },
];

export function findPreset(id: string | null): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}

/** Machine state for a preset; a draft is applied as CONFIG_CHANGED right after NAV_CONFIG. */
export function presetState(p: Preset): AppState {
  let s = initialState;
  for (const e of p.events) {
    s = reduce(s, e).state;
    if (e.type === 'NAV_CONFIG' && p.draft) {
      const draft = p.draft;
      s = reduce(s, {
        type: 'CONFIG_CHANGED',
        dirty: !equalSettings(draft, DEFAULTS),
        valid: isValid(draft),
      }).state;
    }
  }
  return s;
}
