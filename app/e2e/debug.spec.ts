// Engine debug page (plan 4.10) on Chromium's built-in fake camera: the real
// CameraSource → FrameAnalyzer → DetectorEngine path runs, and Stop leaves nothing running.
import { expect, test } from '@playwright/test';

test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  permissions: ['camera'],
});

const hudLine = async (page: import('@playwright/test').Page, key: string) =>
  ((await page.locator('pre').textContent()) ?? '').split('\n').find((l) => l.startsWith(key)) ?? '';

test('fake camera: frames processed, CSV export, Stop releases the camera', async ({ page }) => {
  await page.goto('./?debug=engine');
  await expect(page.getByRole('heading', { name: /Engine debug/ })).toBeVisible();
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.getByRole('list', { name: 'Event log' })).toContainText('CAMERA');

  // fps climbs, frames are recorded, warm-up ends.
  await expect
    .poll(async () => Number((await hudLine(page, 'fps')).split(/\s+/)[1]), { timeout: 10_000 })
    .toBeGreaterThan(5);
  await expect.poll(() => hudLine(page, 'phase'), { timeout: 10_000 }).toMatch(/phase\s+(armed|motion)/);
  await expect
    .poll(async () => Number((await hudLine(page, 'roi px')).match(/recorded (\d+)/)?.[1]))
    .toBeGreaterThan(30);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Frames CSV' }).click();
  const csv = await (await (await download).createReadStream()).toArray();
  const lines = Buffer.concat(csv).toString().trim().split('\n');
  expect(lines[0]).toBe('t,ratio,globalRatio,global,state');
  expect(lines.length).toBeGreaterThan(30);

  // Keep a handle on the stream, then check its tracks after Stop.
  await page.evaluate(() => {
    const w = window as unknown as { stream?: MediaStream };
    w.stream = document.querySelector('video')?.srcObject as MediaStream;
  });
  await page.getByRole('button', { name: 'Stop' }).click();
  const states = await page.evaluate(() => {
    const w = window as unknown as { stream?: MediaStream };
    return w.stream?.getTracks().map((t) => t.readyState);
  });
  expect(states).toEqual(['ended']);
  // No more frames after Stop: once the HUD shows it, the recorded count stays put and fps decays to 0.
  await expect.poll(() => hudLine(page, 'phase')).toMatch(/phase\s+stopped/);
  const frames = (await hudLine(page, 'roi px')).match(/recorded (\d+)/)?.[1];
  await expect.poll(() => hudLine(page, 'fps'), { timeout: 5_000 }).toMatch(/^fps\s+0\.0/);
  expect((await hudLine(page, 'roi px')).match(/recorded (\d+)/)?.[1]).toBe(frames);
});
