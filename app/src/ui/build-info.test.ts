import { describe, expect, it } from 'vitest';
import { APP_VERSION, buildLabel, GIT_SHA } from './build-info.ts';

describe('build info', () => {
  it('labels the build with version and git SHA', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(GIT_SHA).not.toBe('');
    expect(buildLabel).toBe(`v${APP_VERSION} · ${GIT_SHA}`);
  });
});
