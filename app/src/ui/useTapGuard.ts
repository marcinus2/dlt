import { useCallback, useEffect, useRef, useState } from 'react';

/** Primary buttons ignore taps for 300 ms after a transition and after a tap (spec §3.4). */
export const TAP_GUARD_MS = 300;

/**
 * `ready` is false for the first 300 ms after mount (render it as aria-disabled so a
 * double tap that caused the transition can't hit the next button). `guard(fn)` wraps a
 * handler: ignored while not ready or within 300 ms of the last press; buzzes on Android.
 */
export function useTapGuard() {
  const [ready, setReady] = useState(false);
  const last = useRef(0);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), TAP_GUARD_MS);
    return () => clearTimeout(t);
  }, []);
  const guard = useCallback(
    (fn: () => void) => () => {
      const now = performance.now();
      if (!ready || now - last.current < TAP_GUARD_MS) return;
      last.current = now;
      navigator.vibrate?.(20);
      fn();
    },
    [ready],
  );
  return { ready, guard };
}
