import { useEffect } from 'react';
import type { AppEvent, AppState } from '../app/machine.ts';
import { useStoreApi } from './store.tsx';
import { TAP_GUARD_MS } from './useTapGuard.ts';

/** The visible primary action for Space/Enter (spec §3.4). */
export function primaryEvent(s: AppState): AppEvent | null {
  if (s.dialog) return null; // the dialog owns the keyboard (Esc = cancel)
  switch (s.screen) {
    case 'welcome':
      return { type: 'GET_READY' };
    case 'getReady':
      if (s.camera === 'live') return { type: 'START' };
      return typeof s.camera === 'object' ? { type: 'RETRY' } : null;
    case 'session':
      return { type: 'STOP' };
    case 'paused':
      return { type: 'CONTINUE' };
    case 'config':
      return null;
  }
}

const INTERACTIVE =
  'button, a[href], input, select, textarea, summary, [contenteditable], [role="switch"], dialog';

export function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(INTERACTIVE) !== null;
}

/** Space/Enter = primary action, unless focus is on a control (it handles the key itself). */
export function useKeyboard() {
  const api = useStoreApi();
  useEffect(() => {
    let screen = api.getState().state.screen;
    let since = performance.now();
    const unsub = api.subscribe((s) => {
      if (s.state.screen !== screen) {
        screen = s.state.screen;
        since = performance.now();
      }
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || isInteractive(e.target)) return;
      const { state, dispatch } = api.getState();
      const ev = primaryEvent(state);
      if (!ev) return;
      e.preventDefault(); // no page scroll on Space
      if (performance.now() - since < TAP_GUARD_MS) return;
      dispatch(ev); // synchronous: keydown is a user gesture for unlock / camera.start
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      unsub();
    };
  }, [api]);
}
