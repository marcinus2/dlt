// Announcer (plan 6.4): what each cue sounds like under the audio settings (pure), and the
// side-effect wrapper that plays it. Used by the real and the sim effects.
import type { AudioSettings, Ms, Unsubscribe } from '../engine/types.ts';
import { speechText } from '../session/laps.ts';
import type { Cue } from '../session/types.ts';
import { playTone, TONES } from './cues.ts';
import { createSpeech, type Speech } from './speech.ts';
import { type AudioUnlock, createAudioUnlock } from './unlock.ts';

export interface Announcement {
  tone: Cue | null;
  text: string;
}

export function announce(cue: Cue, lapMs: Ms | undefined, s: AudioSettings): Announcement {
  const phrase = cue === 'best' && !s.announceBest ? 'lap' : cue;
  return { tone: s.beep ? cue : null, text: s.voice ? speechText(phrase, lapMs) : '' };
}

export interface Announcer {
  /** Inside a user gesture only. */
  unlock(): void;
  /** `onSpeechStart` fires when the utterance starts (latency probe, plan 6.6). */
  cue(cue: Cue, lapMs: Ms | undefined, s: AudioSettings, onSpeechStart?: () => void): Announcement;
  onLockChange(cb: (locked: boolean) => void): Unsubscribe;
  onVoiceChange(cb: (available: boolean) => void): Unsubscribe;
  voiceAvailable(): boolean;
}

export function createAnnouncer(
  deps: { speech?: Speech; unlock?: AudioUnlock; play?: typeof playTone } = {},
): Announcer {
  const speech = deps.speech ?? createSpeech();
  const unlock = deps.unlock ?? createAudioUnlock({ prime: speech.prime });
  const play = deps.play ?? playTone;
  return {
    unlock: unlock.unlock,
    cue(cue, lapMs, s, onSpeechStart) {
      const a = announce(cue, lapMs, s);
      const ctx = unlock.context();
      if (a.tone && ctx) play(ctx, TONES[a.tone]);
      if (a.text) speech.say(a.text, onSpeechStart);
      return a;
    },
    onLockChange: unlock.onLockChange,
    onVoiceChange: speech.onAvailable,
    voiceAvailable: speech.available,
  };
}

/** Same announcer, with each unlock and cue written to `log` (sim panel, `?debug=1` console). */
export function loggedAnnouncer(a: Announcer, log: (msg: string) => void): Announcer {
  return {
    ...a,
    unlock() {
      log('audio.unlock');
      a.unlock();
    },
    cue(cue, lapMs, s, onSpeechStart) {
      const r = a.cue(cue, lapMs, s, onSpeechStart);
      const parts = [r.tone && 'tone', r.text && `“${r.text}”`].filter(Boolean).join(' ');
      log(`cue ${cue}${parts ? ` ${parts}` : ' (muted)'}`);
      return r;
    },
  };
}
