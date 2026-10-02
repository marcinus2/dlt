// Flow 6 (spec §5.4): axe on every gallery preset (Chromium + WebKit) + WebKit layout smoke.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { PRESETS } from '../src/ui/gallery/presets.ts';

test('the gallery lists every preset', async ({ page }) => {
  await page.goto('./?gallery');
  await expect(page.getByRole('heading', { name: 'State gallery' })).toBeVisible();
  await expect(page.getByRole('link').filter({ hasNotText: 'Open the app' })).toHaveCount(PRESETS.length);
});

for (const p of PRESETS) {
  test(`axe + layout: ${p.group} / ${p.title}`, async ({ page }) => {
    await page.goto(`./?state=${p.id}`);
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'SIMULATED' })).toBeVisible();
    await page.waitForTimeout(400); // screen / dialog animations

    // No horizontal page scroll at phone width.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    const { violations } = await new AxeBuilder({ page }).analyze();
    const serious = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
    expect(serious).toEqual([]);
  });
}
