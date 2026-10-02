// Writes the synthetic golden fixture (plan 4.9) in the PoC frames-CSV format, until the M0 field
// recordings land. Run: node --experimental-strip-types scripts/make-synthetic-csv.ts
import { writeFileSync } from 'node:fs';
import { createDetector } from '../src/engine/detector.ts';
import { createRecorder } from '../src/engine/recorder.ts';
import { syntheticRows } from '../src/engine/test/synthetic.ts';
import { DEFAULTS } from '../src/settings/schema.ts';

const rows = syntheticRows({
  fps: 30,
  durationMs: 36000,
  passAt: [2000, 7300, 7900, 12450, 17020, 28000, 33100],
  longMotion: [[20000, 24000]],
  globalBursts: [[25500, 25800]],
});
const det = createDetector(DEFAULTS.detection);
const rec = createRecorder(rows.length);
for (const r of rows) {
  det.update(r);
  rec.addFrame(r.t, r.ratio, r.globalRatio, r.global, det.state);
}
const out = new URL('../test/fixtures/synthetic/laps-30fps.csv', import.meta.url);
writeFileSync(out, rec.framesCsv());
console.log(`wrote ${rows.length} rows to ${out.pathname}`);
