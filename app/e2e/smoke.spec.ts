import { expect, test } from '@playwright/test';

test('shell renders with build label and manifest', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Drone Lap Counter' })).toBeVisible();
  await expect(page.getByTestId('build-label')).toHaveText(/^v\d+\.\d+\.\d+.* · \w+$/);

  const manifest = await page.request.get('./manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  expect(await manifest.json()).toMatchObject({ display: 'standalone', orientation: 'portrait' });
});

test('no external requests (fonts are self-hosted)', async ({ page, baseURL }) => {
  const external: string[] = [];
  page.on('request', (req) => {
    if (!req.url().startsWith(baseURL ?? '')) external.push(req.url());
  });
  await page.goto('./');
  await page.evaluate(() => document.fonts.ready);
  expect(external).toEqual([]);
  expect(await page.evaluate(() => document.fonts.check('16px "Inter Variable"'))).toBe(true);
});

test('PoC is served at /poc/ without a service worker', async ({ page, request }) => {
  const res = await request.get('./poc/');
  test.skip(!res.ok(), 'dist/poc not built (run `npm run build:pages`)');
  await page.goto('./poc/');
  await expect(page).toHaveTitle(/PoC/);
  await page.waitForLoadState('load');
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
});
