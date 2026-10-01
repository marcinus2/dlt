// Pure recorder + CSV builders, no DOM. Per-frame rows live in preallocated typed arrays.
const STATES = ['OFF', 'WARMUP', 'IDLE', 'CANDIDATE', 'MOTION', 'CALIB'];
const EVENT_COLS = ['type', 't', 'startT', 'endT', 'durationMs', 'peakT', 'peakRatio', 'frames', 'dStart', 'dPeak', 'reason'];

export function createRecorder(cap = 200000) {   // 200k rows ≈ 55 min @ 60 fps
  const t = new Float64Array(cap), ratio = new Float64Array(cap), gRatio = new Float64Array(cap);
  const global = new Uint8Array(cap), state = new Uint8Array(cap);
  let n = 0;
  let events = [];

  const cell = (v) => (v === undefined || v === null ? '' : typeof v === 'number' ? String(+v.toFixed(6)) : String(v));

  return {
    addFrame(ft, r, gr, g, st) {
      if (n >= cap) return false;
      t[n] = ft; ratio[n] = r; gRatio[n] = gr; global[n] = g ? 1 : 0; state[n] = Math.max(0, STATES.indexOf(st));
      n++;
      return true;
    },
    addEvent(e) { events.push(e); },
    clear() { n = 0; events = []; },
    get frameCount() { return n; },
    get eventCount() { return events.length; },
    eventsCsv() {
      return [EVENT_COLS.join(','), ...events.map((e) => EVENT_COLS.map((c) => cell(e[c])).join(','))].join('\n') + '\n';
    },
    framesCsv() {
      const rows = ['t,ratio,globalRatio,global,state'];
      for (let i = 0; i < n; i++) rows.push(`${+t[i].toFixed(3)},${ratio[i]},${gRatio[i]},${global[i]},${STATES[state[i]]}`);
      return rows.join('\n') + '\n';
    },
  };
}
