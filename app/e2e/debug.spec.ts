// Configuration › Diagnostics (plan 7.5, `?debug=1`) on Chromium's fake camera: it watches the
// Test & calibrate engine (real CameraSource → FrameAnalyzer → DetectorEngine), logs the clip's
// passes, draws the diff view and exports CSV; Stop test leaves nothing running.
import { expect, type Page, test } from '@playwright/test';

test.setTimeout(45_000);

const hudLine = async (page: Page, key: string) =>
  ((await page.getByTestId('engine-hud').textContent()) ?? '').split('\n').find((l) => l.startsWith(key)) ??
  '';

test('diagnostics: HUD, event log, diff view, CSV export; Stop test stops the frames', async ({ page }) => {
  await page.goto('./?debug=1');
  await page.getByRole('button', { name: 'Configuration' }).click();
  await page.getByRole('button', { name: /^Test & calibrate/ }).click();
  await page.getByRole('button', { name: 'Start test' }).click();
  await page.getByRole('button', { name: /^Diagnostics/ }).click();
  await expect(page.getByTestId('engine-hud')).toContainText('live (Test & calibrate)');

  await expect
    .poll(async () => Number((await hudLine(page, 'fps')).split(/\s+/)[1]), { timeout: 10_000 })
    .toBeGreaterThan(5);
  await expect.poll(() => hudLine(page, 'phase'), { timeout: 10_000 }).toMatch(/phase\s+(armed|motion)/);
  await expect
    .poll(async () => Number((await hudLine(page, 'roi px')).match(/recorded (\d+)/)?.[1]))
    .toBeGreaterThan(30);
  await expect(page.getByRole('list', { name: 'Event log' })).toContainText('MOTION END', {
    timeout: 15_000,
  });
  expect(await page.getByRole('img', { name: /Diff view/ }).evaluate((c: HTMLCanvasElement) => c.width)).toBe(
    160,
  );

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Frames CSV' }).click();
  const csv = await (await (await download).createReadStream()).toArray();
  const lines = Buffer.concat(csv).toString().trim().split('\n');
  expect(lines[0]).toBe('t,ratio,globalRatio,global,state');
  expect(lines.length).toBeGreaterThan(30);

  await page.getByRole('button', { name: 'Stop test' }).click();
  await expect.poll(() => hudLine(page, 'phase')).toMatch(/phase\s+stopped/);
  const frames = (await hudLine(page, 'roi px')).match(/recorded (\d+)/)?.[1];
  await expect.poll(() => hudLine(page, 'fps'), { timeout: 5_000 }).toMatch(/^fps\s+0\.0/);
  expect((await hudLine(page, 'roi px')).match(/recorded (\d+)/)?.[1]).toBe(frames);
});
