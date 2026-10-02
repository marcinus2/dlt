// Sim controls (plan 2.6, sim mode only, lazy): SIMULATED strip, Pass (key P), auto passes,
// lap time, low fps, camera errors, drop camera, and the last cues (no audio before M6).
import { ChevronDown, Hand } from 'lucide-react';
import { useEffect, useReducer, useState, useSyncExternalStore } from 'react';
import type { SimControls } from '../../app/store.ts';
import type { CameraError } from '../../engine/types.ts';
import { cx } from '../cx.ts';
import { useApp } from '../store.tsx';
import { isInteractive } from '../useKeyboard.ts';

const LAP_CHOICES: { label: string; ms: number | null }[] = [
  { label: 'Random 10–15 s', ms: null },
  { label: '3 s', ms: 3000 },
  { label: '5 s', ms: 5000 },
  { label: '12 s', ms: 12000 },
  { label: '65 s', ms: 65000 },
];
const FAILURES: (CameraError['kind'] | 'none')[] = [
  'none',
  'permission',
  'notFound',
  'busy',
  'overconstrained',
  'insecure',
  'unknown',
];

function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex min-h-11 items-center justify-between gap-3">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className={cx(
          'h-7 w-12 rounded-full border-2 p-0.5',
          on ? 'border-warn bg-warn' : 'border-border bg-surface-2',
        )}
      >
        <span
          aria-hidden
          className={cx(
            'block size-5 rounded-full transition-transform',
            on ? 'translate-x-5 bg-bg' : 'bg-text-muted',
          )}
        />
      </button>
    </label>
  );
}

function Panel({ sim }: { sim: SimControls }) {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const log = useSyncExternalStore(sim.onLog, sim.log);
  const set =
    <T,>(fn: (v: T) => void) =>
    (v: T) => {
      fn(v);
      rerender();
    };
  return (
    <div className="flex w-72 flex-col gap-1 rounded-card border border-warn/60 bg-surface p-3 text-sm text-text shadow-lg">
      <Switch label="Auto passes" on={sim.auto()} onChange={set(sim.setAuto)} />
      <label className="flex min-h-11 items-center justify-between gap-3">
        Lap time
        <select
          value={String(sim.lapMs())}
          onChange={(e) => set(sim.setLapMs)(e.target.value === 'null' ? null : Number(e.target.value))}
          className="h-10 rounded-lg border border-border bg-surface-2 px-2"
        >
          {LAP_CHOICES.map((c) => (
            <option key={c.label} value={String(c.ms)}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <Switch label="Low fps" on={sim.lowFps()} onChange={set(sim.setLowFps)} />
      <label className="flex min-h-11 items-center justify-between gap-3">
        Camera start
        <select
          value={sim.cameraFailure() ?? 'none'}
          onChange={(e) =>
            set(sim.setCameraFailure)(
              e.target.value === 'none' ? null : (e.target.value as CameraError['kind']),
            )
          }
          className="h-10 rounded-lg border border-border bg-surface-2 px-2"
        >
          {FAILURES.map((f) => (
            <option key={f} value={f}>
              {f === 'none' ? 'works' : `fails: ${f}`}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={sim.dropCamera}
        className="min-h-11 rounded-full border border-border bg-surface-2 font-semibold"
      >
        Drop camera (track ended)
      </button>
      <div aria-live="off" className="mt-2 border-t border-border pt-2 font-mono text-xs text-text-muted">
        {log.length === 0 ? 'No cues yet' : log.map((l) => <p key={l.id}>{l.text}</p>)}
      </div>
    </div>
  );
}

export default function SimPanel() {
  const sim = useApp((s) => s.sim);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!sim) return;
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.key === 'p' || e.key === 'P') &&
        !e.repeat &&
        !e.ctrlKey &&
        !e.metaKey &&
        !isInteractive(e.target)
      ) {
        sim.pass();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sim]);

  if (!sim) return null;
  return (
    <div className="relative border-t border-warn/40 bg-warn/5 md:border-t-0 landscape:border-t-0 md:bg-transparent landscape:bg-transparent">
      <div className="mx-auto flex h-14 max-w-[1040px] items-center gap-2 px-safe short:h-12 md:pl-0 landscape:pl-0">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="inline-flex min-h-12 items-center gap-1 rounded-full px-2 text-xs font-extrabold tracking-widest text-warn"
        >
          SIMULATED
          <ChevronDown aria-hidden size={16} className={cx('transition-transform', open && 'rotate-180')} />
        </button>
        <span className="hidden truncate text-sm text-text-muted sm:inline md:hidden landscape:hidden">
          No real detection — passes come from here
        </span>
        <button
          type="button"
          onClick={sim.pass}
          aria-keyshortcuts="P"
          className="ml-auto inline-flex min-h-12 items-center gap-1.5 rounded-full bg-warn px-5 font-extrabold text-bg"
        >
          <Hand aria-hidden size={18} strokeWidth={2.5} />
          Pass
        </button>
      </div>
      {open && (
        <div className="absolute top-full right-2 z-30 mt-1 md:right-auto md:left-0 landscape:right-auto landscape:left-0">
          <Panel sim={sim} />
        </div>
      )}
    </div>
  );
}
