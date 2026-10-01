// Short beep via Web Audio. The AudioContext is created/resumed from a user gesture (unlock()).
export function createBeeper() {
  let ctx = null;
  const api = {
    muted: false,
    unlock() {
      ctx ??= new AudioContext();
      if (ctx.state === 'suspended') ctx.resume();
    },
    beep() {
      if (api.muted || !ctx || ctx.state !== 'running') return;
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.06);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.06);
    },
  };
  return api;
}
