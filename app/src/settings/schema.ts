// Settings metadata (spec §1.3): one table = defaults, ranges, groups, help, form layout.
// Defaults are the current PoC values; detection defaults are frozen in M5 (plan 5.3).
import type { Roi, Settings } from '../engine/types.ts';

export type Group = 'camera' | 'detection' | 'timing' | 'audio' | 'performance' | 'calibration';

export const GROUPS: readonly { id: Group; title: string }[] = [
  { id: 'camera', title: 'Camera' },
  { id: 'detection', title: 'Detection' },
  { id: 'timing', title: 'Timing filters' },
  { id: 'audio', title: 'Audio' },
  { id: 'performance', title: 'Performance' },
  { id: 'calibration', title: 'Test & calibrate' },
];

type Leaf<T> = {
  [G in keyof T]: T[G] extends object ? `${G & string}.${keyof T[G] & string}` : never;
}[keyof T];
/** Dotted path of every setting, e.g. `camera.fps`. `detection.roi` is one field. */
export type SettingKey = Leaf<Omit<Settings, 'version'>>;

interface Base {
  key: SettingKey;
  label: string;
  group: Group;
  help: string;
  advanced?: true;
}
export type NumberField = Base & {
  type: 'number';
  default: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  int?: true;
};
/** A fraction 0–1, shown as %. `log` = logarithmic slider. */
export type RatioField = Base & {
  type: 'ratio';
  default: number;
  min: number;
  max: number;
  step: number;
  log?: true;
};
export type SelectField = Base & {
  type: 'select';
  default: number;
  options: readonly number[];
  unit?: string;
};
export type BoolField = Base & { type: 'bool'; default: boolean };
export type EnumField = Base & {
  type: 'enum';
  default: string;
  options: readonly { value: string; label: string }[];
};
export type DeviceField = Base & { type: 'device'; default: null };
export type RoiField = Base & { type: 'roi'; default: Roi };
export type FieldMeta =
  | NumberField
  | RatioField
  | SelectField
  | BoolField
  | EnumField
  | DeviceField
  | RoiField;

export const ROI_PRESETS = {
  full: { x: 0, y: 0, width: 1, height: 1 },
  box: { x: 0.2, y: 0.25, width: 0.6, height: 0.5 },
  vLine: { x: 0.425, y: 0.1, width: 0.15, height: 0.8 }, // virtual finish line
  hLine: { x: 0.1, y: 0.425, width: 0.8, height: 0.15 },
} as const satisfies Record<string, Roi>;
export type RoiPreset = keyof typeof ROI_PRESETS;
export const ROI_MIN_SIZE = 0.05;

export const SCHEMA: readonly FieldMeta[] = [
  // Camera
  {
    key: 'camera.facing',
    type: 'enum',
    label: 'Camera',
    group: 'camera',
    default: 'user',
    options: [
      { value: 'user', label: 'Front' },
      { value: 'environment', label: 'Rear' },
    ],
    help: 'Front when the phone lies face-up on the floor and films the ceiling.',
  },
  {
    key: 'camera.deviceId',
    type: 'device',
    label: 'Device',
    group: 'camera',
    default: null,
    help: 'A specific camera. Automatic picks one by the facing above.',
  },
  {
    key: 'camera.fps',
    type: 'select',
    label: 'Frame rate',
    group: 'camera',
    default: 30,
    options: [15, 24, 30, 60],
    unit: 'fps',
    help: 'Requested frame rate. Higher = finer timing, more CPU.',
  },
  {
    key: 'camera.exposureManual',
    type: 'bool',
    label: 'Manual exposure',
    group: 'camera',
    default: true,
    help: 'Locks a short exposure so the camera keeps full fps (mostly Android).',
  },
  {
    key: 'camera.exposureTime',
    type: 'number',
    label: 'Exposure time',
    group: 'camera',
    default: 100,
    min: 1,
    max: 1000,
    step: 10,
    unit: '×100 µs',
    int: true,
    help: '100 = 10 ms. Clamped to what the camera supports.',
  },
  {
    key: 'camera.width',
    type: 'number',
    label: 'Width',
    group: 'camera',
    advanced: true,
    default: 240,
    min: 120,
    max: 1920,
    step: 40,
    unit: 'px',
    int: true,
    help: 'Requested camera width. Cost grows with frame size.',
  },
  {
    key: 'camera.height',
    type: 'number',
    label: 'Height',
    group: 'camera',
    advanced: true,
    default: 480,
    min: 120,
    max: 1920,
    step: 40,
    unit: 'px',
    int: true,
    help: 'Requested camera height.',
  },
  {
    key: 'camera.fpsExact',
    type: 'bool',
    label: 'Exact frame rate',
    group: 'camera',
    advanced: true,
    default: false,
    help: 'Insist on the frame rate. Falls back to the best available if the camera can’t.',
  },
  {
    key: 'camera.focusLock',
    type: 'bool',
    label: 'Lock focus',
    group: 'camera',
    advanced: true,
    default: false,
    help: 'Freezes autofocus at its current distance (Android).',
  },
  // Detection
  {
    key: 'detection.pixelDiffThreshold',
    type: 'number',
    label: 'Pixel threshold',
    group: 'detection',
    default: 10,
    min: 1,
    max: 100,
    step: 1,
    int: true,
    help: 'Brightness change (0–255) for a pixel to count as moving.',
  },
  {
    key: 'detection.startRatio',
    type: 'ratio',
    label: 'Start ratio',
    group: 'detection',
    default: 0.02,
    min: 0.0005,
    max: 0.5,
    step: 0.0005,
    log: true,
    help: 'Share of the region that must change to start a pass. Set by Calibrate.',
  },
  {
    key: 'detection.endRatio',
    type: 'ratio',
    label: 'End ratio',
    group: 'detection',
    default: 0.01,
    min: 0.0001,
    max: 0.5,
    step: 0.0005,
    log: true,
    help: 'Motion ends below this share. At most the start ratio.',
  },
  {
    key: 'detection.roi',
    type: 'roi',
    label: 'Region',
    group: 'detection',
    default: ROI_PRESETS.full,
    help: 'Part of the picture watched for passes.',
  },
  {
    key: 'detection.brightnessNormalize',
    type: 'bool',
    label: 'Normalize brightness',
    group: 'detection',
    advanced: true,
    default: false,
    help: 'Cancels whole-picture brightness shifts (lights, auto-exposure).',
  },
  {
    key: 'detection.globalGuard',
    type: 'bool',
    label: 'Global guard',
    group: 'detection',
    advanced: true,
    default: false,
    help: 'Ignores frames where the picture outside the region changes too. Costs CPU.',
  },
  {
    key: 'detection.globalGuardRatio',
    type: 'ratio',
    label: 'Global guard ratio',
    group: 'detection',
    advanced: true,
    default: 0.2,
    min: 0.01,
    max: 1,
    step: 0.01,
    help: 'Change outside the region that marks a frame as global.',
  },
  // Timing filters
  {
    key: 'detection.cooldownMs',
    type: 'number',
    label: 'Minimum lap time',
    group: 'timing',
    default: 1500,
    min: 0,
    max: 30000,
    step: 100,
    unit: 'ms',
    int: true,
    help: 'Cooldown = minimum lap time. Passes sooner than this are ignored.',
  },
  {
    key: 'detection.warmupMs',
    type: 'number',
    label: 'Arming time',
    group: 'timing',
    default: 1500,
    min: 0,
    max: 10000,
    step: 100,
    unit: 'ms',
    int: true,
    help: 'Detection is off this long after START and CONTINUE.',
  },
  {
    key: 'detection.minMotionMs',
    type: 'number',
    label: 'Min motion',
    group: 'timing',
    default: 30,
    min: 0,
    max: 500,
    step: 10,
    unit: 'ms',
    int: true,
    help: 'Motion must last this long to count. 0 = one frame.',
  },
  {
    key: 'detection.endHoldMs',
    type: 'number',
    label: 'End hold',
    group: 'timing',
    default: 60,
    min: 0,
    max: 1000,
    step: 10,
    unit: 'ms',
    int: true,
    help: 'Quiet time that ends a pass.',
  },
  {
    key: 'detection.maxMotionMs',
    type: 'number',
    label: 'Max motion',
    group: 'timing',
    default: 3000,
    min: 200,
    max: 30000,
    step: 100,
    unit: 'ms',
    int: true,
    help: 'Longer motion is rejected (a person, not a drone).',
  },
  // Audio
  {
    key: 'audio.beep',
    type: 'bool',
    label: 'Beeps',
    group: 'audio',
    default: true,
    help: 'Tones on arm, go and lap.',
  },
  {
    key: 'audio.voice',
    type: 'bool',
    label: 'Spoken lap times',
    group: 'audio',
    default: true,
    help: 'Says each lap time, e.g. “12.34”.',
  },
  {
    key: 'audio.announceBest',
    type: 'bool',
    label: 'Announce best',
    group: 'audio',
    default: true,
    help: 'Says “Best” before a new best lap.',
  },
  // Performance
  {
    key: 'detection.processingMaxSize',
    type: 'number',
    label: 'Processing size',
    group: 'performance',
    default: 320,
    min: 80,
    max: 640,
    step: 16,
    unit: 'px',
    int: true,
    help: 'Longest side of the processed region. Lower = faster.',
  },
  {
    key: 'detection.readbackHint',
    type: 'bool',
    label: 'CPU readback',
    group: 'performance',
    default: true,
    help: 'Off uses GPU canvases, which can be faster on some Android phones.',
  },
  {
    key: 'detection.resetGapMs',
    type: 'number',
    label: 'Gap reset',
    group: 'performance',
    advanced: true,
    default: 250,
    min: 50,
    max: 2000,
    step: 50,
    unit: 'ms',
    int: true,
    help: 'A frame gap longer than this restarts the comparison.',
  },
  // Test & calibrate
  {
    key: 'calibration.durationMs',
    type: 'number',
    label: 'Calibration time',
    group: 'calibration',
    default: 3000,
    min: 1000,
    max: 30000,
    step: 500,
    unit: 'ms',
    int: true,
    help: 'How long Calibrate watches the empty scene.',
  },
  {
    key: 'calibration.k',
    type: 'number',
    label: 'Calibration margin',
    group: 'calibration',
    default: 5,
    min: 1,
    max: 20,
    step: 1,
    help: 'Noise multiplier for the start ratio. Higher = less sensitive.',
  },
];

export const FIELDS: ReadonlyMap<SettingKey, FieldMeta> = new Map(SCHEMA.map((f) => [f.key, f]));

export function field(key: SettingKey): FieldMeta {
  const f = FIELDS.get(key);
  if (!f) throw new Error(`unknown setting ${key}`);
  return f;
}

type Groups = Omit<Settings, 'version'>;

export function getSetting(s: Settings, key: SettingKey): unknown {
  const [g, k] = key.split('.') as [keyof Groups, string];
  return (s[g] as unknown as Record<string, unknown>)[k];
}

/** Immutable set of one field. */
export function setSetting(s: Settings, key: SettingKey, value: unknown): Settings {
  const [g, k] = key.split('.') as [keyof Groups, string];
  return { ...s, [g]: { ...s[g], [k]: value } };
}

function buildDefaults(): Settings {
  const s = { version: 2, camera: {}, detection: {}, calibration: {}, audio: {} } as Settings;
  return SCHEMA.reduce(
    (acc, f) => setSetting(acc, f.key, f.type === 'roi' ? { ...f.default } : f.default),
    s,
  );
}

export const DEFAULTS: Settings = buildDefaults();
