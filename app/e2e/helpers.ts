import { expect, type Page } from '@playwright/test';
import { DEFAULTS } from '../src/settings/schema.ts';
import { SETTINGS_KEY } from '../src/settings/storage.ts';

/** Sim mode with the placeholder camera, no auto passes. */
export const SIM_URL = './?sim=1&cam=fake&auto=0';

/** Saved settings with no arming time and no cooldown, so tests can pass quickly. */
export async function fastSettings(page: Page) {
  const s = { ...DEFAULTS, detection: { ...DEFAULTS.detection, warmupMs: 0, cooldownMs: 0 } };
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
    key: SETTINGS_KEY,
    value: JSON.stringify(s),
  });
}

export const chip = (page: Page) =>
  page.getByRole('status').filter({ hasText: /^(Arming|Stand-by|Timing|Paused)$/ });
export const hero = (page: Page) => page.getByTestId('lap-hero');
export const historyRows = (page: Page) =>
  page.getByRole('list', { name: 'Lap history' }).getByRole('listitem');

/** One simulated pass after `gapMs`; it is recorded at MOTION_END, 180 ms after the tap. */
export async function pass(page: Page, gapMs = 0) {
  if (gapMs) await page.waitForTimeout(gapMs);
  await page.getByRole('button', { name: 'Pass' }).click();
  await page.waitForTimeout(300);
}

/** Welcome → Get Ready → START → stand-by. */
export async function startSession(page: Page) {
  await page.goto(SIM_URL);
  await page.getByRole('button', { name: 'Get ready!' }).click();
  await expect(page.getByTestId('camera-health')).toBeVisible();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(chip(page)).toHaveText('Stand-by');
}
