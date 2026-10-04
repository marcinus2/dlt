// Diagnostics (plan 7.5, `?debug=1`), lazy chunk; replaces the M4 `?debug=engine` page. Watches the
// app engine while Test & calibrate runs (live), or replays a video file through its own
// FileSource → FrameAnalyzer → DetectorEngine with the draft detection settings. Records frames and
// events with the PoC recorder for CSV export. The UI polls the view (≤ 4 Hz) and draws on canvases.
import { createFileSource } from '../engine/browser/file-source.ts';
import { type AnalyzerTiming, createFrameAnalyzer, type LumaPair } from '../engine/browser/frame-analyzer.ts';
import { createDetectorEngine, type Engine } from '../engine/engine.ts';
import { createRecorder, type RecordedState } from '../engine/recorder.ts';
import type {
  CameraInfo,
  ControlReport,
  DetectionSettings,
  DetectorEngine,
  DetectorEvent,
  EnginePhase,
  EngineStats,
  MotionSample,
  Unsubscribe,
} from '../engine/types.ts';
import type { DiagTargets } from './effects.ts';

export type { LumaPair };

/** What the panel shows: the file replay while it runs, else the live engine. */
export interface DiagView {
  readonly kind: 'live' | 'file';
  phase(): EnginePhase;
  /** Detector state, 'OFF' when stopped or unknown (sim). */
  state(): RecordedState;
  stats(): EngineStats;
  /** Pipeline internals; null in sim. */
  timing(): Readonly<AnalyzerTiming> | null;
  luma(): Readonly<LumaPair> | null;
  controls(): { exposure: ControlReport | null; focus: ControlReport | null } | null;
  info(): CameraInfo | null;
}

export interface Diagnostics {
  view(): DiagView;
  /** Samples / events of both sources (one reused sample object). */
  onSample(cb: (s: Readonly<MotionSample>) => void): Unsubscribe;
  onEvent(cb: (e: DetectorEvent) => void): Unsubscribe;
  readonly fileVideo: HTMLVideoElement;
  replay(file: File): Promise<CameraInfo>;
  stopReplay(): void;
  /** Back to warm-up and a fresh recording (the PoC's Start detection). */
  restartReplay(): void;
  clearRecording(): void;
  recorded(): number;
  eventsCsv(): string;
  framesCsv(): string;
  dispose(): void;
}

export interface DiagnosticsOptions {
  live: DetectorEngine;
  targets: DiagTargets | null;
  /** Settings the replay runs with (the draft). */
  settings: () => DetectionSettings;
  liveInfo: () => CameraInfo | null;
}

const asState = (s: string | null | undefined): RecordedState => (s ?? 'OFF') as RecordedState;

export function createDiagnostics(opts: DiagnosticsOptions): Diagnostics {
  const file = createFileSource();
  const fileAnalyzer = createFrameAnalyzer();
  const fileEngine: Engine = createDetectorEngine({ analyzer: fileAnalyzer });
  const recorder = createRecorder();
  const samples = new Set<(s: Readonly<MotionSample>) => void>();
  const events = new Set<(e: DetectorEvent) => void>();
  const t = opts.targets;
  let livePhase: EnginePhase = 'stopped';
  let filePhase: EnginePhase = 'stopped';
  let fileInfo: CameraInfo | null = null;

  function wire(engine: DetectorEngine, state: () => RecordedState, setPhase: (p: EnginePhase) => void) {
    return [
      engine.on('phase', setPhase),
      engine.on('event', (e) => {
        recorder.addEvent(e);
        for (const cb of events) cb(e);
      }),
      engine.on('sample', (s) => {
        recorder.addFrame(s.t, s.ratio, s.globalRatio, s.global, state());
        for (const cb of samples) cb(s);
      }),
    ];
  }

  const offs = [
    ...wire(
      opts.live,
      () => asState(t?.engine.detectorState()),
      (p) => {
        livePhase = p;
      },
    ),
    ...wire(
      fileEngine,
      () => asState(fileEngine.detectorState()),
      (p) => {
        filePhase = p;
      },
    ),
  ];

  const live: DiagView = {
    kind: 'live',
    phase: () => livePhase,
    state: () => asState(t?.engine.detectorState()),
    stats: () => opts.live.stats(),
    timing: () => t?.analyzer.timing ?? null,
    luma: () => t?.analyzer.luma() ?? null,
    controls: () => t?.camera.controls() ?? null,
    info: opts.liveInfo,
  };
  const replayView: DiagView = {
    kind: 'file',
    phase: () => filePhase,
    state: () => asState(fileEngine.detectorState()),
    stats: () => fileEngine.stats(),
    timing: () => fileAnalyzer.timing,
    luma: () => fileAnalyzer.luma(),
    controls: () => null,
    info: () => fileInfo,
  };

  function stopReplay() {
    fileEngine.stop();
    file.stop();
    fileInfo = null;
  }

  return {
    view: () => (fileInfo ? replayView : live),
    onSample(cb) {
      samples.add(cb);
      return () => samples.delete(cb);
    },
    onEvent(cb) {
      events.add(cb);
      return () => events.delete(cb);
    },
    fileVideo: file.video,
    async replay(f) {
      stopReplay();
      file.setFile(f);
      const info = await file.start();
      recorder.clear();
      fileInfo = info;
      fileEngine.start(file, opts.settings());
      return info;
    },
    stopReplay,
    restartReplay() {
      recorder.clear();
      if (fileInfo) fileEngine.reset();
    },
    clearRecording: () => recorder.clear(),
    recorded: () => recorder.frameCount,
    eventsCsv: () => recorder.eventsCsv(),
    framesCsv: () => recorder.framesCsv(),
    dispose() {
      stopReplay();
      for (const off of offs) off();
      samples.clear();
      events.clear();
    },
  };
}
