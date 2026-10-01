// Ratio graph: ring buffer of recent frames, drawn on rAF independently of processing.
const CAP = 720;                    // ~12 s @ 60 fps

// createGraph(canvas, config) -> { push(ratio, global, motion) }
export function createGraph(canvas, config) {
  const ctx = canvas.getContext('2d');
  const ratios = new Float32Array(CAP), flags = new Uint8Array(CAP);   // flags: 1 = global, 2 = motion
  let head = 0, count = 0;

  function push(ratio, global, motion) {
    ratios[head] = ratio;
    flags[head] = (global ? 1 : 0) | (motion ? 2 : 0);
    head = (head + 1) % CAP;
    if (count < CAP) count++;
  }

  function draw() {
    requestAnimationFrame(draw);
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    let top = config.startRatio * 1.5;
    for (let i = 0; i < count; i++) if (ratios[i] > top) top = ratios[i];
    const xAt = (i) => ((CAP - count + i) / (CAP - 1)) * W;     // i = 0 oldest; newest at the right edge
    const yAt = (r) => H - (Math.min(r, top) / top) * (H - 4) - 2;
    const at = (i) => (head - count + i + CAP) % CAP;

    for (let i = 0; i < count; i++) {
      const f = flags[at(i)], x = xAt(i), w = W / CAP + 1;
      if (f & 2) { ctx.fillStyle = 'rgba(102,255,102,0.18)'; ctx.fillRect(x, 0, w, H); }
      if (f & 1) { ctx.fillStyle = 'rgba(255,102,153,0.6)'; ctx.fillRect(x, 0, w, 4); }
    }
    for (const [r, color] of [[config.startRatio, '#fc6'], [config.endRatio, '#6cf']]) {
      ctx.strokeStyle = color;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(0, yAt(r)); ctx.lineTo(W, yAt(r)); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = '#ddd';
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const x = xAt(i), y = yAt(ratios[at(i)]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = '#888';
    ctx.fillText(`${(top * 100).toFixed(1)}%`, 4, 12);
  }
  draw();

  return { push };
}
