import { CameraOff, RotateCcw } from 'lucide-react';
import type { CameraError } from '../../engine/types.ts';
import { cameraErrorCopy } from '../copy.ts';

/** Get Ready / tuning error card with platform steps and Retry (spec §3.4). */
export function CameraErrorCard({ error, onRetry }: { error: CameraError; onRetry: () => void }) {
  const copy = cameraErrorCopy(error);
  return (
    <div
      role="alert"
      data-testid="camera-error"
      className="flex flex-col items-center gap-4 rounded-card border border-danger/70 bg-surface px-6 py-8 text-center"
    >
      <CameraOff aria-hidden size={40} className="text-danger-glow" />
      <h2 className="text-2xl font-extrabold text-text">{copy.title}</h2>
      <p className="text-text-muted">{copy.body}</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex min-h-14 items-center gap-2 rounded-full bg-accent px-8 text-lg font-extrabold text-accent-ink uppercase"
      >
        <RotateCcw aria-hidden size={20} strokeWidth={2.75} />
        Retry
      </button>
    </div>
  );
}
