// Minimal engine debug page (plan 4.10, `?debug=engine`): video, ratio, phase, HUD, event log,
// file replay, CSV export. Unstyled on purpose; the Configuration Diagnostics replace it in M7.
// The HUD is polled at 4 Hz, never rendered per frame.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DebugRig } from '../../app/debug-rig.ts';
import type { CameraInfo, DetectorEvent } from '../../engine/types.ts';
import { buildLabel } from '../build-info.ts';

const HUD_MS = 250;
const LOG_LINES = 200;

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const sec = (ms: number | null) => (ms === null ? '-' : `${(ms / 1000).toFixed(3)} s`);

function eventLine(e: DetectorEvent): string {
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

function download(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function hud(rig: DebugRig, info: CameraInfo | null): string {
  const { phase, state, sample, stats, timing, size, frames, controls } = rig.snapshot();
  const d = rig.settings.detection;
  const ctl = (r: typeof controls.exposure) =>
    r === null
      ? 'auto'
      : !r.supported
        ? 'not supported'
        : r.error
          ? `failed: ${r.error}`
          : `${r.mode} ${r.value ?? '?'}`;
  return [
    `phase     ${phase}   detector ${state}`,
    `ratio     ${pct(sample.ratio)}   global ${pct(sample.globalRatio)}${sample.global ? ' (neutral)' : ''}`,
    `start/end ${pct(d.startRatio)} / ${pct(d.endRatio)}`,
    `fps       ${stats.fps.toFixed(1)}   delivered ${stats.deliveredFps === null ? '-' : stats.deliveredFps.toFixed(1)}   dropped ${stats.dropped}`,
    `ms/frame  p95 ${stats.msPerFrame.toFixed(1)}   roi ${timing.roi.toFixed(1)}  diff ${timing.diff.toFixed(1)}  guard ${timing.guard.toFixed(1)}`,
    `source    ${info ? `${info.width}x${info.height} @ ${info.fps ?? 'file'}${info.fpsFallback ? ' (fps fallback)' : ''}` : '-'}   t: ${stats.tSource}`,
    `roi px    ${size.width}x${size.height}   recorded ${frames} frames`,
    `exposure  ${ctl(controls.exposure)}   focus ${ctl(controls.focus)}`,
  ].join('\n');
}

const button = 'min-h-11 rounded border border-border px-3 font-semibold text-text hover:bg-surface-2';

export function DebugPage({ rig }: { rig: DebugRig }) {
  const videoBox = useRef<HTMLDivElement>(null);
  const info = useRef<CameraInfo | null>(null);
  const [text, setText] = useState('');
  const [log, setLog] = useState<{ id: number; text: string }[]>([]);
  const [message, setMessage] = useState('');
  const logId = useRef(0);

  const add = useCallback(
    (line: string) => setLog((l) => [{ id: ++logId.current, text: line }, ...l].slice(0, LOG_LINES)),
    [],
  );

  useEffect(() => {
    const box = videoBox.current;
    rig.video.className = 'max-h-[50dvh] max-w-full bg-surface';
    box?.append(rig.video);
    const offEvent = rig.onEvent((e) => add(eventLine(e)));
    const offEnded = rig.onEnded((e) => setMessage(`${e.kind}: ${e.message}`));
    const timer = setInterval(() => setText(hud(rig, info.current)), HUD_MS);
    return () => {
      offEvent();
      offEnded();
      clearInterval(timer);
      rig.stop();
    };
  }, [rig, add]);

  const run = async (start: () => Promise<CameraInfo>, label: string) => {
    setMessage('');
    try {
      const i = await start();
      info.current = i;
      add(`${label} ${i.width}x${i.height} @ ${i.fps ?? 'file'}`);
    } catch (err) {
      const e = err as { kind?: string; message?: string };
      setMessage(`${e.kind ?? 'error'}: ${e.message ?? String(err)}`);
    }
  };

  return (
    <main className="flex min-h-dvh flex-col gap-3 bg-bg p-4 font-mono text-sm text-text">
      <h1 className="text-lg font-bold">Engine debug · {buildLabel}</h1>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} onClick={() => run(rig.startCamera, 'CAMERA')}>
          Start camera
        </button>
        <label className={`${button} inline-flex cursor-pointer items-center`}>
          Replay file
          <input
            type="file"
            accept="video/*"
            className="sr-only"
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              if (f) run(() => rig.startFile(f), `FILE ${f.name}`);
              e.currentTarget.value = '';
            }}
          />
        </label>
        <button
          type="button"
          className={button}
          onClick={() => {
            rig.restart();
            setLog([]);
          }}
        >
          Restart detection
        </button>
        <button
          type="button"
          className={button}
          onClick={() => {
            rig.stop();
            info.current = null;
          }}
        >
          Stop
        </button>
        <button
          type="button"
          className={button}
          onClick={() => download('dronelap-events.csv', rig.eventsCsv())}
        >
          Events CSV
        </button>
        <button
          type="button"
          className={button}
          onClick={() => download('dronelap-frames.csv', rig.framesCsv())}
        >
          Frames CSV
        </button>
        <a className={`${button} inline-flex items-center`} href="./">
          App
        </a>
      </div>
      {message && (
        <p role="alert" className="text-danger-glow">
          {message}
        </p>
      )}
      <div ref={videoBox} />
      <pre className="overflow-x-auto rounded border border-border bg-surface p-2">{text}</pre>
      <ol
        aria-label="Event log"
        className="max-h-[40dvh] overflow-y-auto rounded border border-border bg-surface p-2"
      >
        {log.map((l) => (
          <li key={l.id} className="whitespace-pre">
            {l.text}
          </li>
        ))}
      </ol>
    </main>
  );
}
