// Engine debug rig (plan 4.10, `?debug=engine`): real CameraSource / FileSource → FrameAnalyzer →
// DetectorEngine, with the PoC recorder for CSV export. Lazy chunk; the page gets it as a prop,
// so ui/ never imports engine/browser.
import { type CameraSource, createCameraSource, createVideo } from '../engine/browser/camera-source.ts';
import { createFileSource } from '../engine/browser/file-source.ts';
import { type AnalyzerTiming, createFrameAnalyzer } from '../engine/browser/frame-analyzer.ts';
import { createDetectorEngine } from '../engine/engine.ts';
import { createRecorder } from '../engine/recorder.ts';
import type {
  CameraError,
  CameraInfo,
  DetectorEvent,
  EnginePhase,
  EngineStats,
  FrameSource,
  MotionSample,
  Settings,
  Unsubscribe,
} from '../engine/types.ts';

export interface DebugRig {
  readonly video: HTMLVideoElement;
  readonly settings: Settings;
  startCamera(): Promise<CameraInfo>;
  startFile(file: File): Promise<CameraInfo>;
  stop(): void;
  /** Back to warm-up and a fresh recording (the PoC's Start detection). */
  restart(): void;
  /** Polled ≤ 4 Hz by the page. */
  snapshot(): {
    phase: EnginePhase;
    state: string;
    sample: Readonly<MotionSample>;
    stats: EngineStats;
    timing: Readonly<AnalyzerTiming>;
    size: { width: number; height: number };
    frames: number;
    controls: ReturnType<CameraSource['controls']>;
  };
  onEvent(cb: (e: DetectorEvent) => void): Unsubscribe;
  onEnded(cb: (e: CameraError) => void): Unsubscribe;
  eventsCsv(): string;
  framesCsv(): string;
}

export function createDebugRig(settings: Settings): DebugRig {
  const video = createVideo();
  const camera = createCameraSource({ video });
  const file = createFileSource({ video });
  const analyzer = createFrameAnalyzer();
  const engine = createDetectorEngine({ analyzer });
  const recorder = createRecorder();
  const last: MotionSample = { t: 0, ratio: 0, globalRatio: 0, global: false, gapReset: false };
  let phase: EnginePhase = 'stopped';
  let source: FrameSource | null = null;
  camera.configure(settings.camera);

  engine.on('phase', (p) => {
    phase = p;
  });
  engine.on('event', (e) => recorder.addEvent(e));
  engine.on('sample', (s) => {
    Object.assign(last, s);
    recorder.addFrame(s.t, s.ratio, s.globalRatio, s.global, engine.detectorState() ?? 'OFF');
  });

  function stop() {
    engine.stop();
    camera.stop();
    file.stop();
    source = null;
  }

  async function begin(src: FrameSource): Promise<CameraInfo> {
    stop();
    const info = await src.start();
    source = src;
    recorder.clear();
    engine.start(src, settings.detection);
    return info;
  }

  return {
    video,
    settings,
    startCamera: () => begin(camera),
    startFile(f) {
      file.setFile(f);
      return begin(file);
    },
    stop,
    restart() {
      if (!source) return;
      recorder.clear();
      engine.reset();
    },
    snapshot: () => ({
      phase,
      state: engine.detectorState() ?? 'OFF',
      sample: last,
      stats: engine.stats(),
      timing: analyzer.timing,
      size: analyzer.size,
      frames: recorder.frameCount,
      controls: camera.controls(),
    }),
    onEvent: (cb) => engine.on('event', cb),
    onEnded(cb) {
      const a = camera.onEnded(cb);
      const b = file.onEnded(cb);
      return () => {
        a();
        b();
      };
    },
    eventsCsv: () => recorder.eventsCsv(),
    framesCsv: () => recorder.framesCsv(),
  };
}
