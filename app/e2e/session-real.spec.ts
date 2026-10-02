// Flows 1–2 (spec §5.4) on the real pipeline (plan 5.5): Chromium's fake camera plays the synthetic
// clip (e2e/tools/make-y4m.ts) through CameraSource → FrameAnalyzer → DetectorEngine, default settings.
import { expect, type Page, test } from '@playwright/test';
import { chip, hero, historyRows } from './helpers.ts';
import { LAPS_MS } from './tools/make-y4m.ts';

const TOL_S = 0.1; // headless frame delivery jitters by a frame or two
const PASS_WAIT = { timeout: 15_000 }; // warm-up + up to one 4.5 s lap, with slack

test.setTimeout(60_000);

const summary = (page: Page) => page.getByTestId('lap-summary');
const seconds = (text: string | null) => Number(text?.trim());

/** Every lap time on screen (history + hero), in seconds. */
async function lapTimes(page: Page): Promise<number[]> {
  const rows = await historyRows(page).locator('.font-mono').allTextContents();
  return [...rows, (await hero(page).textContent()) ?? ''].map(seconds);
}

function expectClipLap(s: number) {
  const near = LAPS_MS.some((ms) => Math.abs(s - ms / 1000) <= TOL_S);
  expect(near, `${s} s is not a clip lap (${LAPS_MS.join(', ')} ms)`).toBe(true);
}

async function tracks(page: Page): Promise<string[] | undefined> {
  return page.evaluate(() =>
    (window as unknown as { stream?: MediaStream }).stream?.getTracks().map((t) => t.readyState),
  );
}

/** Welcome → Get Ready on the real camera: health line, a pass flashes the ROI border (5.2). */
async function getReady(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: 'Get ready!' }).click();
  await expect(page.getByTestId('camera-health')).toHaveText(/^\d+ fps · front camera$/, PASS_WAIT);
  await expect(page.getByText('SIMULATED')).toHaveCount(0);
  await expect(page.getByTestId('roi-flash')).toBeAttached(PASS_WAIT);
  await page.evaluate(() => {
    const w = window as unknown as { stream?: MediaStream };
    w.stream = document.querySelector('video')?.srcObject as MediaStream;
  });
}

test('flow 1 (real): GET READY → START → laps match the clip, best highlighted', async ({ page }) => {
  await getReady(page);
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(chip(page)).toHaveText('Stand-by', PASS_WAIT); // after warm-up
  await expect(chip(page)).toHaveText('Timing', PASS_WAIT);
  await expect(summary(page)).toContainText('Laps 3', { timeout: 20_000 });

  // Three consecutive laps of the 4.5 / 3.0 / 4.5 s loop: exactly one is best (3.0 s).
  const times = await lapTimes(page);
  expect(times.length).toBeGreaterThanOrEqual(3);
  for (const s of times) expectClipLap(s);
  await expect(page.locator('[data-best]')).toHaveCount(1, PASS_WAIT); // once the best isn't the latest
  const best = seconds(await page.locator('[data-best] .font-mono').textContent());
  expect(Math.abs(best - 3)).toBeLessThanOrEqual(TOL_S);
});

test('flow 2 (real): STOP releases the camera, CONTINUE drops the in-progress lap, END → dialog', async ({
  page,
}) => {
  await getReady(page);
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(summary(page)).toContainText('Laps 2', { timeout: 25_000 });

  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(chip(page)).toHaveText('Paused');
  await expect(page.getByText('2 laps', { exact: true })).toBeVisible();
  expect(await tracks(page)).toEqual(['ended']);

  await page.waitForTimeout(1500); // paused time is never counted
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(chip(page)).toHaveText('Stand-by', PASS_WAIT);
  await expect(chip(page)).toHaveText('Timing', PASS_WAIT); // first pass only sets the reference
  await expect(summary(page)).toContainText('Laps 2');
  await expect(summary(page)).toContainText('Laps 3', PASS_WAIT);
  expectClipLap(seconds(await hero(page).textContent())); // not a lap + the paused gap

  await page.getByRole('button', { name: 'Stop' }).click();
  await page.getByRole('button', { name: 'End' }).click();
  const dialog = page.getByRole('dialog', { name: 'End session?' });
  await expect(dialog).toContainText('3 laps will be discarded.');
  await dialog.getByRole('button', { name: 'End session' }).click();
  await expect(page.getByRole('button', { name: 'Get ready!' })).toBeVisible();
});
