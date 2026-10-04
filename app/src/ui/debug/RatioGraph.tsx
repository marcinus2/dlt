// Ratio over the last ~10 s with the start / end lines (PoC graph.js). Draws on its own canvas,
// only while mounted and only when a new sample arrived; React never re-renders per frame.
import { useEffect, useRef } from 'react';
import type { MotionSample, Unsubscribe } from '../../engine/types.ts';
import { meterPos } from '../config/meter.ts';
import { token } from './token.ts';

const N = 300;

export function RatioGraph({
  subscribe,
  start,
  end,
}: {
  subscribe: (cb: (s: Readonly<MotionSample>) => void) => Unsubscribe;
  start: number;
  end: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const lines = useRef({ start, end });
  lines.current = { start, end };

  useEffect(() => {
    const ratios = new Float32Array(N);
    const global = new Uint8Array(N);
    let head = 0;
    let count = 0;
    let dirty = true;
    let raf = 0;
    const off = subscribe((s) => {
      ratios[head] = s.ratio;
      global[head] = s.global ? 1 : 0;
      head = (head + 1) % N;
      if (count < N) count++;
      dirty = true;
    });
    const colors = {
      accent: token('accent'),
      best: token('best'),
      muted: token('text-muted'),
      warn: token('warn'),
    };
    const draw = () => {
      const c = canvas.current;
      const ctx = c?.getContext('2d');
      if (c && ctx && dirty) {
        dirty = false;
        const { width: w, height: h } = c;
        const y = (r: number) => h - meterPos(r) * h;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = colors.warn;
        for (let i = 0; i < count; i++) {
          const k = (head - count + i + N) % N;
          if (global[k]) ctx.fillRect((i / N) * w, 0, w / N, 3);
        }
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < count; i++) {
          const k = (head - count + i + N) % N;
          const x = (i / N) * w;
          if (i === 0) ctx.moveTo(x, y(ratios[k] as number));
          else ctx.lineTo(x, y(ratios[k] as number));
        }
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.strokeStyle = colors.best;
        ctx.strokeRect(-1, y(lines.current.start), w + 2, 0);
        ctx.strokeStyle = colors.muted;
        ctx.strokeRect(-1, y(lines.current.end), w + 2, 0);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      off();
      cancelAnimationFrame(raf);
    };
  }, [subscribe]);

  return (
    <canvas
      ref={canvas}
      width={600}
      height={140}
      aria-label="Ratio graph (log scale, start line green, end line grey)"
      role="img"
      className="h-32 w-full rounded-card border border-border bg-surface"
    />
  );
}
