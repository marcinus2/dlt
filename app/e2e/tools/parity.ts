// Parity check (plan 4.11): the same synthetic clip through the PoC (/poc/) and the v1 FileSource
// (?debug=engine) in Chromium; compares the events CSVs, and v1's first and second loop (4.7).
// Needs ffmpeg and a build: `npm run build:pages && npm run parity`.

import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { syntheticClip } from '../../src/engine/test/synthetic.ts';

const PORT = 4175;
const base = `http://localhost:${PORT}/`;
const FPS = 30;
const DURATION = 15000;
const PASS_AT = [3000, 7000, 7600, 11000]; // the third is inside the cooldown → SUPPRESSED

async function makeClip(path: string) {
  const clip = syntheticClip({
    fps: FPS,
    durationMs: DURATION,
    passAt: PASS_AT,
    width: 240,
    height: 480,
    blob: 80,
    noise: 0,
  });
  const enc = spawn(
    'ffmpeg',
    [
      ...[
        '-y',
        '-loglevel',
        'error',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'gray',
        '-s',
        '240x480',
        '-r',
        String(FPS),
        '-i',
        '-',
      ],
      ...['-c:v', 'libvpx-vp9', '-crf', '20', '-b:v', '0', '-pix_fmt', 'yuv420p', path],
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
  const frame = new Uint8Array(clip.width * clip.height);
  for (let i = 0; i < clip.frameCount; i++) {
    clip.render(i, frame);
    if (!enc.stdin.write(frame)) await new Promise((r) => enc.stdin.once('drain', r));
  }
  enc.stdin.end();
  await new Promise((r, j) =>
    enc.on('close', (code) => (code === 0 ? r(null) : j(new Error(`ffmpeg ${code}`)))),
  );
}

interface Ev {
  type: string;
  t: number;
}

function parseEvents(csv: string): Ev[] {
  const [head, ...rows] = csv.trim().split('\n');
  const cols = (head ?? '').split(',');
  const ti = cols.indexOf('t');
  return rows.map((r) => {
    const c = r.split(',');
    return { type: c[0] ?? '', t: Number(c[ti]) };
  });
}

async function download(page: Page, click: () => Promise<void>): Promise<string> {
  const d = page.waitForEvent('download');
  await click();
  const chunks = await (await (await d).createReadStream()).toArray();
  return Buffer.concat(chunks).toString();
}

/** Splits events at each loop (the time base jumps back). */
function loops(events: Ev[]): Ev[][] {
  const out: Ev[][] = [[]];
  let last = -1;
  for (const e of events) {
    if (e.t < last - 1000) out.push([]);
    last = e.t;
    out.at(-1)?.push(e);
  }
  return out;
}

function compare(label: string, a: Ev[], b: Ev[]): boolean {
  const types = (x: Ev[]) => x.map((e) => e.type).join(' ');
  const same = types(a) === types(b);
  const dt = same ? Math.max(0, ...a.map((e, i) => Math.abs(e.t - (b[i]?.t ?? 0)))) : Number.NaN;
  console.log(
    `${label}: ${same ? 'same events' : 'DIFFERENT events'}${same ? `, max |Δt| ${dt.toFixed(1)} ms` : ''}`,
  );
  if (!same) console.log(`  ${types(a)}\n  ${types(b)}`);
  return same && dt <= 1000 / FPS + 1;
}

const dir = mkdtempSync(join(tmpdir(), 'dronelap-parity-'));
const clipPath = join(dir, 'parity.webm');
await makeClip(clipPath);
console.log(`clip: ${clipPath}`);

const server: ChildProcess = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
});
let ok = false;
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
  const [poc, v1] = await Promise.all([browser.newPage(), browser.newPage()]);
  await poc.goto(`${base}poc/`);
  await v1.goto(`${base}?debug=engine`);
  await Promise.all([
    (async () => {
      await poc.locator('#videoFile').setInputFiles(clipPath);
      await poc.locator('#startDetection:not([disabled])').click();
    })(),
    v1.locator('input[type=file]').setInputFiles(clipPath),
  ]);
  await new Promise((r) => setTimeout(r, DURATION * 2 + 1500)); // two loops
  const pocCsv = await download(poc, () => poc.locator('#exportEvents').click());
  const v1Csv = await download(v1, () => v1.getByRole('button', { name: 'Events CSV' }).click());
  const hud = await v1.locator('pre').textContent();
  await browser.close();

  const [pocLoop1 = []] = loops(parseEvents(pocCsv));
  const [v1Loop1 = [], v1Loop2 = []] = loops(parseEvents(v1Csv));
  console.log(`PoC loop 1: ${pocLoop1.map((e) => `${e.type}@${e.t}`).join(' ')}`);
  console.log(`v1  loop 1: ${v1Loop1.map((e) => `${e.type}@${e.t}`).join(' ')}`);
  const a = compare('PoC vs v1 (loop 1)', pocLoop1, v1Loop1);
  const b = compare('v1 loop 1 vs loop 2', v1Loop1, v1Loop2.slice(0, v1Loop1.length));
  console.log(`v1 HUD:\n${hud}`);
  ok = a && b;
} finally {
  server.kill();
}
process.exit(ok ? 0 : 1);
