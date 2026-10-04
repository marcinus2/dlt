// Configuration › Diagnostics (plan 7.5, `?debug=1`), lazy chunk mounted only while open: sound check,
// speech latency, engine HUD, ratio graph, diff view, event log, file replay, CSV export. The HUD and
// log refresh at 4 Hz; graph and diff draw on their own canvases.
import { Download, FileVideo, RotateCcw, Square, Volume2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Diagnostics as Diag } from '../../app/diagnostics.ts';
import type { DetectorEvent, MotionSample } from '../../engine/types.ts';
import type { Cue } from '../../session/types.ts';
import { useApp } from '../store.tsx';
import { DiffView } from './DiffView.tsx';
import { engineHud, eventLine, SpeechLatencyHud } from './Hud.tsx';
import { RatioGraph } from './RatioGraph.tsx';

const HUD_MS = 250;
const LOG_LINES = 200;
const BUTTON =
  'inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 font-semibold text-text hover:bg-surface-2 disabled:opacity-40';

const SOUND_CHECK: { cue: Cue; label: string }[] = [
  { cue: 'armed', label: 'Armed' },
  { cue: 'go', label: 'Go' },
  { cue: 'lap', label: 'Lap' },
  { cue: 'best', label: 'Best' },
  { cue: 'paused', label: 'Paused' },
];

/** Play each cue with the draft audio toggles (plan 6.2). */
function SoundCheck() {
  const testCue = useApp((s) => s.testCue);
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-2 font-semibold text-text">
        <Volume2 aria-hidden size={20} className="text-accent" />
        Sound check
      </p>
      <div className="flex flex-wrap gap-2">
        {SOUND_CHECK.map(({ cue, label }) => (
          <button key={cue} type="button" onClick={() => testCue(cue)} className={BUTTON}>
            {label}
          </button>
        ))}
      </div>
      <SpeechLatencyHud />
    </div>
  );
}

function download(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function EnginePanel({ diag }: { diag: Diag }) {
  const detection = useApp((s) => s.draft.detection);
  const tuning = useApp((s) => s.state.tuning);
  const [hud, setHud] = useState('');
  const [log, setLog] = useState<{ id: number; text: string }[]>([]);
  const [replaying, setReplaying] = useState(false);
  const [message, setMessage] = useState('');
  const videoBox = useRef<HTMLDivElement>(null);
  const settings = useRef(detection);
  settings.current = detection;

  const subscribe = useCallback((cb: (s: Readonly<MotionSample>) => void) => diag.onSample(cb), [diag]);
  const luma = useCallback(() => diag.view().luma(), [diag]);

  useEffect(() => {
    let ratio = 0;
    let lines: { id: number; text: string }[] = [];
    let id = 0;
    let logDirty = false;
    const offSample = diag.onSample((s) => {
      ratio = s.ratio;
    });
    const offEvent = diag.onEvent((e: DetectorEvent) => {
      lines = [{ id: ++id, text: eventLine(e) }, ...lines].slice(0, LOG_LINES);
      logDirty = true;
    });
    const timer = setInterval(() => {
      setHud(engineHud(diag.view(), settings.current, ratio, diag.recorded()));
      if (logDirty) {
        logDirty = false;
        setLog(lines);
      }
    }, HUD_MS);
    return () => {
      offSample();
      offEvent();
      clearInterval(timer);
    };
  }, [diag]);

  useEffect(() => {
    const box = videoBox.current;
    diag.fileVideo.className = 'max-h-64 max-w-full rounded-card';
    box?.append(diag.fileVideo);
    return () => diag.fileVideo.remove();
  }, [diag]);

  const replay = async (f: File) => {
    setMessage('');
    try {
      await diag.replay(f);
      setReplaying(true);
    } catch (err) {
      const e = err as { kind?: string; message?: string };
      setMessage(`${e.kind ?? 'error'}: ${e.message ?? String(err)}`);
      setReplaying(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-muted">
        {replaying
          ? 'Replaying a file with the draft detection settings.'
          : tuning
            ? 'Watching the Test & calibrate camera.'
            : 'Start Test & calibrate above, or replay a video file.'}
      </p>
      <div className="flex flex-wrap gap-2">
        <label className={`${BUTTON} cursor-pointer`}>
          <FileVideo aria-hidden size={18} />
          Replay file
          <input
            type="file"
            accept="video/*"
            className="sr-only"
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              if (f) replay(f);
              e.currentTarget.value = '';
            }}
          />
        </label>
        {replaying && (
          <>
            <button type="button" className={BUTTON} onClick={() => diag.restartReplay()}>
              <RotateCcw aria-hidden size={18} />
              Restart detection
            </button>
            <button
              type="button"
              className={BUTTON}
              onClick={() => {
                diag.stopReplay();
                setReplaying(false);
              }}
            >
              <Square aria-hidden size={18} />
              Stop replay
            </button>
          </>
        )}
        <button
          type="button"
          className={BUTTON}
          onClick={() => download('dronelap-events.csv', diag.eventsCsv())}
        >
          <Download aria-hidden size={18} />
          Events CSV
        </button>
        <button
          type="button"
          className={BUTTON}
          onClick={() => download('dronelap-frames.csv', diag.framesCsv())}
        >
          <Download aria-hidden size={18} />
          Frames CSV
        </button>
        <button
          type="button"
          className={BUTTON}
          onClick={() => {
            diag.clearRecording();
            setLog([]);
          }}
        >
          Clear
        </button>
      </div>
      {message && (
        <p role="alert" className="font-semibold text-danger-glow">
          {message}
        </p>
      )}
      <div ref={videoBox} hidden={!replaying} />
      <pre
        data-testid="engine-hud"
        className="overflow-x-auto rounded-card bg-surface-2 p-2 font-mono text-xs"
      >
        {hud}
      </pre>
      <RatioGraph subscribe={subscribe} start={detection.startRatio} end={detection.endRatio} />
      <DiffView subscribe={subscribe} luma={luma} threshold={detection.pixelDiffThreshold} />
      <ol
        aria-label="Event log"
        className="max-h-60 overflow-y-auto rounded-card bg-surface-2 p-2 font-mono text-xs whitespace-pre"
      >
        {log.map((l) => (
          <li key={l.id}>{l.text}</li>
        ))}
      </ol>
    </div>
  );
}

export function Diagnostics() {
  const load = useApp((s) => s.loadDiagnostics);
  const [diag, setDiag] = useState<Diag | null>(null);
  useEffect(() => {
    let alive = true;
    let d: Diag | null = null;
    load().then((x) => {
      if (!alive) return x.dispose();
      d = x;
      setDiag(x);
    });
    return () => {
      alive = false;
      d?.dispose();
    };
  }, [load]);
  return (
    <div className="my-3 flex flex-col gap-5" data-testid="diagnostics">
      <SoundCheck />
      {diag && <EnginePanel diag={diag} />}
    </div>
  );
}
