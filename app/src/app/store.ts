// App store: machine state + settings draft + UI flags. dispatch() reduces, then runs
// effects synchronously (gesture-bound effects stay inside the tap handler).
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { CameraInfo, EngineStats, Settings } from '../engine/types.ts';
import { DEFAULTS, type SettingKey, setSetting } from '../settings/schema.ts';
import { equalSettings, type SettingErrors, validate } from '../settings/validate.ts';
import { createEffectRunner, type Effects } from './effects.ts';
import { type AppEvent, type AppState, initialState, reduce } from './machine.ts';

export interface Toast {
  id: number;
  text: string;
}

export interface UiState {
  /** Bumped on every engine pass; Get Ready / tuning flash the ROI border (G3). */
  passFlash: number;
  stats: EngineStats | null;
  lowFps: boolean;
  cameraInfo: CameraInfo | null;
  toast: Toast | null;
  audioLocked: boolean; // M6
  wakeLockBanner: boolean; // M8
  updateAvailable: boolean; // M9
  install: 'none' | 'prompt' | 'iosHint'; // M9
}

export const initialUi: UiState = {
  passFlash: 0,
  stats: null,
  lowFps: false,
  cameraInfo: null,
  toast: null,
  audioLocked: false,
  wakeLockBanner: false,
  updateAvailable: false,
  install: 'none',
};

/** Sim hooks for the SIMULATED panel (ui/sim); null outside sim mode. */
export interface SimControls {
  pass(): void;
  setAuto(on: boolean): void;
  auto(): boolean;
  setLowFps(on: boolean): void;
  lowFps(): boolean;
  dropCamera(): void;
}

export interface AppStore {
  state: AppState;
  saved: Settings;
  draft: Settings;
  errors: SettingErrors;
  ui: UiState;
  video: HTMLVideoElement;
  sim: SimControls | null;
  debug: boolean;
  dispatch(e: AppEvent): void;
  setDraft(key: SettingKey, value: unknown): void;
  resetDraft(): void;
  showToast(text: string): void;
  dismissToast(id: number): void;
  setUi(patch: Partial<UiState>): void;
}

export interface StoreOptions {
  effects: Effects;
  state?: AppState;
  ui?: Partial<UiState>;
  draft?: Settings;
  sim?: SimControls | null;
  debug?: boolean;
}

export const STORAGE_TOAST = 'Settings can’t be saved on this device';

export function createAppStore(opts: StoreOptions): StoreApi<AppStore> & { resumeLive(): void } {
  const fx = opts.effects;
  const saved = fx.settings.load();
  const draft = opts.draft ?? saved;
  let toastId = 0;
  let resumeLive: () => void = () => {};

  const api = createStore<AppStore>()((set, get) => {
    const runner = createEffectRunner(fx, {
      state: () => get().state,
      saved: () => get().saved,
      draft: () => get().draft,
      dispatch: (e) => get().dispatch(e),
      committed: (ok) => {
        set({ saved: get().draft, errors: {} });
        if (!ok) get().showToast(STORAGE_TOAST);
      },
      reverted: () => set({ draft: get().saved, errors: {} }),
      cameraInfo: (cameraInfo) => get().setUi({ cameraInfo }),
      passFlash: () => get().setUi({ passFlash: get().ui.passFlash + 1 }),
      stats: (stats, lowFps) => get().setUi({ stats, lowFps }),
    });
    resumeLive = runner.resumeLive;

    function changeDraft(next: Settings) {
      const errors = validate(next);
      const valid = Object.keys(errors).length === 0;
      set({ draft: next, errors });
      get().dispatch({ type: 'CONFIG_CHANGED', dirty: !equalSettings(next, get().saved), valid });
      const { state } = get();
      if (valid && state.tuning && state.camera === 'live') fx.engine.update(next.detection);
    }

    return {
      state: opts.state ?? initialState,
      saved,
      draft,
      errors: validate(draft),
      ui: { ...initialUi, ...opts.ui },
      video: fx.camera.video,
      sim: opts.sim ?? null,
      debug: opts.debug ?? false,
      dispatch(e) {
        const prev = get().state;
        const { state, effects } = reduce(prev, e);
        if (state !== prev) set({ state });
        else if (get().debug && effects.length === 0)
          console.debug(`[machine] ${prev.screen}: ignored ${e.type}`);
        for (const effect of effects) runner.run(effect);
      },
      setDraft: (key, value) => changeDraft(setSetting(get().draft, key, value)),
      resetDraft: () => changeDraft(DEFAULTS),
      showToast: (text) => set({ ui: { ...get().ui, toast: { id: ++toastId, text } } }),
      dismissToast: (id) => {
        if (get().ui.toast?.id === id) get().setUi({ toast: null });
      },
      setUi: (patch) => set({ ui: { ...get().ui, ...patch } }),
    };
  });
  return Object.assign(api, { resumeLive: () => resumeLive() });
}

export type AppStoreApi = ReturnType<typeof createAppStore>;
