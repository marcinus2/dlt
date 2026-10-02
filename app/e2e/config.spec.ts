// Flow 3 (spec §5.4) in sim mode: draft / discard / Save survives reload.
import { expect, type Page, test } from '@playwright/test';
import { SIM_URL } from './helpers.ts';

const fps = (page: Page) => page.getByLabel('Frame rate', { exact: true });

test('flow 3: edit → New session → discard dialog; Save survives reload', async ({ page }) => {
  await page.goto(SIM_URL);
  await page.getByRole('button', { name: 'Configuration' }).click();
  await expect(page.getByRole('heading', { name: 'Configuration', level: 1 })).toBeVisible();
  await expect(fps(page)).toHaveValue('30');

  await fps(page).selectOption('60');
  await page.getByRole('button', { name: 'New session' }).click();
  const dialog = page.getByRole('dialog', { name: 'Discard changes?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep editing' }).click();
  await expect(fps(page)).toHaveValue('60');

  await page.getByRole('button', { name: 'New session' }).click();
  await dialog.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByRole('button', { name: 'Get ready!' })).toBeVisible();
  await page.getByRole('button', { name: 'Configuration' }).click();
  await expect(fps(page)).toHaveValue('30'); // reverted

  await fps(page).selectOption('60');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Get ready!' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Configuration' }).click();
  await expect(fps(page)).toHaveValue('60');
  expect(
    await page.evaluate(() => Object.keys(localStorage).filter((k) => !k.startsWith('dronelap.'))),
  ).toEqual([]);
});

test('invalid values disable Save; clean Save leaves without the dialog', async ({ page }) => {
  await page.goto(SIM_URL);
  await page.getByRole('button', { name: 'Configuration' }).click();
  const threshold = page.getByLabel('Pixel threshold', { exact: true });
  await threshold.fill('250');
  await expect(page.getByText('Must be 1–100')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  await threshold.fill('20');
  await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
  await page.getByRole('button', { name: 'Reset to defaults' }).click();
  await expect(threshold).toHaveValue('10');
  await page.getByRole('button', { name: 'New session' }).click(); // clean again → no dialog
  await expect(page.getByRole('button', { name: 'Get ready!' })).toBeVisible();
});
