import { processedRoi } from '../../engine/roi.ts';
import type { Roi } from '../../engine/types.ts';
import type { FrameSize } from './CameraLayer.tsx';

/**
 * ROI box over the preview; its border flashes green on a detected pass (G3). With the frame size
 * it shows the analyzer's pixel crop, i.e. exactly the processed area (plan 7.3).
 */
export function RoiOverlay({
  roi: setting,
  flash,
  frame,
}: {
  roi: Roi;
  flash: number;
  frame?: FrameSize | null;
}) {
  const roi = frame ? processedRoi(setting, frame.width, frame.height) : setting;
  return (
    <div
      data-testid="roi"
      className="absolute rounded-sm border-2 border-dashed border-accent"
      style={{
        left: `calc(${roi.x * 100}% + 2px)`,
        top: `calc(${roi.y * 100}% + 2px)`,
        width: `calc(${roi.width * 100}% - 4px)`,
        height: `calc(${roi.height * 100}% - 4px)`,
      }}
    >
      {flash > 0 && (
        <span
          key={flash}
          data-testid="roi-flash"
          className="roi-flash absolute -inset-0.5 rounded-sm border-4 border-best shadow-glow-best"
        />
      )}
    </div>
  );
}
