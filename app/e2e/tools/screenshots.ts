// Captures every gallery preset as a PNG (plan 3.4). Needs a build: `npm run build && npm run screenshots`.
// Usage: npm run screenshots [-- --out=../docs/final/ux]

import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium, devices } from '@playwright/test';

const PORT = 4174;
const base = `http://localhost:${PORT}/`;
const out = process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? '../docs/final/ux';
mkdirSync(out, { recursive: true });

const server: ChildProcess = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
});
try {
  for (let i = 0; i < 50; i++) {
    if (
      await fetch(base).then(
        (r) => r.ok,
        () => false,
      )
    )
      break;
    await new Promise((r) => setTimeout(r, 200));
  }
  const browser = await chromium.launch();
  const views = [
    { name: 'phone', ctx: devices['Pixel 7'] },
    { name: 'desktop', ctx: { viewport: { width: 1280, height: 800 } } },
  ];
  for (const v of views) {
    const context = await browser.newContext({ ...v.ctx, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(`${base}?gallery`);
    const ids = await page
      .locator('a[href*="state="]')
      .evaluateAll((as) =>
        as.map((a) => new URL((a as HTMLAnchorElement).href).searchParams.get('state') ?? ''),
      );
    for (const id of ids.filter(Boolean)) {
      await page.goto(`${base}?state=${id}&auto=0`);
      await page.getByRole('navigation', { name: 'Main' }).waitFor();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${out}/${v.name}-${id}.png` });
    }
    console.log(`${v.name}: ${ids.length} screenshots`);
    await context.close();
  }
  await browser.close();
} finally {
  server.kill();
}
