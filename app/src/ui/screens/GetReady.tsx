import { Check, LoaderCircle } from 'lucide-react';
import { BigButton } from '../components/BigButton.tsx';
import { CameraErrorCard } from '../components/CameraErrorCard.tsx';
import { CameraLayer, useVideoSize } from '../components/CameraLayer.tsx';
import { RoiOverlay } from '../components/RoiOverlay.tsx';
import { WarnChip } from '../components/StatusChip.tsx';
import { TopBar } from '../components/TopBar.tsx';
import { CAMERA_EXPLAINER } from '../copy.ts';
import { useApp } from '../store.tsx';

function HealthLine() {
  const camera = useApp((s) => s.state.camera);
  // Processed fps once frames flow (0 before the first interval); the camera's own rate until then.
  const fps = useApp((s) => s.ui.stats?.fps || s.ui.cameraInfo?.fps || null);
  const facing = useApp((s) => s.ui.cameraInfo?.facing ?? s.saved.camera.facing);
  const lowFps = useApp((s) => s.ui.lowFps);

  if (camera === 'starting' || camera === 'off') {
    return (
      <div className="flex max-w-[420px] flex-col items-center gap-1 text-center">
        <p className="inline-flex items-center gap-2 font-semibold text-text">
          <LoaderCircle aria-hidden size={18} className="animate-spin motion-reduce:animate-none" />
          Starting camera…
        </p>
        <p className="text-sm text-text-muted">{CAMERA_EXPLAINER}</p>
      </div>
    );
  }
  if (camera !== 'live') return null;
  if (lowFps) return <WarnChip>Low frame rate — passes may be missed</WarnChip>;
  return (
    <p data-testid="camera-health" className="inline-flex min-h-9 items-center gap-2 font-semibold text-text">
      <Check aria-hidden size={18} strokeWidth={3} className="text-best" />
      {fps === null ? '' : `${Math.round(fps)} fps · `}
      {facing === 'environment' ? 'rear camera' : 'front camera'}
    </p>
  );
}

/** Get Ready (spec §3.1): live preview with ROI overlay + pass flash, health line, START. */
export function GetReady() {
  const camera = useApp((s) => s.state.camera);
  const dispatch = useApp((s) => s.dispatch);
  const roi = useApp((s) => s.saved.detection.roi);
  const flash = useApp((s) => s.ui.passFlash);
  const facing = useApp((s) => s.ui.cameraInfo?.facing ?? s.saved.camera.facing);
  const width = useApp((s) => s.ui.cameraInfo?.width ?? s.saved.camera.width);
  const height = useApp((s) => s.ui.cameraInfo?.height ?? s.saved.camera.height);
  const error = typeof camera === 'object' ? camera.error : null;
  const frame = useVideoSize();
  const aspect = frame ? frame.width / frame.height : width / height;

  return (
    <>
      <TopBar />
      <main className="mx-auto flex min-h-0 w-full max-w-[480px] flex-1 flex-col items-center gap-4 px-safe py-4 landscape:max-w-[1040px] landscape:flex-row landscape:justify-center landscape:gap-8">
        <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-3 landscape:max-w-[640px] landscape:self-stretch">
          {error ? (
            <CameraErrorCard error={error} onRetry={() => dispatch({ type: 'RETRY' })} />
          ) : (
            <div className="flex min-h-40 w-full flex-1 basis-0 items-center justify-center overflow-hidden">
              <CameraLayer mirrored={facing === 'user'} aspect={aspect} fit>
                <RoiOverlay roi={roi} flash={flash} frame={frame} />
              </CameraLayer>
            </div>
          )}
          <HealthLine />
        </div>
        {error?.kind !== 'notFound' && (
          <BigButton
            label="Start"
            tone="danger"
            size="compact"
            disabled={camera !== 'live'}
            onPress={() => dispatch({ type: 'START' })}
          />
        )}
      </main>
    </>
  );
}
