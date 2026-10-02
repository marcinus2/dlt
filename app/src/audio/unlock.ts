// Audio unlock (spec §2.3): create/resume the AudioContext and prime speech inside a tap.
// No await before it. While the context is not running, the next tap anywhere unlocks again.
import type { Unsubscribe } from '../engine/types.ts';

/** A context still not running this long after an unlock (or a state change) counts as locked. */
export const LOCK_CHECK_MS = 400;
const TAP_EVENTS = ['pointerup', 'keydown'] as const;

export interface AudioUnlock {
  /** Call synchronously inside a user gesture. */
  unlock(): void;
  /** The context, or null before the first unlock and while locked. Tones scheduled during the
   * short resume after a tap play once it runs. */
  context(): AudioContext | null;
  locked(): boolean;
  onLockChange(cb: (locked: boolean) => void): Unsubscribe;
}

interface AudioSessionNav {
  audioSession?: { type: string };
}

export interface UnlockOptions {
  prime?: () => void;
  /** Where "the next tap" is heard; the window by default. */
  taps?: EventTarget;
}

export function createAudioUnlock(opts: UnlockOptions = {}): AudioUnlock {
  const taps = opts.taps ?? (globalThis as unknown as EventTarget);
  const Ctx = globalThis.AudioContext as typeof AudioContext | undefined;
  let ctx: AudioContext | null = null;
  let isLocked = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<(locked: boolean) => void>();

  function setLocked(next: boolean) {
    if (next === isLocked) return;
    isLocked = next;
    for (const t of TAP_EVENTS) {
      if (next) taps.addEventListener(t, unlock, { capture: true, passive: true });
      else taps.removeEventListener(t, unlock, { capture: true });
    }
    for (const cb of listeners) cb(next);
  }

  function check() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (ctx?.state === 'running') setLocked(false);
    else timer = setTimeout(() => setLocked(ctx?.state !== 'running'), LOCK_CHECK_MS);
  }

  function unlock() {
    opts.prime?.();
    if (!Ctx) return;
    if (!ctx) {
      // Safari 17+: play through the silent switch (spec §2.3).
      const nav = navigator as Navigator & AudioSessionNav;
      if (nav.audioSession) nav.audioSession.type = 'playback';
      ctx = new Ctx();
      ctx.onstatechange = check;
    }
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    // A silent one-sample buffer, started inside the gesture, unlocks older iOS.
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    src.connect(ctx.destination);
    src.start();
    check();
  }

  return {
    unlock,
    context: () => (isLocked ? null : ctx),
    locked: () => isLocked,
    onLockChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
