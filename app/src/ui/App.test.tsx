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
