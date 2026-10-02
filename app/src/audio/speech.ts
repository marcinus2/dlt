// Spoken lap times (spec §2.3): an on-device en-* voice, cancel() before each utterance so a lap
// never queues behind an old one, rate 1.1. No voice → beep only.
import type { Unsubscribe } from '../engine/types.ts';

export const RATE = 1.1;
const FALLBACK_LANG = 'en-US';

export type VoiceLike = Pick<SpeechSynthesisVoice, 'lang' | 'localService' | 'default' | 'name'>;

const norm = (lang: string) => lang.replace('_', '-').toLowerCase();

/** Best en-* voice: on-device first (desktop Chrome's "Google" voices need the network), then the
 * user's own English locale, then the platform default. Null when there is no English voice. */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], userLang = FALLBACK_LANG): V | null {
  const want = norm(userLang).startsWith('en') ? norm(userLang) : norm(FALLBACK_LANG);
  let best: V | null = null;
  let bestScore = -1;
  for (const v of voices) {
    const lang = norm(v.lang);
    if (!lang.startsWith('en')) continue;
    const score = (v.localService ? 4 : 0) + (lang === want ? 2 : 0) + (v.default ? 1 : 0);
    if (score > bestScore) {
      best = v;
      bestScore = score;
    }
  }
  return best;
}

export interface Speech {
  /** False when the browser has voices but no English one, or no speechSynthesis at all. */
  available(): boolean;
  onAvailable(cb: (available: boolean) => void): Unsubscribe;
  /** Speak ' ' at volume 0 inside a gesture: iOS needs the first speak() from a tap. */
  prime(): void;
  say(text: string, onStart?: () => void): void;
}

export function createSpeech(
  synth: SpeechSynthesis | undefined = globalThis.speechSynthesis,
  userLang: string = globalThis.navigator?.language ?? FALLBACK_LANG,
): Speech {
  let voice: SpeechSynthesisVoice | null = null;
  // Voices may load late (voiceschanged) or never be listed; speak with the default until then.
  let known = false;
  // Holding the utterance keeps Chrome from collecting it before onstart fires.
  let current: SpeechSynthesisUtterance | null = null;
  const listeners = new Set<(available: boolean) => void>();
  const available = () => synth !== undefined && (!known || voice !== null);

  function load() {
    if (!synth) return;
    const before = available();
    const voices = synth.getVoices();
    known = voices.length > 0;
    voice = pickVoice(voices, userLang);
    if (available() !== before) for (const cb of listeners) cb(available());
  }
  load();
  synth?.addEventListener('voiceschanged', load);

  function utter(text: string): SpeechSynthesisUtterance {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = voice?.lang ?? FALLBACK_LANG;
    if (voice) u.voice = voice;
    u.rate = RATE;
    current = u;
    u.onend = () => {
      if (current === u) current = null;
    };
    return u;
  }

  return {
    available,
    onAvailable(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    prime() {
      if (!synth) return;
      if (!known) load();
      synth.cancel();
      const u = utter(' ');
      u.volume = 0;
      synth.speak(u);
    },
    say(text, onStart) {
      if (!synth || !available()) return;
      synth.cancel();
      const u = utter(text);
      if (onStart) u.onstart = onStart;
      synth.speak(u);
    },
  };
}
