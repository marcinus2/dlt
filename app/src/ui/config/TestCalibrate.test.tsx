import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { type AppEvent, initialState, reduce } from '../../app/machine.ts';
import type { MotionSample } from '../../engine/types.ts';
import { noopEffects, renderWithStore, testStore } from '../../test/ui.tsx';
import { meterPos, TestCalibrate } from './TestCalibrate.tsx';

const tuningLive = () =>
  (['NAV_CONFIG', 'TUNE_START', 'CAMERA_LIVE'] as AppEvent['type'][]).reduce(
    (s, type) => reduce(s, { type } as AppEvent).state,
    initialState,
  );

function setup() {
  const fx = noopEffects();
  const listeners = new Set<(x: MotionSample) => void>();
  fx.engine.on = ((e: string, cb: (x: MotionSample) => void) => {
    if (e !== 'sample') return () => {};
    listeners.add(cb);
    return () => listeners.delete(cb);
  }) as typeof fx.engine.on;
  const store = testStore({ effects: fx, state: tuningLive() });
  renderWithStore(<TestCalibrate />, store);
  const emit = (t: number, ratio: number, global = false) =>
    act(() => {
      for (const cb of [...listeners]) cb({ t, ratio, globalRatio: 0, global, gapReset: false });
    });
  return { store, emit, listeners };
}

describe('Test & calibrate', () => {
  it('meter scale: log from 0.01 % to 100 %', () => {
    expect(meterPos(0)).toBe(0);
    expect(meterPos(0.0001)).toBe(0);
    expect(meterPos(0.01)).toBe(0.5);
    expect(meterPos(1)).toBe(1);
  });

  it('Calibrate watches durationMs of samples and writes start/end ratio into the draft', () => {
    const { store, emit } = setup();
    expect(store.getState().draft.detection.startRatio).toBe(0.02);
    fireEvent.click(screen.getByRole('button', { name: 'Calibrate' }));
    expect(screen.getByText(/keep the scene still/)).toBeTruthy();
    emit(1000, 0, true); // first frame: excluded
    for (let t = 1033; t < 4000; t += 33) emit(t, t % 2 ? 0.004 : 0.006);
    emit(4000, 0.005);
    const d = store.getState().draft.detection;
    expect(d.startRatio).toBe(0.00997); // mean 0.005 + 5σ (≈ 0.001) beats 1.2·max; 3 digits
    expect(d.endRatio).toBeCloseTo(d.startRatio / 2, 5);
    expect(store.getState().state.configDirty).toBe(true);
    expect(screen.getByTestId('calibration-result').textContent).toMatch(/Save to keep them/);
  });

  it('only global frames → failed, draft unchanged; samples stop flowing to the calibrator', () => {
    const { store, emit, listeners } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Calibrate' }));
    const during = listeners.size;
    emit(0, 0, true);
    emit(3000, 0, true);
    expect(screen.getByText(/no usable frames/)).toBeTruthy();
    expect(store.getState().draft.detection.startRatio).toBe(0.02);
    expect(listeners.size).toBe(during - 1);
  });

  it('Calibrate is off until the camera is live', () => {
    const fx = noopEffects();
    const starting = reduce(reduce(initialState, { type: 'NAV_CONFIG' }).state, { type: 'TUNE_START' }).state;
    renderWithStore(<TestCalibrate />, testStore({ effects: fx, state: starting }));
    expect((screen.getByRole('button', { name: 'Calibrate' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Starting camera…')).toBeTruthy();
  });
});
