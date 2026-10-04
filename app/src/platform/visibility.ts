// Page visibility (plan 8.2): `visibilitychange` plus `pagehide` / `pageshow`, since iOS can skip
// `visibilitychange` when the page is swiped away or restored from the bfcache. Repeats are dropped.
import type { Unsubscribe } from '../engine/types.ts';

export type VisibilityTarget = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
export type PageTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>;

export function onVisibility(
  cb: (visible: boolean) => void,
  doc: VisibilityTarget = document,
  win: PageTarget = window,
): Unsubscribe {
  let last = doc.visibilityState === 'visible';
  const report = (visible: boolean) => {
    if (visible === last) return;
    last = visible;
    cb(visible);
  };
  const onChange = () => report(doc.visibilityState === 'visible');
  const onHide = () => report(false);
  doc.addEventListener('visibilitychange', onChange);
  win.addEventListener('pagehide', onHide);
  win.addEventListener('pageshow', onChange);
  return () => {
    doc.removeEventListener('visibilitychange', onChange);
    win.removeEventListener('pagehide', onHide);
    win.removeEventListener('pageshow', onChange);
  };
}

/** `beforeunload` prompt while a session has data (spec §3.4; desktop, best effort on mobile). */
export function createUnloadGuard(win: PageTarget = window) {
  let on = false;
  const prompt = (e: Event) => {
    e.preventDefault();
    (e as BeforeUnloadEvent).returnValue = ''; // older Chrome / Safari need it set
  };
  return (next: boolean) => {
    if (next === on) return;
    on = next;
    if (on) win.addEventListener('beforeunload', prompt);
    else win.removeEventListener('beforeunload', prompt);
  };
}
