import { ChevronDown, LoaderCircle, Play, RotateCcw, Square } from 'lucide-react';
import { lazy, type ReactNode, Suspense, useEffect, useId, useState } from 'react';
import type { ControlReport, Settings } from '../../engine/types.ts';
import { GROUPS, type Group, getSetting, SCHEMA } from '../../settings/schema.ts';
import { isDefault } from '../../settings/validate.ts';
import { roiPreset, SettingField } from '../components/SettingField.tsx';
import { TopBar } from '../components/TopBar.tsx';
import { cx } from '../cx.ts';
import { useApp } from '../store.tsx';
import { UpdateToast } from './UpdateToast.tsx';

const Diagnostics = lazy(() => import('../debug/Diagnostics.tsx').then((m) => ({ default: m.Diagnostics })));
const TestCalibrate = lazy(() =>
  import('../config/TestCalibrate.tsx').then((m) => ({ default: m.TestCalibrate })),
);

const sec = (ms: number) => `${+(ms / 1000).toFixed(1)} s`;
const pct = (v: number) => `${+(v * 100).toPrecision(3)}%`;
const ROI_NAMES = { full: 'full frame', box: 'box', vLine: 'V line', hLine: 'H line' } as const;

/** One-line summary next to each group title (spec §4.3 wireframe). */
export function groupSummary(g: Group, s: Settings): string {
  switch (g) {
    case 'camera':
      return `${s.camera.facing === 'user' ? 'Front' : 'Rear'} · ${s.camera.fps} fps`;
    case 'detection': {
      const p = roiPreset(s.detection.roi);
      return `Threshold ${s.detection.pixelDiffThreshold} · ${pct(s.detection.startRatio)} · ${p ? ROI_NAMES[p] : 'custom region'}`;
    }
    case 'timing':
      return `Min lap ${sec(s.detection.cooldownMs)} · arming ${sec(s.detection.warmupMs)}`;
    case 'audio': {
      const on = [s.audio.beep && 'beeps', s.audio.voice && 'voice'].filter(Boolean).join(' · ');
      return on ? on[0]?.toUpperCase() + on.slice(1) : 'Off';
    }
    case 'performance':
      return `${s.detection.processingMaxSize} px`;
    case 'calibration':
      return `${sec(s.calibration.durationMs)} · margin ${s.calibration.k}`;
  }
}

function Disclosure({
  title,
  summary,
  defaultOpen = false,
  level = 'group',
  onToggle,
  mountWhenOpen = false,
  children,
}: {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  level?: 'group' | 'advanced';
  onToggle?: (open: boolean) => void;
  /** Render the content only while open (lazy panels with their own loops). */
  mountWhenOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const group = level === 'group';
  return (
    <section className={cx(group && 'rounded-card border border-border bg-surface')}>
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => {
            setOpen(!open);
            onToggle?.(!open);
          }}
          className={cx(
            'flex w-full items-center gap-3 text-left',
            group ? 'min-h-16 px-4 text-lg font-bold' : 'min-h-12 font-semibold text-text-muted',
          )}
        >
          <ChevronDown
            aria-hidden
            size={group ? 22 : 18}
            className={cx(
              'shrink-0 transition-transform motion-reduce:transition-none',
              !open && '-rotate-90',
            )}
          />
          <span className="text-text">{title}</span>
          {summary && (
            <span className="ml-auto truncate text-right text-sm font-medium text-text-muted">{summary}</span>
          )}
        </button>
      </h2>
      <div id={id} hidden={!open} className={cx(group && 'border-t border-border px-4 pb-2')}>
        {(open || !mountWhenOpen) && children}
      </div>
    </section>
  );
}

function Fields({ group, advanced }: { group: Group; advanced: boolean }) {
  const draft = useApp((s) => s.draft);
  const errors = useApp((s) => s.errors);
  const setDraft = useApp((s) => s.setDraft);
  const devices = useApp((s) => s.ui.cameras);
  return SCHEMA.filter((f) => f.group === group && Boolean(f.advanced) === advanced).map((f) => (
    <SettingField
      key={f.key}
      meta={f}
      value={getSetting(draft, f.key)}
      error={errors[f.key]}
      changed={!isDefault(draft, f.key)}
      onChange={(v) => setDraft(f.key, v)}
      devices={devices}
    />
  ));
}

function controlText(r: ControlReport | undefined, fmt: (v: number) => string): string {
  if (!r) return 'unknown';
  if (!r.supported) return 'not supported';
  if (r.error) return `supported, but failed: ${r.error}`;
  const value = r.value === undefined ? '' : ` ${fmt(r.value)}`;
  const range = r.range ? ` (range ${fmt(r.range.min)}–${fmt(r.range.max)})` : '';
  return `supported · ${r.mode ?? '?'}${value}${range}`;
}

/** Exposure / focus support of the selected camera (or what Automatic picked last), spec §2.1. */
function CameraReport() {
  const deviceId = useApp((s) => s.draft.camera.deviceId ?? s.ui.lastDeviceId);
  const caps = useApp((s) => (deviceId ? s.ui.cameraCaps[deviceId] : undefined));
  const manual = useApp((s) => s.draft.camera.exposureManual);
  if (!caps) {
    return (
      <p data-testid="camera-report" className="mt-2 mb-1 text-sm text-text-muted">
        Exposure and focus support show here once this camera has run (Get Ready or Test &amp; calibrate).
      </p>
    );
  }
  const rows = [
    { label: 'Exposure control', text: controlText(caps.exposure, (v) => String(Math.round(v))) },
    { label: 'Focus control', text: controlText(caps.focus, (v) => String(+v.toFixed(2))) },
  ];
  return (
    <div
      data-testid="camera-report"
      className="mt-2 mb-1 rounded-card bg-surface-2 px-3 py-2 text-sm wrap-anywhere"
    >
      <p className="font-semibold text-text">{caps.label || 'This camera'}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-text-muted">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <dt>{r.label}</dt>
            <dd className="text-text">{r.text}</dd>
          </div>
        ))}
      </dl>
      {manual && caps.exposure?.supported === false && (
        <p role="status" className="mt-1 font-semibold text-warn">
          Manual exposure is not supported on this camera; it keeps auto exposure.
        </p>
      )}
    </div>
  );
}

const Spinner = () => (
  <LoaderCircle aria-hidden className="my-3 animate-spin text-text-muted motion-reduce:animate-none" />
);

/** Start / Stop test runs the tuning camera (G7) inside the tap; the panel is a lazy chunk. */
function TestSection() {
  const tuning = useApp((s) => s.state.tuning);
  const dispatch = useApp((s) => s.dispatch);
  return (
    <div className="my-3 flex flex-col gap-3">
      <p className="text-sm text-text-muted">
        Live preview with these settings, a motion meter and <b className="text-text">Calibrate</b>, which
        watches the empty scene and sets the start and end ratio. Camera changes apply on the next start.
      </p>
      <button
        type="button"
        onClick={() => dispatch({ type: tuning ? 'TUNE_STOP' : 'TUNE_START' })}
        className={cx(
          'inline-flex min-h-12 items-center gap-2 self-start rounded-full px-5 font-semibold',
          tuning ? 'border border-border text-text hover:bg-surface-2' : 'bg-accent text-accent-ink',
        )}
      >
        {tuning ? <Square aria-hidden size={18} /> : <Play aria-hidden size={18} />}
        {tuning ? 'Stop test' : 'Start test'}
      </button>
      {tuning && (
        <Suspense
          fallback={
            <LoaderCircle aria-hidden className="animate-spin text-text-muted motion-reduce:animate-none" />
          }
        >
          <TestCalibrate />
        </Suspense>
      )}
    </div>
  );
}

/** Configuration (spec §3.1): all groups from the schema, Advanced collapsed, draft / Save / discard. */
export function Configuration() {
  const draft = useApp((s) => s.draft);
  const valid = useApp((s) => s.state.configValid);
  const errorCount = useApp((s) => Object.keys(s.errors).length);
  const resetDraft = useApp((s) => s.resetDraft);
  const debug = useApp((s) => s.debug);
  const voiceAvailable = useApp((s) => s.ui.voiceAvailable);
  const refreshCameras = useApp((s) => s.refreshCameras);
  const tuning = useApp((s) => s.state.tuning);
  const dispatch = useApp((s) => s.dispatch);
  useEffect(refreshCameras, [refreshCameras]);

  return (
    <>
      <TopBar />
      <main className="mx-auto flex w-full max-w-[720px] flex-col gap-3 px-safe py-4">
        <h1 className="px-1 text-2xl font-extrabold">Configuration</h1>
        {GROUPS.map((g) => {
          const hasAdvanced = SCHEMA.some((f) => f.group === g.id && f.advanced);
          return (
            <Disclosure
              key={g.id}
              title={g.title}
              summary={groupSummary(g.id, draft)}
              defaultOpen={g.id === 'camera' || g.id === 'detection'}
              onToggle={
                g.id === 'calibration'
                  ? (open) => !open && tuning && dispatch({ type: 'TUNE_STOP' })
                  : undefined
              }
            >
              {g.id === 'calibration' && <TestSection />}
              {g.id === 'audio' && !voiceAvailable && (
                <p role="status" className="mt-3 text-sm font-semibold text-warn">
                  Voice not available on this device — beeps only.
                </p>
              )}
              <Fields group={g.id} advanced={false} />
              {g.id === 'camera' && <CameraReport />}
              {hasAdvanced && (
                <Disclosure title="Advanced" level="advanced">
                  <Fields group={g.id} advanced />
                </Disclosure>
              )}
            </Disclosure>
          );
        })}
        {debug && (
          <Disclosure title="Diagnostics" summary="debug" mountWhenOpen>
            <Suspense fallback={<Spinner />}>
              <Diagnostics />
            </Suspense>
          </Disclosure>
        )}
        {!valid && (
          <p role="status" className="px-1 font-semibold text-danger-glow">
            Fix {errorCount === 1 ? 'the highlighted field' : `${errorCount} highlighted fields`} to save.
          </p>
        )}
        <div className="flex justify-center py-4">
          <button
            type="button"
            onClick={resetDraft}
            className="inline-flex min-h-12 items-center gap-2 rounded-full border border-border px-5 font-semibold text-text hover:bg-surface-2"
          >
            <RotateCcw aria-hidden size={18} />
            Reset to defaults
          </button>
        </div>
        <div className="pb-safe-bar">
          <UpdateToast />
        </div>
      </main>
    </>
  );
}
