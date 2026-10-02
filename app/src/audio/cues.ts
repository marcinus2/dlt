// Cue tones (spec §2.3): oscillator + gain envelope, no audio assets.
import type { Cue } from '../session/types.ts';

export interface Tone {
  /** Start and end frequency (Hz); different values glide exponentially. */
  from: number;
  to: number;
  ms: number;
  gain: number;
}

const LAP: Tone = { from: 880, to: 880, ms: 60, gain: 0.2 }; // the PoC beep

export const TONES: Record<Cue, Tone> = {
  armed: { from: 440, to: 440, ms: 120, gain: 0.1 },
  go: { from: 660, to: 990, ms: 180, gain: 0.2 },
  lap: LAP,
  best: LAP,
  paused: { from: 990, to: 495, ms: 300, gain: 0.2 },
};

const ATTACK_S = 0.005; // avoids a click at the start

export function playTone(ctx: AudioContext, tone: Tone): void {
  const t0 = ctx.currentTime;
  const end = t0 + tone.ms / 1000;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.setValueAtTime(tone.from, t0);
  if (tone.to !== tone.from) osc.frequency.exponentialRampToValueAtTime(tone.to, end);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(tone.gain, t0 + ATTACK_S);
  gain.gain.linearRampToValueAtTime(0, end);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(end);
}
