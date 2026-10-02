// Flows 1–2 (spec §5.4) in sim mode, plus keyboard and layout-shift checks (plan 2.10).
import { expect, test } from '@playwright/test';
import { chip, fastSettings, hero, historyRows, pass, SIM_URL, startSession } from './helpers.ts';

test.beforeEach(async ({ page }) => fastSettings(page));

test('flow 1: GET READY → START → laps, best highlighted', async ({ page }) => {
  await startSession(page);
  await expect(hero(page)).toHaveText('--.--');
  await expect(page.getByTestId('lap-summary')).toHaveText('Waiting for first pass');

  await pass(page);
  await expect(chip(page)).toHaveText('Timing');
  await expect(page.getByTestId('lap-summary')).toHaveText('Lap 1 running');

  // Lap times ≈ 1.2 s, 0.5 s (best), 1.0 s, 0.8 s
  await pass(page, 900);
  await pass(page, 200);
  await pass(page, 700);
  await pass(page, 500);

  await expect(page.getByTestId('lap-summary')).toContainText('Laps 4');
  await expect(historyRows(page)).toHaveCount(3);
  const best = historyRows(page).and(page.locator('[data-best]'));
  await expect(best).toHaveCount(1);
  await expect(best).toContainText('#2');
  await expect(best).toContainText('Best');
  await expect(page.getByText('Lap 5 running')).toBeVisible();
});

test('flow 1b: latest lap best → green hero with BEST badge', async ({ page }) => {
  await startSession(page);
  await pass(page);
  await pass(page, 900);
  await pass(page, 200); // faster → best
  await expect(
    page.getByRole('region', { name: 'Latest lap' }).getByText('Best', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-best]')).toHaveCount(0);
});

test('flow 2: STOP / CONTINUE keeps laps and drops the in-progress lap; END → dialog, Cancel keeps it', async ({
  page,
}) => {
  await startSession(page);
  await pass(page);
  await pass(page, 400);
  await pass(page, 400);
  await expect(page.getByTestId('lap-summary')).toContainText('Laps 2');

  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(chip(page)).toHaveText('Paused');
  await expect(page.getByText('2 laps', { exact: true })).toBeVisible();

  await page.waitForTimeout(1500); // paused time is never counted
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(chip(page)).toHaveText('Stand-by');
  await pass(page); // only sets the reference
  await expect(page.getByTestId('lap-summary')).toContainText('Laps 2');
  await pass(page, 400);
  await expect(page.getByTestId('lap-summary')).toContainText('Laps 3');
  const lap3 = Number((await hero(page).textContent()) ?? '99');
  expect(lap3).toBeLessThan(1.2); // not 1.5 s + the paused gap

  await page.getByRole('button', { name: 'Stop' }).click();
  await page.getByRole('button', { name: 'End' }).click();
  const dialog = page.getByRole('dialog', { name: 'End session?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('3 laps will be discarded.');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(chip(page)).toHaveText('Paused');
  await expect(page.getByTestId('lap-summary')).toContainText('Laps 3');

  await page.getByRole('button', { name: 'End' }).click();
  await page.getByRole('button', { name: 'End session' }).click();
  await expect(page.getByRole('button', { name: 'Get ready!' })).toBeVisible();
});

test('END with 0 laps goes straight to Welcome', async ({ page }) => {
  await startSession(page);
  await page.getByRole('button', { name: 'Stop' }).click();
  await page.getByRole('button', { name: 'End' }).click();
  await expect(page.getByRole('button', { name: 'Get ready!' })).toBeVisible();
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('no layout shift on lap update', async ({ page }) => {
  await startSession(page);
  await pass(page);
  await pass(page, 300);
  const boxes = async () => ({
    hero: await page.getByRole('region', { name: 'Latest lap' }).boundingBox(),
    stop: await page.getByRole('button', { name: 'Stop' }).boundingBox(),
  });
  const before = await boxes();
  await pass(page, 300);
  await pass(page, 300);
  await page.waitForTimeout(300); // let the lap animation settle
  expect(await boxes()).toEqual(before);
});

test('full flow by keyboard: Space = primary action, P = pass, Esc closes dialogs', async ({ page }) => {
  await page.goto(SIM_URL);
  await page.waitForTimeout(350); // tap guard after the first screen
  await page.keyboard.press('Space');
  await expect(page.getByTestId('camera-health')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(chip(page)).toHaveText('Stand-by');
  await page.keyboard.press('p');
  await page.waitForTimeout(500);
  await page.keyboard.press('p');
  await page.waitForTimeout(300);
  await expect(page.getByTestId('lap-summary')).toContainText('Laps 1');
  await page.keyboard.press('Space');
  await expect(chip(page)).toHaveText('Paused');
  await page.waitForTimeout(350);
  await page.keyboard.press('Space');
  await expect(chip(page)).toHaveText('Stand-by');

  await page.getByRole('button', { name: 'New session' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('button', { name: 'New session' })).toBeFocused(); // focus restored
  await expect(chip(page)).toHaveText('Stand-by');
});
