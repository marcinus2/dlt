// Platform robustness (plan 8.8): flow 4 (permission denied → error card), auto-pause on
// visibility, camera lost mid-session, wake lock, beforeunload. Permission and wake lock are mocked
// in an init script; visibility is overridden and the event dispatched by hand.
import { expect, type Page, test } from '@playwright/test';
import { chip, fastSettings, pass, startSession } from './helpers.ts';

const LIVE = { timeout: 15_000 };

type Win = typeof window & {
  __camera: { deny: boolean; state: PermissionState };
  __wake: { calls: string[]; reject: boolean };
};

/** getUserMedia rejects with NotAllowedError while `deny`; permissions.query reports `state`. */
async function mockPermission(page: Page, state: PermissionState) {
  await page.addInitScript((initial) => {
    const w = window as Win;
    w.__camera = { deny: true, state: initial };
    const md = navigator.mediaDevices;
    const gum = md.getUserMedia.bind(md);
    md.getUserMedia = (c) =>
      w.__camera.deny ? Promise.reject(new DOMException('Permission denied', 'NotAllowedError')) : gum(c);
    const query = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (d) =>
      d.name === 'camera' ? Promise.resolve({ state: w.__camera.state } as PermissionStatus) : query(d);
  }, state);
}

/** Records wake lock requests / releases; requests reject while `reject`. */
async function mockWakeLock(page: Page, reject = false) {
  await page.addInitScript((rejectAll) => {
    const w = window as Win;
    w.__wake = { calls: [], reject: rejectAll };
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        async request() {
          w.__wake.calls.push('request');
          if (w.__wake.reject) throw new DOMException('denied', 'NotAllowedError');
          const s = Object.assign(new EventTarget(), {
            released: false,
            async release() {
              s.released = true;
              w.__wake.calls.push('release');
            },
          });
          return s;
        },
      },
    });
  }, reject);
}

const alert = (page: Page, text: string) => page.getByRole('alert').filter({ hasText: text });

const wakeCalls = (page: Page) => page.evaluate(() => (window as Win).__wake.calls);

async function setVisibility(page: Page, state: DocumentVisibilityState) {
  await page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => s === 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

const videoTracks = (page: Page) =>
  page.evaluate(() =>
    ((document.querySelector('video')?.srcObject as MediaStream | null)?.getTracks() ?? []).map(
      (t) => t.readyState,
    ),
  );

test.describe('flow 4: permission denied → error card', () => {
  test('blocked: platform steps, START disabled; Retry after allowing starts the camera', async ({
    page,
  }) => {
    await mockPermission(page, 'denied');
    await page.goto('./');
    await page.getByRole('button', { name: 'Get ready!' }).click();
    const card = page.getByTestId('camera-error');
    await expect(card).toContainText('Camera blocked');
    await expect(card).toContainText('Permissions → Camera'); // Android steps (Pixel 7 profile)
    await expect(page.getByRole('button', { name: 'Start' })).toBeDisabled();

    await page.evaluate(() => {
      (window as Win).__camera = { deny: false, state: 'granted' };
    });
    await card.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByTestId('camera-health')).toBeVisible(LIVE);
    await expect(page.getByRole('button', { name: 'Start' })).toBeEnabled();
  });

  test('prompt dismissed: "not allowed yet" asks to tap Retry and allow', async ({ page }) => {
    await mockPermission(page, 'prompt');
    await page.goto('./');
    await page.getByRole('button', { name: 'Get ready!' }).click();
    await expect(page.getByTestId('camera-error')).toContainText('Camera not allowed yet');
    await expect(page.getByTestId('camera-error')).toContainText('choose Allow');
  });
});

test.describe('auto-pause (sim)', () => {
  test.beforeEach(async ({ page }) => fastSettings(page));

  test('hidden mid-session → Paused with the background banner; CONTINUE keeps the laps', async ({
    page,
  }) => {
    await startSession(page);
    await pass(page);
    await pass(page, 400);
    await setVisibility(page, 'hidden');
    await expect(chip(page)).toHaveText('Paused');
    // Headless Chromium rejects the real wake lock, so its banner shows too.
    await expect(alert(page, 'Paused — app was in background')).toBeVisible();

    await setVisibility(page, 'visible');
    await expect(chip(page)).toHaveText('Paused'); // stays paused on return (spec §3.4)
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(chip(page)).toHaveText('Stand-by');
    await expect(page.getByTestId('lap-summary')).toContainText('Laps 1');
    await expect(alert(page, 'Paused — app was in background')).toHaveCount(0);
  });

  test('beforeunload prompts while the session has data, not before', async ({ page }) => {
    await startSession(page);
    const dialogs: string[] = [];
    page.on('dialog', (d) => {
      dialogs.push(d.type());
      void d.dismiss();
    });
    await page.close({ runBeforeUnload: true });
    await expect.poll(() => page.isClosed()).toBe(true);
    expect(dialogs).toEqual([]);
  });

  test('beforeunload: a pass in the session → the leave prompt', async ({ page }) => {
    await startSession(page);
    await pass(page);
    const dialog = page.waitForEvent('dialog');
    await page.close({ runBeforeUnload: true });
    const d = await dialog;
    expect(d.type()).toBe('beforeunload');
    await d.dismiss();
  });
});

test.describe('wake lock', () => {
  test.beforeEach(async ({ page }) => fastSettings(page));

  test('requested on GET READY, kept through Paused, released on End', async ({ page }) => {
    await mockWakeLock(page);
    await startSession(page);
    expect(await wakeCalls(page)).toEqual(['request']);
    await page.getByRole('button', { name: 'Stop' }).click();
    await setVisibility(page, 'hidden');
    await setVisibility(page, 'visible');
    expect(await wakeCalls(page)).toEqual(['request']); // still held: no new request
    await page.getByRole('button', { name: 'End' }).click();
    await expect(page.getByRole('button', { name: 'Get ready!' })).toBeVisible();
    expect(await wakeCalls(page)).toEqual(['request', 'release']);
  });

  test('rejected → dismissible banner in the session', async ({ page }) => {
    await mockWakeLock(page, true);
    await startSession(page);
    const banner = alert(page, 'Screen may turn off');
    await expect(banner).toContainText('Set Auto-Lock to Never');
    await banner.getByRole('button', { name: /dismiss/i }).click();
    await expect(banner).toHaveCount(0);
  });
});

test.describe('real camera', () => {
  test.setTimeout(60_000);

  test('Get Ready: hidden stops the camera, visible restarts it', async ({ page }) => {
    await page.goto('./');
    await page.getByRole('button', { name: 'Get ready!' }).click();
    await expect(page.getByTestId('camera-health')).toBeVisible(LIVE);
    await setVisibility(page, 'hidden');
    await expect.poll(() => videoTracks(page)).toEqual([]);
    await setVisibility(page, 'visible');
    await expect(page.getByTestId('camera-health')).toBeVisible(LIVE);
    expect(await videoTracks(page)).toEqual(['live']);
  });

  test('track ended mid-session → Paused with the camera banner; CONTINUE restarts it', async ({ page }) => {
    await page.goto('./');
    await page.getByRole('button', { name: 'Get ready!' }).click();
    await expect(page.getByTestId('camera-health')).toBeVisible(LIVE);
    await page.getByRole('button', { name: 'Start' }).click();
    await expect(chip(page)).toHaveText('Stand-by', LIVE);

    // A revoked permission or unplugged camera ends the track; stop() alone fires no `ended`.
    await page.evaluate(() => {
      const track = (document.querySelector('video')?.srcObject as MediaStream).getVideoTracks()[0];
      track?.stop();
      track?.dispatchEvent(new Event('ended'));
    });
    await expect(chip(page)).toHaveText('Paused');
    await expect(alert(page, 'Paused — camera stopped')).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(chip(page)).toHaveText('Stand-by', LIVE);
    expect(await videoTracks(page)).toEqual(['live']);
  });
});
