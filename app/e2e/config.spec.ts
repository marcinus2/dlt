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

// Real pipeline (plan 7.4, 7.6): Chromium's fake camera plays the synthetic clip (passes at 1.0 / 5.5 /
// 8.5 s of a 12 s loop → laps 4.5 / 3.0 / 4.5 s).
test.describe('real engine', () => {
  test.setTimeout(60_000);
  const WAIT = { timeout: 15_000 };

  async function openTest(page: Page) {
    await page.goto('./');
    await page.getByRole('button', { name: 'Configuration' }).click();
    await page.getByRole('button', { name: /^Test & calibrate/ }).click();
    await page.getByRole('button', { name: 'Start test' }).click();
    await expect(page.getByTestId('tuning-health')).toHaveText(/\d+ fps · front camera/, WAIT);
    await page.evaluate(() => {
      const w = window as unknown as { stream?: MediaStream };
      w.stream = document.querySelector('video')?.srcObject as MediaStream;
    });
  }

  const tracks = (page: Page) =>
    page.evaluate(() =>
      (window as unknown as { stream?: MediaStream }).stream?.getTracks().map((t) => t.readyState),
    );

  test('Test & calibrate: meter, preset moves the overlay, Calibrate updates the draft, leaving stops the camera', async ({
    page,
  }) => {
    await openTest(page);
    const panel = page.getByTestId('test-calibrate');
    await expect(panel.getByTestId('ratio-value')).toHaveText(/%$/); // samples reach the meter
    await expect(panel.getByTestId('roi-flash')).toBeAttached(WAIT); // a clip pass flashes the region

    // Preset → overlay moves (V line: 15 % wide, centred).
    const roi = panel.getByTestId('roi');
    const layer = (await roi.locator('..').boundingBox()) ?? { width: 0, x: 0 };
    await page.getByRole('button', { name: 'V line' }).click();
    await expect
      .poll(async () => ((await roi.boundingBox())?.width ?? 0) / layer.width)
      .toBeCloseTo(0.15 - 4 / layer.width, 1);

    // Calibrate writes the start ratio into the draft (default 2 %).
    const start = page.getByRole('textbox', { name: 'Start ratio' });
    await expect(start).toHaveValue('2');
    await page.getByRole('button', { name: 'Calibrate', exact: true }).click();
    await expect(page.getByTestId('calibration-result')).toBeVisible(WAIT);
    await expect(start).not.toHaveValue('2');

    // Capability of the camera that ran (fake camera: no exposure / focus control); picker has names.
    await expect(page.getByTestId('camera-report')).toContainText('Exposure control');
    await expect(page.getByTestId('camera-report')).toContainText('not supported');
    await expect(page.getByLabel('Device', { exact: true }).locator('option')).not.toHaveText(['Automatic']);

    // Leaving Configuration stops the camera (dirty → discard).
    await page.getByRole('button', { name: 'New session' }).click();
    await page
      .getByRole('dialog', { name: 'Discard changes?' })
      .getByRole('button', { name: 'Discard' })
      .click();
    await expect.poll(() => tracks(page)).toEqual(['ended']);
  });

  test('Stop test and closing the group stop the camera', async ({ page }) => {
    await openTest(page);
    await page.getByRole('button', { name: 'Stop test' }).click();
    await expect.poll(() => tracks(page)).toEqual(['ended']);
    await page.getByRole('button', { name: 'Start test' }).click();
    await expect(page.getByTestId('tuning-health')).toHaveText(/fps/, WAIT);
    await page.evaluate(() => {
      const w = window as unknown as { stream?: MediaStream };
      w.stream = document.querySelector('video')?.srcObject as MediaStream;
    });
    await page.getByRole('button', { name: /^Test & calibrate/ }).click();
    await expect.poll(() => tracks(page)).toEqual(['ended']);
  });

  test('flow 3 (real): a saved minimum lap time reaches the engine', async ({ page }) => {
    await page.goto('./');
    await page.getByRole('button', { name: 'Configuration' }).click();
    await page.getByRole('button', { name: /^Timing filters/ }).click();
    await page.getByLabel('Minimum lap time', { exact: true }).fill('5000');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('button', { name: 'Get ready!' }).click();
    await expect(page.getByTestId('camera-health')).toBeVisible(WAIT);
    await page.getByRole('button', { name: 'Start' }).click();
    // With a 5 s cooldown the clip's 4.5 / 3.0 s laps can't happen: the first lap is ≥ 7.5 s.
    await expect(page.getByTestId('lap-summary')).toContainText('Laps 1', { timeout: 30_000 });
    const lap = Number((await page.getByTestId('lap-hero').textContent())?.trim());
    expect(lap).toBeGreaterThanOrEqual(7.4);
  });
});
