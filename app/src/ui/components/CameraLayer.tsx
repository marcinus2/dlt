// The one <video> element lives for the whole app life (iOS, spec §2.1). It sits in an
// invisible host and moves into a CameraLayer slot while a preview is shown.
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { cx } from '../cx.ts';
import { useApp } from '../store.tsx';

let host: HTMLDivElement | null = null;

/** Mounted once at the app root; keeps the video in the DOM (not display:none) between previews. */
export function CameraHost() {
  const video = useApp((s) => s.video);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    host = ref.current;
    if (host && !video.isConnected) host.append(video);
    return () => {
      host = null;
    };
  }, [video]);
  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed top-0 left-0 size-px overflow-hidden opacity-0"
    />
  );
}

interface Props {
  /** Front camera is mirrored, overlay included (spec §2.1). */
  mirrored: boolean;
  /** Frame aspect (width / height). */
  aspect: number;
  /** Fit inside the parent box at the frame aspect, ≤ 640 px wide. */
  fit?: boolean;
  children?: ReactNode;
  className?: string;
}

export function CameraLayer({ mirrored, aspect, fit, children, className }: Props) {
  const video = useApp((s) => s.video);
  const slot = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [fitWidth, setFitWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const parent = box.current?.parentElement;
    if (!fit || !parent) return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setFitWidth(Math.floor(Math.min(e.contentRect.width, e.contentRect.height * aspect, 640)));
    });
    ro.observe(parent);
    return () => ro.disconnect();
  }, [fit, aspect]);
  useLayoutEffect(() => {
    const el = slot.current;
    if (!el) return;
    video.className = 'absolute inset-0 h-full w-full object-cover';
    el.prepend(video);
    video.play?.().catch(() => {}); // moving can pause it on some browsers
    return () => {
      host?.append(video);
    };
  }, [video]);
  return (
    <div
      ref={box}
      className={cx(
        'relative shrink-0 overflow-hidden rounded-card border border-border bg-surface-2',
        className,
      )}
      style={{ aspectRatio: aspect, width: fit ? (fitWidth ?? 0) : undefined }}
    >
      <div ref={slot} className={cx('absolute inset-0', mirrored && '-scale-x-100')}>
        {children}
      </div>
    </div>
  );
}
