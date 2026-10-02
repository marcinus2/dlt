// Synthetic camera clip for Chromium's fake camera (plan 5.4): a bright, slightly noisy frame and a
// dark square crossing it, as a 4:2:0 Y4M. Chrome loops the file, so one loop is one lap pattern:
// passes at 1.0, 5.5 and 8.5 s of a 12 s loop → laps of 4.5, 3.0, 4.5 s, repeating (best = 3.0 s).
// Usage: node --experimental-strip-types e2e/tools/make-y4m.ts [out]  (default e2e/fixtures/laps.y4m)
import { closeSync, existsSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syntheticClip } from '../../src/engine/test/synthetic.ts';

export const Y4M_PATH = fileURLToPath(new URL('../fixtures/laps.y4m', import.meta.url));
export const LOOP_MS = 12000;
export const PASS_AT = [1000, 5500, 8500];
export const LAPS_MS = [4500, 3000, 4500];

const FPS = 30;
const WIDTH = 240;
const HEIGHT = 480;

export function makeY4m(out = Y4M_PATH): void {
  const clip = syntheticClip({
    fps: FPS,
    durationMs: LOOP_MS,
    passAt: PASS_AT,
    crossMs: 300,
    width: WIDTH,
    height: HEIGHT,
    blob: 96,
    seed: 5,
  });
  mkdirSync(dirname(out), { recursive: true });
  const fd = openSync(out, 'w');
  try {
    writeSync(fd, `YUV4MPEG2 W${WIDTH} H${HEIGHT} F${FPS}:1 Ip A1:1 C420jpeg\n`);
    const n = WIDTH * HEIGHT;
    const frame = Buffer.alloc(6 + n + n / 2, 128); // header + Y + neutral U, V
    frame.write('FRAME\n', 0, 'ascii');
    const y = frame.subarray(6, 6 + n);
    for (let i = 0; i < clip.frameCount; i++) {
      clip.render(i, y);
      writeSync(fd, frame);
    }
  } finally {
    closeSync(fd);
  }
}

/** Generates the clip once (it's ~60 MB, so it isn't committed). */
export function ensureY4m(): string {
  if (!existsSync(Y4M_PATH)) makeY4m();
  return Y4M_PATH;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] ?? Y4M_PATH;
  makeY4m(out);
  console.log(`wrote ${out}`);
}
