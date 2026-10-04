// Test & calibrate (plan 7.4, G7): live preview of the draft ROI with the pass flash, a ratio meter
// and Calibrate. Lazy chunk, mounted only while tuning. Per-frame samples never reach React state:
// the meter and progress bar are written through refs from requestAnimationFrame.
import { Check, Crosshair, LoaderCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { type Calibration, createCalibrator } from '../../engine/calibration.ts';
import type { Roi } from '../../engine/types.ts';
import { field, type RatioField, type SettingKey } from '../../settings/schema.ts';
import { CameraErrorCard } from '../components/CameraErrorCard.tsx';
import { CameraLayer, useVideoSize } from '../components/CameraLayer.tsx';
import { RoiOverlay } from '../components/RoiOverlay.tsx';
import { useApp } from '../store.tsx';
import { meterPos } from './meter.ts';

const pct = (v: number) => `${+(v * 100).toPrecision(3)}%`;

/** Calibrated ratio → the field's range, 3 significant digits. */
function fitRatio(key: SettingKey, v: number): number {
  const f = field(key) as RatioField;
  return Number(Math.min(f.max, Math.max(f.min, v)).toPrecision(3));
}

/** What the engine processes: the draft ROI as of the last valid draft (only those reach it). */
function useEngineRoi(): Roi {
  const draft = useApp((s) => s.draft.detection.roi);
  const valid = useApp((s) => s.state.configValid);
  const last = useRef(draft);
  if (valid) last.current = draft;
  return last.current;
}

function Preview() {
  const camera = useApp((s) => s.state.camera);
  const dispatch = useApp((s) => s.dispatch);
  const flash = useApp((s) => s.ui.passFlash);
  const facing = useApp((s) => s.ui.cameraInfo?.facing ?? s.draft.camera.facing);
  const fps = useApp((s) => s.ui.stats?.fps || s.ui.cameraInfo?.fps || null);
  const fallback = useApp((s) => s.draft.camera.width / s.draft.camera.height);
  const roi = useEngineRoi();
  const frame = useVideoSize();

  if (typeof camera === 'object')
    return <CameraErrorCard error={camera.error} onRetry={() => dispatch({ type: 'RETRY' })} />;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex h-[min(50dvh,420px)] w-full items-center justify-center">
        <CameraLayer
          mirrored={facing === 'user'}
          aspect={frame ? frame.width / frame.height : fallback}
          fit
          className="max-h-full"
        >
          <RoiOverlay roi={roi} flash={flash} frame={frame} />
        </CameraLayer>
      </div>
      <p
        className="inline-flex items-center gap-2 text-sm font-semibold text-text"
        data-testid="tuning-health"
      >
        {camera === 'live' ? (
          <>
            <Check aria-hidden size={16} strokeWidth={3} className="text-best" />
            {fps ? `${Math.round(fps)} fps · ` : ''}
            {facing === 'environment' ? 'rear camera' : 'front camera'} · wave a hand through the region
          </>
        ) : (
          <>
            <LoaderCircle aria-hidden size={16} className="animate-spin motion-reduce:animate-none" />
            Starting camera…
          </>
        )}
      </p>
    </div>
  );
}

/** Current ratio on a log scale with start (accent) and end (muted) markers. */
function RatioMeter() {
  const onSample = useApp((s) => s.onSample);
  const start = useApp((s) => s.draft.detection.startRatio);
  const end = useApp((s) => s.draft.detection.endRatio);
  const bar = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const value = useRef<HTMLSpanElement>(null);
  const startRef = useRef(start);
  startRef.current = start;

  useEffect(() => {
    let ratio = 0;
    let fresh = false;
    let raf = 0;
    const off = onSample((x) => {
      ratio = x.ratio;
      fresh = true;
    });
    const draw = () => {
      if (fresh && bar.current && fill.current && value.current) {
        fresh = false;
        const over = ratio >= startRef.current;
        fill.current.style.transform = `scaleX(${meterPos(ratio)})`;
        fill.current.classList.toggle('bg-best', over);
        fill.current.classList.toggle('bg-accent', !over);
        value.current.textContent = pct(ratio);
        bar.current.setAttribute('aria-valuenow', String(+(ratio * 100).toPrecision(3)));
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      off();
      cancelAnimationFrame(raf);
    };
  }, [onSample]);

  const marker = (r: number, cls: string, label: string) => (
    <span
      title={`${label} ${pct(r)}`}
      className={`absolute inset-y-[-4px] w-0.5 ${cls}`}
      style={{ left: `${meterPos(r) * 100}%` }}
    />
  );
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-semibold text-text">Motion in the region</span>
        <span ref={value} data-testid="ratio-value" className="font-mono text-text">
          –
        </span>
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: a native <meter> can't hold the start/end marks */}
      <div
        ref={bar}
        role="meter"
        aria-label="Motion ratio"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={0}
        className="relative h-4 rounded-full bg-surface-2"
      >
        <div ref={fill} className="absolute inset-0 origin-left scale-x-0 rounded-full bg-accent" />
        {marker(end, 'bg-text-muted', 'End')}
        {marker(start, 'bg-text', 'Start')}
      </div>
      <p className="text-sm text-text-muted">
        Start {pct(start)} · end {pct(end)}. A pass needs the bar past the start mark.
      </p>
    </div>
  );
}

type Outcome = { kind: 'done'; c: Calibration } | { kind: 'failed' } | null;

function Calibrate() {
  const live = useApp((s) => s.state.camera === 'live');
  const cal = useApp((s) => s.draft.calibration);
  const calValid = useApp((s) => !s.errors['calibration.durationMs'] && !s.errors['calibration.k']);
  const setDraftValues = useApp((s) => s.setDraftValues);
  const onSample = useApp((s) => s.onSample);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const progress = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!running || !live) {
      setRunning(false);
      return;
    }
    const calibrator = createCalibrator(cal.durationMs, cal.k);
    let p = 0;
    let raf = 0;
    const off = onSample((x) => {
      const step = calibrator.add(x.t, x.ratio, x.global);
      if (!step.done) {
        p = step.progress;
        return;
      }
      off();
      setRunning(false);
      if (!step.result) return setOutcome({ kind: 'failed' });
      const startRatio = fitRatio('detection.startRatio', step.result.startRatio);
      const endRatio = Math.min(startRatio, fitRatio('detection.endRatio', step.result.endRatio));
      setDraftValues({ 'detection.startRatio': startRatio, 'detection.endRatio': endRatio });
      setOutcome({ kind: 'done', c: { ...step.result, startRatio, endRatio } });
    });
    const draw = () => {
      if (progress.current) progress.current.style.transform = `scaleX(${p})`;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      off();
      cancelAnimationFrame(raf);
    };
  }, [running, live, cal.durationMs, cal.k, onSample, setDraftValues]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!live || !calValid}
          onClick={() => {
            setOutcome(null);
            setRunning(!running);
          }}
          className="inline-flex min-h-12 items-center gap-2 rounded-full border border-accent px-5 font-semibold text-accent disabled:opacity-40"
        >
          <Crosshair aria-hidden size={18} />
          {running ? 'Cancel' : 'Calibrate'}
        </button>
        <span className="text-sm text-text-muted">
          Watches the empty scene for {+(cal.durationMs / 1000).toFixed(1)} s.
        </span>
      </div>
      {running && (
        <div role="status" className="flex flex-col gap-1">
          <p className="font-semibold text-text">Calibrating — keep the scene still…</p>
          <div className="h-2 rounded-full bg-surface-2">
            <div ref={progress} className="h-full origin-left scale-x-0 rounded-full bg-accent" />
          </div>
        </div>
      )}
      {outcome?.kind === 'failed' && (
        <p role="status" className="font-semibold text-warn">
          Calibration failed: no usable frames. Try again.
        </p>
      )}
      {outcome?.kind === 'done' && (
        <div role="status" data-testid="calibration-result" className="text-sm">
          <p className="font-semibold text-text">
            Start ratio {pct(outcome.c.startRatio)} · end ratio {pct(outcome.c.endRatio)} — Save to keep them.
          </p>
          <p className="text-text-muted">
            Idle noise over {outcome.c.n} frames: mean {pct(outcome.c.mean)} · σ {pct(outcome.c.sigma)} · max{' '}
            {pct(outcome.c.max)}
          </p>
          {outcome.c.hint && <p className="font-semibold text-warn">Idle noise is high: {HINT}</p>}
        </div>
      )}
    </div>
  );
}

const HINT = 'check the lighting, exposure and region.';

export function TestCalibrate() {
  return (
    <div className="flex flex-col gap-4" data-testid="test-calibrate">
      <Preview />
      <RatioMeter />
      <Calibrate />
    </div>
  );
}
