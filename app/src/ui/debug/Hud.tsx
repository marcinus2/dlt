// Debug HUDs (`?debug=1`, lazy). Speech latency probe (plan 6.6): MOTION_END frame time → utterance
// start, p90 over the last 20 passes, updates at pass rate. Engine HUD text: polled ≤ 4 Hz by
// Diagnostics, never per frame.
import type { DiagView } from '../../app/diagnostics.ts';
import { LATENCY_WINDOW } from '../../app/effects.ts';
import type { ControlReport, DetectionSettings, DetectorEvent } from '../../engine/types.ts';
import { useApp } from '../store.tsx';

export function SpeechLatencyHud() {
  const l = useApp((s) => s.ui.speechLatency);
  return (
    <p className="font-mono text-sm text-text-muted" data-testid="speech-latency">
      speech p90 {l ? `${Math.round(l.p90)} ms` : '-'} · last {l ? `${Math.round(l.last)} ms` : '-'} ·{' '}
      {l?.n ?? 0}/{LATENCY_WINDOW}
    </p>
  );
}

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const sec = (ms: number | null) => (ms === null ? '-' : `${(ms / 1000).toFixed(3)} s`);

export function eventLine(e: DetectorEvent): string {
  const at = (e.t / 1000).toFixed(3).padStart(9);
  switch (e.type) {
    case 'MOTION_START':
      return `${at}  MOTION START   Δstart ${sec(e.dStart)}`;
    case 'MOTION_END':
      return `${at}  MOTION END     dur ${Math.round(e.durationMs)} ms  peak ${pct(e.peakRatio)}  frames ${e.frames}  Δpeak ${sec(e.dPeak)}`;
    case 'SUPPRESSED':
      return `${at}  SUPPRESSED     (${e.reason})`;
    case 'REJECTED':
      return `${at}  REJECTED       long motion ${(e.durationMs / 1000).toFixed(1)} s`;
  }
}

const ctl = (r: ControlReport | null | undefined) =>
  r == null
    ? '-'
    : !r.supported
      ? 'not supported'
      : r.error
        ? `failed: ${r.error}`
        : `${r.mode} ${r.value ?? '?'}`;

/** Engine HUD lines (the PoC / M4 debug page layout). */
export function engineHud(v: DiagView, d: DetectionSettings, ratio: number, recorded: number): string {
  const stats = v.stats();
  const info = v.info();
  const timing = v.timing();
  const luma = v.luma();
  const controls = v.controls();
  return [
    `source    ${v.kind === 'file' ? 'file replay' : 'live (Test & calibrate)'}`,
    `phase     ${v.phase()}   detector ${v.state()}`,
    `ratio     ${pct(ratio)}`,
    `start/end ${pct(d.startRatio)} / ${pct(d.endRatio)}`,
    `fps       ${stats.fps.toFixed(1)}   delivered ${stats.deliveredFps === null ? '-' : stats.deliveredFps.toFixed(1)}   dropped ${stats.dropped}`,
    `ms/frame  p95 ${stats.msPerFrame.toFixed(1)}${timing ? `   roi ${timing.roi.toFixed(1)}  diff ${timing.diff.toFixed(1)}  guard ${timing.guard.toFixed(1)}` : ''}`,
    `frame     ${info ? `${info.width}x${info.height} @ ${info.fps ?? 'file'}${info.fpsFallback ? ' (fps fallback)' : ''}` : '-'}   t: ${stats.tSource}`,
    `roi px    ${luma ? `${luma.width}x${luma.height}` : '-'}   recorded ${recorded} frames`,
    `exposure  ${ctl(controls?.exposure)}   focus ${ctl(controls?.focus)}`,
  ].join('\n');
}
