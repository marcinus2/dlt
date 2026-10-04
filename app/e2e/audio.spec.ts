// Audio (plan M6) in sim mode: real Web Audio + speechSynthesis, calls recorded by an init script.
import { expect, type Page, test } from '@playwright/test';
import { DEFAULTS } from '../src/settings/schema.ts';
import { SETTINGS_KEY } from '../src/settings/storage.ts';
import { pass, SIM_URL, startSession } from './helpers.ts';

async function recordAudio(page: Page, audio = DEFAULTS.audio) {
  const s = { ...DEFAULTS, audio, detection: { ...DEFAULTS.detection, warmupMs: 0, cooldownMs: 0 } };
  await page.addInitScript(
    ({ key, value }) => {
      localStorage.setItem(key, value);
      const calls: string[] = [];
      Object.assign(window, { __audio: calls });
      const synth = window.speechSynthesis;
      const speak = synth.speak.bind(synth);
      const cancel = synth.cancel.bind(synth);
      synth.speak = (u) => {
        calls.push(u.volume === 0 ? 'prime' : `say ${u.text}`);
        speak(u);
      };
      synth.cancel = () => {
        calls.push('cancel');
        cancel();
      };
      const osc = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator = function (this: AudioContext) {
        calls.push(`tone ${this.state}`);
        return osc.call(this);
      };
    },
    { key: SETTINGS_KEY, value: JSON.stringify(s) },
  );
}

const calls = (page: Page) => page.evaluate(() => (window as unknown as { __audio: string[] }).__audio);
const said = async (page: Page) => (await calls(page)).filter((c) => c.startsWith('say '));

test('unlock primes speech in the taps; go / lap / best are toned and spoken, cancel() first', async ({
  page,
}) => {
  await recordAudio(page);
  await startSession(page);
  // GET READY and START unlock; then the armed tone (no warm-up in these settings).
  await expect.poll(() => calls(page)).toEqual(['cancel', 'prime', 'cancel', 'prime', 'tone running']);

  await pass(page);
  await pass(page, 900);
  await pass(page, 600);
  await expect.poll(() => said(page)).toHaveLength(3);
  const log = (await calls(page)).slice(5);
  expect(log.filter((c) => c.startsWith('tone'))).toEqual(['tone running', 'tone running', 'tone running']);
  const s = await said(page);
  expect(s[0]).toBe('say Go');
  expect(s[1]).toMatch(/^say Best, \d+\.\d\d$/); // lap times depend on runner load
  expect(s[2]).toMatch(/^say (Best, )?\d+\.\d\d$/);
  // Every utterance is preceded by cancel(), so a lap never queues behind an old one.
  for (const [i, c] of log.entries()) if (c.startsWith('say')) expect(log[i - 1]).toBe('cancel');
});

test('toggles: beeps off → no tones; voice off → no speech; announceBest off → plain lap', async ({
  page,
}) => {
  await recordAudio(page, { beep: false, voice: true, announceBest: false });
  await startSession(page);
  await pass(page);
  await pass(page, 600);
  await expect.poll(() => said(page)).toEqual(['say Go', expect.stringMatching(/^say \d+\.\d\d$/)]);
  expect((await calls(page)).filter((c) => c.startsWith('tone'))).toEqual([]);
});

test('voice off: tones only', async ({ page }) => {
  await recordAudio(page, { beep: true, voice: false, announceBest: true });
  await startSession(page);
  await pass(page);
  await expect.poll(async () => (await calls(page)).filter((c) => c.startsWith('tone'))).toHaveLength(2); // armed, go
  expect(await said(page)).toEqual([]);
});

test('Diagnostics sound check plays each cue (debug=1)', async ({ page }) => {
  await recordAudio(page);
  await page.goto(`${SIM_URL}&debug=1`);
  await page.getByRole('button', { name: 'Configuration' }).click();
  await page.getByRole('button', { name: /^Diagnostics/ }).click();
  for (const name of ['Armed', 'Go', 'Lap', 'Best', 'Paused'])
    await page.getByRole('button', { name, exact: true }).click();
  await expect.poll(() => said(page)).toEqual(['say Go', 'say 12.34', 'say Best, 12.34', 'say Paused']);
  expect((await calls(page)).filter((c) => c.startsWith('tone'))).toHaveLength(5);
  await expect(page.getByTestId('speech-latency')).toBeVisible();
});
