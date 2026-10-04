import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Effects } from '../app/effects.ts';
import { createAppStore, type StoreOptions } from '../app/store.ts';
import type { CameraDevice, CameraInfo, DetectorEngine } from '../engine/types.ts';
import { createSettingsStorage, memoryBackend } from '../settings/storage.ts';
import { StoreProvider } from '../ui/store.tsx';

/** Effects that do nothing; the camera start never resolves unless `cameraLive` is set. */
export function noopEffects(opts: { cameraLive?: CameraInfo; cameras?: CameraDevice[] } = {}): Effects {
  const engine = {
    start() {},
    stop() {},
    reset() {},
    update() {},
    on: () => () => {},
    stats: () => ({
      fps: 30,
      deliveredFps: 30,
      dropped: 0,
      msPerFrame: 5,
      ratio: 0,
      tSource: 'now' as const,
    }),
  } as DetectorEngine;
  return {
    camera: {
      video: document.createElement('video'),
      configure() {},
      start: () => (opts.cameraLive ? Promise.resolve(opts.cameraLive) : new Promise(() => {})),
      stop() {},
      onFrame: () => () => {},
      onEnded: () => () => {},
      listCameras: () => Promise.resolve(opts.cameras ?? []),
      onDeviceChange: () => () => {},
    },
    engine,
    audio: {
      unlock() {},
      cue: () => ({ tone: null, text: '' }),
      onLockChange: () => () => {},
      onVoiceChange: () => () => {},
      voiceAvailable: () => true,
    },
    wakeLock: { acquire() {}, release() {}, onChange: () => () => {} },
    platform: {
      onVisibility: () => () => {},
      cameraPermission: () => Promise.resolve(null),
      unloadGuard() {},
    },
    settings: createSettingsStorage(memoryBackend()),
  };
}

export function testStore(opts: Partial<StoreOptions> = {}) {
  return createAppStore({ effects: noopEffects(), ...opts });
}

export function renderWithStore(ui: ReactNode, store = testStore()) {
  return { store, ...render(<StoreProvider store={store}>{ui}</StoreProvider>) };
}
