// Platform glue (M8) against injected fakes: wake lock, visibility, unload guard, permissions,
// orientation. Node env; EventTarget stands in for document / window.
import { describe, expect, it, vi } from 'vitest';
import { lockPortrait } from './orientation.ts';
import { cameraPermission, withPermission } from './permissions.ts';
import { createUnloadGuard, onVisibility } from './visibility.ts';
import { createWakeLock, type SentinelLike, type WakeLockApi } from './wake-lock.ts';

const flush = async () => {
  for (let i = 0; i < 3; i++) await Promise.resolve();
};

function fakeDoc(state: DocumentVisibilityState = 'visible') {
  const doc = Object.assign(new EventTarget(), { visibilityState: state });
  return {
    doc: doc as unknown as Document,
    set(next: DocumentVisibilityState) {
      doc.visibilityState = next;
      doc.dispatchEvent(new Event('visibilitychange'));
    },
  };
}

function fakeSentinel() {
  const t = new EventTarget();
  const s = Object.assign(t, {
    released: false,
    release: vi.fn(async () => {
      s.released = true;
    }),
    /** The browser drops the lock (page hidden). */
    drop() {
      s.released = true;
      t.dispatchEvent(new Event('release'));
    },
  });
  return s;
}

function fakeApi() {
  const sentinels: ReturnType<typeof fakeSentinel>[] = [];
  let reject = false;
  const api: WakeLockApi = {
    request: vi.fn(async () => {
      if (reject) throw new DOMException('denied', 'NotAllowedError');
      const s = fakeSentinel();
      sentinels.push(s);
      return s as unknown as SentinelLike;
    }),
  };
  return {
    api,
    sentinels,
    reject(on: boolean) {
      reject = on;
    },
  };
}

describe('wake lock', () => {
  it('acquire → held; release releases the sentinel', async () => {
    const { api, sentinels } = fakeApi();
    const w = createWakeLock({ api, doc: fakeDoc().doc });
    const held: boolean[] = [];
    w.onChange((h) => held.push(h));
    w.acquire();
    await flush();
    expect(held).toEqual([true]);
    w.release();
    expect(sentinels[0]?.release).toHaveBeenCalledOnce();
  });

  it('unsupported or rejected → not held (banner)', async () => {
    const none = createWakeLock({ api: null, doc: fakeDoc().doc });
    const a: boolean[] = [];
    none.onChange((h) => a.push(h));
    none.acquire();
    expect(a).toEqual([false]);

    const f = fakeApi();
    f.reject(true);
    const w = createWakeLock({ api: f.api, doc: fakeDoc().doc });
    const b: boolean[] = [];
    w.onChange((h) => b.push(h));
    w.acquire();
    await flush();
    expect(b).toEqual([false]);
  });

  it('dropped while hidden → requested again on visible, only while wanted', async () => {
    const f = fakeApi();
    const d = fakeDoc();
    const w = createWakeLock({ api: f.api, doc: d.doc });
    w.acquire();
    await flush();
    d.set('hidden');
    f.sentinels[0]?.drop();
    d.set('visible');
    await flush();
    expect(f.api.request).toHaveBeenCalledTimes(2);
    w.release();
    d.set('hidden');
    d.set('visible');
    await flush();
    expect(f.api.request).toHaveBeenCalledTimes(2);
  });

  it('still held on visible → no second request; acquire twice → one request', async () => {
    const f = fakeApi();
    const d = fakeDoc();
    const w = createWakeLock({ api: f.api, doc: d.doc });
    w.acquire();
    w.acquire();
    await flush();
    d.set('visible');
    await flush();
    expect(f.api.request).toHaveBeenCalledOnce();
  });

  it('released before the request resolves → the late sentinel is released at once', async () => {
    const f = fakeApi();
    const w = createWakeLock({ api: f.api, doc: fakeDoc().doc });
    const held: boolean[] = [];
    w.onChange((h) => held.push(h));
    w.acquire();
    w.release();
    await flush();
    expect(f.sentinels[0]?.release).toHaveBeenCalledOnce();
    expect(held).toEqual([]);
  });
});

describe('visibility', () => {
  it('reports hidden / visible once each, incl. pagehide and pageshow', () => {
    const d = fakeDoc();
    const win = new EventTarget() as unknown as Window;
    const got: boolean[] = [];
    const off = onVisibility((v) => got.push(v), d.doc, win);
    win.dispatchEvent(new Event('pagehide'));
    d.set('hidden'); // repeat: dropped
    d.set('visible');
    win.dispatchEvent(new Event('pageshow')); // already visible
    expect(got).toEqual([false, true]);
    off();
    d.set('hidden');
    expect(got).toEqual([false, true]);
  });
});

describe('unload guard', () => {
  it('prompts only while on', () => {
    const win = new EventTarget() as unknown as Window;
    const guard = createUnloadGuard(win);
    const fire = () => {
      const e = new Event('beforeunload', { cancelable: true });
      Object.defineProperty(e, 'returnValue', { value: true, writable: true }); // read-only on Node's Event
      win.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(fire()).toBe(false);
    guard(true);
    guard(true);
    expect(fire()).toBe(true);
    guard(false);
    expect(fire()).toBe(false);
  });
});

describe('permissions', () => {
  it('camera state from the Permissions API; null when it can’t say', async () => {
    const query = vi.fn(async () => ({ state: 'denied' }) as PermissionStatus);
    expect(await cameraPermission({ query })).toBe('denied');
    expect(query).toHaveBeenCalledWith({ name: 'camera' });
    expect(await cameraPermission({ query: () => Promise.reject(new TypeError('camera')) })).toBeNull();
    expect(await cameraPermission(undefined)).toBeNull();
  });

  it('annotates permission errors only', () => {
    const p = { kind: 'permission', message: 'x' } as const;
    expect(withPermission(p, 'denied')).toEqual({ ...p, blocked: true });
    expect(withPermission(p, 'prompt')).toEqual({ ...p, blocked: false });
    expect(withPermission(p, null)).toBe(p);
    expect(withPermission(p, 'granted')).toBe(p);
    const busy = { kind: 'busy', message: 'x' } as const;
    expect(withPermission(busy, 'denied')).toBe(busy);
  });
});

describe('orientation', () => {
  it('locks portrait only where allowed; a rejection is swallowed', async () => {
    const lock = vi.fn(() => Promise.reject(new DOMException('no', 'NotSupportedError')));
    lockPortrait({ lock }, () => false);
    expect(lock).not.toHaveBeenCalled();
    lockPortrait({ lock }, () => true);
    expect(lock).toHaveBeenCalledWith('portrait');
    await flush();
    lockPortrait(undefined, () => true); // no Screen Orientation API
  });
});
