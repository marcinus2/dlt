// Initial-load JS budget (spec §2): gzip every JS chunk that dist/index.html loads,
// directly or through static imports / modulepreload. Lazy chunks are excluded.
import { readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = 130;
const dist = new URL('../dist/', import.meta.url).pathname;
const html = readFileSync(join(dist, 'index.html'), 'utf8');

const entries = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="\.?\/?([^"]+\.js)"/g)].map((m) => m[1]);
if (entries.length === 0) {
  console.error('check-size: no JS referenced by dist/index.html');
  process.exit(1);
}

// Follow static `import … from "./x.js"` between chunks; `import("./x.js")` stays lazy.
const seen = new Set();
const queue = entries.map((e) => normalize(e));
while (queue.length > 0) {
  const file = queue.shift();
  if (seen.has(file)) continue;
  seen.add(file);
  const code = readFileSync(join(dist, file), 'utf8');
  for (const m of code.matchAll(/(?:^|[;}\s])(?:import|export)\s*(?:[\w*{}\s,$]+from\s*)?["'](\.{1,2}\/[^"']+\.js)["']/g)) {
    queue.push(normalize(join(dirname(file), m[1])));
  }
}

let total = 0;
for (const file of [...seen].sort()) {
  const kb = gzipSync(readFileSync(join(dist, file)), { level: 9 }).length / 1024;
  total += kb;
  console.log(`${kb.toFixed(1).padStart(7)} KB  ${file}`);
}
const ok = total <= BUDGET_KB;
console.log(`${total.toFixed(1).padStart(7)} KB  initial JS (gzip), budget ${BUDGET_KB} KB → ${ok ? 'OK' : 'OVER'}`);
process.exit(ok ? 0 : 1);
