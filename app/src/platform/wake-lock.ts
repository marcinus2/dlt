// Screen Wake Lock (spec §2.2, plan 8.1): held from Get Ready through Session and Paused. The
// browser drops it when the page is hidden, so it is requested again on `visible` while wanted.
import type { WakeLockPort } from '../app/effects.ts';
import type { Unsubscribe } from '../engine/types.ts';

export interface SentinelLike {
  readonly released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', cb: () => void): void;
}

export interface WakeLockApi {
  request(type: 'screen'): Promise<SentinelLike>;
}

export type VisibleDoc = Pick<Document, 'visibilityState' | 'addEventListener'>;

export interface WakeLockOptions {
  api?: WakeLockApi | null;
  doc?: VisibleDoc;
}

export function createWakeLock(opts: WakeLockOptions = {}): WakeLockPort {
  const api = opts.api === undefined ? ((globalThis.navigator?.wakeLock as WakeLockApi) ?? null) : opts.api;
  const doc = opts.doc ?? document;
  const subs = new Set<(held: boolean) => void>();
  let wanted = false;
  let pending = false;
  let sentinel: SentinelLike | null = null;

  const emit = (held: boolean) => {
    for (const cb of subs) cb(held);
  };

  function request() {
    if (!api) return emit(false);
    if (pending || (sentinel && !sentinel.released)) return;
    pending = true;
    api.request('screen').then(
      (s) => {
        pending = false;
        if (!wanted) return void s.release().catch(() => {});
        sentinel = s;
        s.addEventListener('release', () => {
          if (sentinel === s) sentinel = null;
        });
        emit(true);
      },
      () => {
        pending = false;
        if (wanted) emit(false);
      },
    );
  }

  doc.addEventListener('visibilitychange', () => {
    if (wanted && doc.visibilityState === 'visible') request();
  });

  return {
    acquire() {
      wanted = true;
      request();
    },
    release() {
      wanted = false;
      sentinel?.release().catch(() => {});
      sentinel = null;
    },
    onChange(cb): Unsubscribe {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}

/** Logs each call and change (sim log, console with `?debug=1`). */
export function loggedWakeLock(w: WakeLockPort, log: (msg: string) => void): WakeLockPort {
  return {
    acquire() {
      log('wakeLock.acquire');
      w.acquire();
    },
    release() {
      log('wakeLock.release');
      w.release();
    },
    onChange: (cb) =>
      w.onChange((held) => {
        log(`wakeLock ${held ? 'held' : 'unavailable'}`);
        cb(held);
      }),
  };
}
