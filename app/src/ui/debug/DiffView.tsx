// Pixel diff of the processed ROI (the PoC's diff canvas): pixels over the threshold in the accent
// colour, the rest as dimmed luma. Reads the analyzer's live buffers; ImageData only reallocates
// when the processing size changes. Draws on rAF after a new sample, only while mounted.
import { useEffect, useRef } from 'react';
import type { LumaPair } from '../../app/diagnostics.ts';
import type { MotionSample, Unsubscribe } from '../../engine/types.ts';
import { token } from './token.ts';

function rgb(color: string): [number, number, number] {
  const m = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m
    ? [Number.parseInt(m[1] ?? '0', 16), Number.parseInt(m[2] ?? '0', 16), Number.parseInt(m[3] ?? '0', 16)]
    : [34, 229, 255];
}

export function DiffView({
  subscribe,
  luma,
  threshold,
}: {
  subscribe: (cb: (s: Readonly<MotionSample>) => void) => Unsubscribe;
  luma: () => Readonly<LumaPair> | null;
  threshold: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const thr = useRef(threshold);
  thr.current = threshold;

  useEffect(() => {
    let fresh = false;
    let raf = 0;
    let img: ImageData | null = null;
    const [ar, ag, ab] = rgb(token('accent'));
    const off = subscribe(() => {
      fresh = true;
    });
    const draw = () => {
      const c = canvas.current;
      const ctx = c?.getContext('2d');
      const p = luma();
      if (c && ctx && fresh && p?.valid) {
        fresh = false;
        if (c.width !== p.width || c.height !== p.height || !img) {
          c.width = p.width;
          c.height = p.height;
          img = ctx.createImageData(p.width, p.height);
        }
        const d = img.data;
        for (let i = 0, n = p.width * p.height; i < n; i++) {
          const a = p.latest[i] as number;
          const moved = Math.abs(a - (p.previous[i] as number)) > thr.current;
          const o = i * 4;
          d[o] = moved ? ar : a >> 2;
          d[o + 1] = moved ? ag : a >> 2;
          d[o + 2] = moved ? ab : a >> 2;
          d[o + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      off();
      cancelAnimationFrame(raf);
    };
  }, [subscribe, luma]);

  return (
    <canvas
      ref={canvas}
      width={1}
      height={1}
      role="img"
      aria-label="Diff view of the processed region"
      className="max-h-64 w-auto max-w-full rounded-card border border-border bg-surface [image-rendering:pixelated]"
    />
  );
}
