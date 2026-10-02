import { Bug, ChevronDown, FlaskConical, RotateCcw } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import type { Settings } from '../../engine/types.ts';
import { GROUPS, type Group, getSetting, SCHEMA } from '../../settings/schema.ts';
import { isDefault } from '../../settings/validate.ts';
import { roiPreset, SettingField } from '../components/SettingField.tsx';
import { TopBar } from '../components/TopBar.tsx';
import { cx } from '../cx.ts';
import { useApp } from '../store.tsx';
import { UpdateToast } from './UpdateToast.tsx';

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
  children,
}: {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  level?: 'group' | 'advanced';
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
          onClick={() => setOpen(!open)}
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
        {children}
      </div>
    </section>
  );
}

function Fields({ group, advanced }: { group: Group; advanced: boolean }) {
  const draft = useApp((s) => s.draft);
  const errors = useApp((s) => s.errors);
  const setDraft = useApp((s) => s.setDraft);
  return SCHEMA.filter((f) => f.group === group && Boolean(f.advanced) === advanced).map((f) => (
    <SettingField
      key={f.key}
      meta={f}
      value={getSetting(draft, f.key)}
      error={errors[f.key]}
      changed={!isDefault(draft, f.key)}
      onChange={(v) => setDraft(f.key, v)}
    />
  ));
}

function Placeholder({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="my-3 flex items-start gap-3 rounded-card border border-dashed border-border bg-surface-2 px-4 py-3 text-text-muted">
      {icon}
      <div>{children}</div>
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
            >
              {g.id === 'calibration' && (
                <Placeholder
                  icon={<FlaskConical aria-hidden size={22} className="mt-0.5 shrink-0 text-accent" />}
                >
                  <p className="font-semibold text-text">Live preview, ratio meter and Calibrate</p>
                  <p className="text-sm">
                    Arrive with real detection. Calibrate will set the start and end ratio.
                  </p>
                  <button
                    type="button"
                    disabled
                    className="mt-2 min-h-12 rounded-full border border-border px-5 font-semibold text-text disabled:opacity-50"
                  >
                    Calibrate
                  </button>
                </Placeholder>
              )}
              <Fields group={g.id} advanced={false} />
              {hasAdvanced && (
                <Disclosure title="Advanced" level="advanced">
                  <Fields group={g.id} advanced />
                </Disclosure>
              )}
            </Disclosure>
          );
        })}
        {debug && (
          <Disclosure title="Diagnostics" summary="debug">
            <Placeholder icon={<Bug aria-hidden size={22} className="mt-0.5 shrink-0 text-accent" />}>
              <p className="font-semibold text-text">Ratio graph, diff view, HUD, event log</p>
              <p className="text-sm">File replay and CSV export arrive with the engine port.</p>
            </Placeholder>
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
