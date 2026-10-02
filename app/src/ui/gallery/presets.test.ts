import { describe, expect, it } from 'vitest';
import { findPreset, PRESETS, presetState } from './presets.ts';

const state = (id: string) => {
  const p = findPreset(id);
  if (!p) throw new Error(id);
  return presetState(p);
};

describe('gallery presets', () => {
  it('ids are unique', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
  });

  it('reach the intended states through the real reducer', () => {
    expect(state('welcome').screen).toBe('welcome');
    expect(state('getReady').camera).toBe('live');
    expect(state('cameraError-permission').camera).toEqual({
      error: expect.objectContaining({ kind: 'permission' }),
    });
    expect(state('arming').session?.phase).toBe('arming');
    expect(state('standby').session).toMatchObject({ phase: 'ready', timing: { kind: 'standby' } });
    expect(state('timing').session?.laps).toHaveLength(5);
    const best = state('latestBest').session;
    expect(best?.bestIdx).toBe((best?.laps.length ?? 0) - 1);
    expect(state('laps600').session?.laps).toHaveLength(600);
    expect(state('pausedHidden')).toMatchObject({ screen: 'paused', pauseReason: 'hidden' });
    expect(state('pausedCameraLost').pauseReason).toBe('cameraLost');
    expect(state('dialogLeave').dialog).toEqual({ kind: 'leaveSession', to: 'welcome' });
    expect(state('dialogEnd').dialog).toEqual({ kind: 'endSession' });
    expect(state('dialogDiscard').dialog).toEqual({ kind: 'discardConfig' });
    expect(state('configDirty')).toMatchObject({ configDirty: true, configValid: true });
    expect(state('configInvalid')).toMatchObject({ configDirty: true, configValid: false });
  });

  it('an unknown id finds nothing', () => {
    expect(findPreset('nope')).toBeUndefined();
    expect(findPreset(null)).toBeUndefined();
  });
});
