import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { initialState, reduce } from '../app/machine.ts';
import { noopEffects, renderWithStore, testStore } from '../test/ui.tsx';
import { App } from './App.tsx';
import { buildLabel } from './build-info.ts';
import { primaryEvent } from './useKeyboard.ts';

const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));

describe('App', () => {
  it('renders Welcome with the build label', () => {
    renderWithStore(<App />);
    expect(screen.getByRole('heading', { name: 'Drone Lap Counter' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New session' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByTestId('build-label').textContent).toBe(buildLabel);
  });

  it('GET READY → Get Ready → START → Session (taps guarded for 300 ms)', async () => {
    const store = testStore({ effects: noopEffects({ cameraLive: { width: 240, height: 480, fps: 30 } }) });
    renderWithStore(<App />, store);
    const getReady = screen.getByRole('button', { name: 'Get ready!' });
    fireEvent.click(getReady);
    expect(store.getState().state.screen).toBe('welcome'); // within the guard window
    await wait(320);
    fireEvent.click(getReady);
    expect(store.getState().state.screen).toBe('getReady');
    await wait(320);
    expect(screen.getByTestId('camera-health').textContent).toBe('30 fps · front camera');
    const stats = {
      fps: 0,
      deliveredFps: null,
      dropped: 0,
      msPerFrame: 0,
      ratio: 0,
      tSource: 'now' as const,
    };
    act(() => store.getState().setUi({ stats })); // engine started, no frame interval yet
    expect(screen.getByTestId('camera-health').textContent).toBe('30 fps · front camera');
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(store.getState().state.screen).toBe('session');
    expect(screen.getByRole('status').textContent).toBe('Arming');
    expect(screen.getByTestId('lap-hero').textContent).toBe('--.--');
  });

  it('Configuration shows Save and the schema groups', () => {
    const store = testStore();
    renderWithStore(<App />, store);
    act(() => store.getState().dispatch({ type: 'NAV_CONFIG' }));
    expect(screen.getByRole('heading', { name: 'Configuration', level: 1 })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
    for (const g of ['Camera', 'Detection', 'Timing filters', 'Audio', 'Performance', 'Test & calibrate']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${g}`) })).toBeTruthy();
    }
    act(() => store.getState().setDraft('detection.pixelDiffThreshold', 0));
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('audio UI (M6)', () => {
  const inSession = (opts: { audioLocked?: boolean; unlock?: () => void } = {}) => {
    const fx = noopEffects();
    if (opts.unlock) fx.audio.unlock = opts.unlock;
    const state = reduce(reduce(initialState, { type: 'GET_READY' }).state, { type: 'CAMERA_LIVE' }).state;
    const store = testStore({
      effects: fx,
      state: reduce(state, { type: 'START' }).state,
      ui: { audioLocked: opts.audioLocked ?? false },
    });
    renderWithStore(<App />, store);
    return store;
  };

  it('locked audio → "Tap to enable sound"; the tap unlocks inside the handler', () => {
    let unlocks = 0;
    const store = inSession({ audioLocked: true, unlock: () => unlocks++ });
    fireEvent.click(screen.getByRole('button', { name: 'Tap to enable sound' }));
    expect(unlocks).toBe(1);
    act(() => store.getState().setUi({ audioLocked: false }));
    expect(screen.queryByRole('button', { name: 'Tap to enable sound' })).toBeNull();
  });

  it('no banner when beeps and voice are both off', () => {
    const fx = noopEffects();
    fx.settings.save({ ...fx.settings.load(), audio: { beep: false, voice: false, announceBest: true } });
    const state = reduce(reduce(initialState, { type: 'GET_READY' }).state, { type: 'CAMERA_LIVE' }).state;
    const store = testStore({ effects: fx, state: reduce(state, { type: 'START' }).state });
    renderWithStore(<App />, store);
    act(() => store.getState().setUi({ audioLocked: true }));
    expect(screen.queryByRole('button', { name: 'Tap to enable sound' })).toBeNull();
  });

  it('Configuration says when no voice is available', () => {
    const store = testStore();
    renderWithStore(<App />, store);
    act(() => store.getState().dispatch({ type: 'NAV_CONFIG' }));
    expect(screen.queryByText(/Voice not available/)).toBeNull();
    act(() => store.getState().setUi({ voiceAvailable: false }));
    expect(screen.getByText(/Voice not available/)).toBeTruthy();
  });
});

describe('primaryEvent (Space / Enter)', () => {
  it('maps the visible primary action per screen', () => {
    const r = (s = initialState, ...es: Parameters<typeof reduce>[1][]) =>
      es.reduce((a, e) => reduce(a, e).state, s);
    expect(primaryEvent(initialState)).toEqual({ type: 'GET_READY' });
    const starting = r(initialState, { type: 'GET_READY' });
    expect(primaryEvent(starting)).toBeNull();
    expect(primaryEvent(r(starting, { type: 'CAMERA_LIVE' }))).toEqual({ type: 'START' });
    expect(primaryEvent(r(starting, { type: 'CAMERA_ERROR', error: { kind: 'busy', message: '' } }))).toEqual(
      {
        type: 'RETRY',
      },
    );
    const session = r(starting, { type: 'CAMERA_LIVE' }, { type: 'START' });
    expect(primaryEvent(session)).toEqual({ type: 'STOP' });
    expect(primaryEvent(r(session, { type: 'STOP' }))).toEqual({ type: 'CONTINUE' });
    expect(primaryEvent(r(session, { type: 'STOP' }, { type: 'NAV_CONFIG' }))).toBeNull(); // dialog
    expect(primaryEvent(r(initialState, { type: 'NAV_CONFIG' }))).toBeNull();
  });
});

describe('Configuration › Camera (M7)', () => {
  const cameras = [
    { deviceId: 'cam-1', label: 'Front camera' },
    { deviceId: 'cam-2', label: 'Back camera' },
  ];
  const open = async (ui = {}) => {
    const state = reduce(initialState, { type: 'NAV_CONFIG' }).state; // no screen transition
    const store = testStore({ effects: noopEffects({ cameras }), ui, state });
    renderWithStore(<App />, store);
    await act(() => Promise.resolve()); // refreshCameras on mount
    return store;
  };
  const picker = () => screen.getByLabelText('Device') as HTMLSelectElement;
  const report = () => screen.getByTestId('camera-report').textContent ?? '';

  it('lists the cameras on entry; Automatic = null; a saved camera that is gone stays selectable', async () => {
    const store = await open();
    expect([...picker().options].map((o) => o.text)).toEqual(['Automatic', 'Front camera', 'Back camera']);
    fireEvent.change(picker(), { target: { value: 'cam-2' } });
    expect(store.getState().draft.camera.deviceId).toBe('cam-2');
    fireEvent.change(picker(), { target: { value: '' } });
    expect(store.getState().draft.camera.deviceId).toBeNull();
    act(() => store.getState().setDraft('camera.deviceId', 'gone'));
    expect(picker().value).toBe('gone');
    expect(picker().selectedOptions[0]?.text).toBe('Saved camera (not connected)');
  });

  it('capability per device: unknown until it ran; Automatic shows the last device', async () => {
    const exposure = { supported: true, mode: 'manual', value: 100, range: { min: 1, max: 1250 } };
    const store = await open({
      cameraCaps: {
        'cam-1': { label: 'Front camera', exposure: { supported: false }, focus: { supported: false } },
        'cam-2': { label: 'Back camera', exposure, focus: { supported: true, mode: 'continuous', value: 0.25 } },
      },
      lastDeviceId: 'cam-1',
    });
    expect(report()).toMatch(/Front camera.*Exposure control\s*not supported/);
    expect(screen.getByText(/Manual exposure is not supported on this camera/)).toBeTruthy();
    act(() => store.getState().setDraft('camera.deviceId', 'cam-2'));
    expect(report()).toContain('supported · manual 100 (range 1–1250)');
    expect(report()).toContain('supported · continuous 0.25');
    act(() => store.getState().setDraft('camera.deviceId', 'gone'));
    expect(report()).toMatch(/show here once this camera has run/);
  });
});
