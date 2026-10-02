// Fake 2D context for FrameAnalyzer tests: drawImage records the crop, getImageData samples
// a FakeImage (nearest neighbour) as grey RGBA. No DOM.
import type { AnalyzerContext, ContextFactory } from '../browser/frame-analyzer.ts';

/** A video frame: luma at (x, y) in video pixels. */
export interface FakeImage {
  width: number;
  height: number;
  luma(x: number, y: number): number;
}

export interface FakeContext extends AnalyzerContext {
  readonly willReadFrequently: boolean;
  draws: { sx: number; sy: number; sw: number; sh: number; dw: number; dh: number }[];
}

export function fakeContexts(): { factory: ContextFactory; created: FakeContext[] } {
  const created: FakeContext[] = [];
  const factory: ContextFactory = (width, height, willReadFrequently) => {
    let img: FakeImage | null = null;
    let crop = { sx: 0, sy: 0, sw: 1, sh: 1 };
    const ctx: FakeContext = {
      canvas: { width, height },
      willReadFrequently,
      draws: [],
      drawImage(image, sx, sy, sw, sh, _dx, _dy, dw, dh) {
        img = image as unknown as FakeImage;
        crop = { sx, sy, sw, sh };
        ctx.draws.push({ ...crop, dw, dh });
      },
      getImageData(_x, _y, w, h) {
        const data = new Uint8ClampedArray(w * h * 4);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const vx = Math.floor(crop.sx + ((x + 0.5) * crop.sw) / w);
            const vy = Math.floor(crop.sy + ((y + 0.5) * crop.sh) / h);
            const v = img ? img.luma(vx, vy) : 0;
            const j = (y * w + x) * 4;
            data[j] = data[j + 1] = data[j + 2] = v;
            data[j + 3] = 255;
          }
        }
        return { data };
      },
    };
    created.push(ctx);
    return ctx;
  };
  return { factory, created };
}

export const solid = (width: number, height: number, v: number): FakeImage => ({
  width,
  height,
  luma: () => v,
});

/** `v` inside the rect (video px), `bg` elsewhere. */
export const rect = (
  width: number,
  height: number,
  r: { x: number; y: number; w: number; h: number },
  v: number,
  bg: number,
): FakeImage => ({
  width,
  height,
  luma: (x, y) => (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h ? v : bg),
});
