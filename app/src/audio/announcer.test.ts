import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioSettings } from '../engine/types.ts';
import { DEFAULTS } from '../settings/schema.ts';
import { announce, createAnnouncer, loggedAnnouncer } from './announcer.ts';
import { TONES } from './cues.ts';
import { createSpeech, pickVoice, RATE, type VoiceLike } from './speech.ts';
import { createAudioUnlock, LOCK_CHECK_MS } from './unlock.ts';

const ALL: AudioSettings = { beep: true, voice: true, announceBest: true };

describe('announce', () => {
  it('phrases per cue (spec §2.3)', () => {
    expect(announce('armed', undefined, ALL)).toEqual({ tone: 'armed', text: '' });
    expect(announce('go', undefined, ALL)).toEqual({ tone: 'go', text: 'Go' });
    expect(announce('lap', 12340, ALL)).toEqual({ tone: 'lap', text: '12.34' });
    expect(announce('best', 12340, ALL)).toEqual({ tone: 'best', text: 'Best, 12.34' });
    expect(announce('best', 65340, ALL)).toEqual({ tone: 'best', text: 'Best, 1 minute 5.34' });
    expect(announce('paused', undefined, ALL)).toEqual({ tone: 'paused', text: 'Paused' });
  });

  it('beep off → no tone; voice off → no text', () => {
    expect(announce('lap', 12340, { ...ALL, beep: false })).toEqual({ tone: null, text: '12.34' });
    expect(announce('go', undefined, { ...ALL, voice: false })).toEqual({ tone: 'go', text: '' });
    expect(announce('best', 1000, { ...ALL, beep: false, voice: false })).toEqual({ tone: null, text: '' });
  });

  it('announceBest off → a best lap sounds like any lap, keeping its tone', () => {
    expect(announce('best', 12340, { ...ALL, announceBest: false })).toEqual({ tone: 'best', text: '12.34' });
  });

  it('defaults have everything on', () => {
    expect(DEFAULTS.audio).toEqual(ALL);
  });
});

describe('TONES', () => {
  it('best uses the lap beep; paused glides down, go glides up', () => {
    expect(TONES.best).toBe(TONES.lap);
    expect(TONES.lap).toMatchObject({ from: 880, ms: 60 });
    expect(TONES.go.to).toBeGreaterThan(TONES.go.from);
    expect(TONES.paused.to).toBeLessThan(TONES.paused.from);
  });
});

function fakeSpeech(available = true) {
  const said: string[] = [];
  return {
    said,
    speech: {
      available: () => available,
      onAvailable: () => () => {},
      prime: () => said.push('<prime>'),
      say: (text: string, onStart?: () => void) => {
        said.push(text);
        onStart?.();
      },
    },
  };
}

describe('createAnnouncer', () => {
  const ctx = {} as AudioContext;
  const unlocked = {
    unlock() {},
    context: () => ctx,
    locked: () => false,
    onLockChange: () => () => {},
  };

  it('plays the tone and says the text; onSpeechStart is passed through', () => {
    const { speech, said } = fakeSpeech();
    const play = vi.fn();
    const onStart = vi.fn();
    const a = createAnnouncer({ speech, unlock: unlocked, play });
    a.cue('best', 12340, ALL, onStart);
    expect(play).toHaveBeenCalledWith(ctx, TONES.best);
    expect(said).toEqual(['Best, 12.34']);
    expect(onStart).toHaveBeenCalledOnce();
  });

  it('respects the toggles', () => {
    const { speech, said } = fakeSpeech();
    const play = vi.fn();
    const a = createAnnouncer({ speech, unlock: unlocked, play });
    a.cue('lap', 12340, { ...ALL, beep: false });
    a.cue('lap', 12340, { ...ALL, voice: false });
    expect(play).toHaveBeenCalledOnce();
    expect(said).toEqual(['12.34']);
  });

  it('no tone without a context (not unlocked / locked)', () => {
    const { speech } = fakeSpeech();
    const play = vi.fn();
    const a = createAnnouncer({ speech, unlock: { ...unlocked, context: () => null }, play });
    a.cue('lap', 12340, ALL);
    expect(play).not.toHaveBeenCalled();
  });

  it('loggedAnnouncer logs unlock and what each cue did', () => {
    const { speech } = fakeSpeech();
    const lines: string[] = [];
    const a = loggedAnnouncer(createAnnouncer({ speech, unlock: unlocked, play: () => {} }), (m) =>
      lines.push(m),
    );
    a.unlock();
    a.cue('go', undefined, ALL);
    a.cue('armed', undefined, { ...ALL, beep: false });
    expect(lines).toEqual(['audio.unlock', 'cue go tone “Go”', 'cue armed (muted)']);
  });
});

const voice = (lang: string, localService: boolean, name = lang, isDefault = false): VoiceLike => ({
  lang,
  localService,
  name,
  default: isDefault,
});

describe('pickVoice', () => {
  it('prefers an on-device English voice over a network one', () => {
    const v = [voice('en-US', false, 'Google US English'), voice('en-GB', true, 'Daniel')];
    expect(pickVoice(v, 'en-US')?.name).toBe('Daniel');
  });

  it('then the user English locale, then the default', () => {
    const v = [voice('en-US', true, 'A'), voice('en-GB', true, 'B'), voice('en-AU', true, 'C', true)];
    expect(pickVoice(v, 'en-GB')?.name).toBe('B');
    expect(pickVoice(v, 'en-IN')?.name).toBe('C');
    // Non-English UI language → en-US.
    expect(pickVoice(v, 'pl-PL')?.name).toBe('A');
  });

  it('accepts en_US style tags; null without English', () => {
    expect(pickVoice([voice('en_US', true, 'X')])?.name).toBe('X');
    expect(pickVoice([voice('pl-PL', true), voice('de-DE', true)])).toBeNull();
    expect(pickVoice([])).toBeNull();
  });
});

class FakeUtterance {
  lang = '';
  voice: unknown = null;
  rate = 1;
  volume = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  constructor(public text: string) {}
}

function fakeSynth(voices: VoiceLike[]) {
  const target = new EventTarget();
  const calls: string[] = [];
  const synth = {
    getVoices: () => voices,
    cancel: () => calls.push('cancel'),
    speak: (u: FakeUtterance) => calls.push(`speak:${u.text}`),
    addEventListener: target.addEventListener.bind(target),
    spoken: [] as FakeUtterance[],
  };
  synth.speak = (u) => {
    synth.spoken.push(u);
    return calls.push(`speak:${u.text}`);
  };
  return {
    synth: synth as unknown as SpeechSynthesis,
    calls,
    spoken: synth.spoken,
    setVoices(v: VoiceLike[]) {
      voices = v;
      target.dispatchEvent(new Event('voiceschanged'));
    },
  };
}

describe('createSpeech', () => {
  beforeEach(() => {
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('cancel() before every utterance, so laps never queue; rate 1.1 and the picked voice', () => {
    const f = fakeSynth([voice('en-GB', true, 'Daniel')]);
    const s = createSpeech(f.synth, 'en-GB');
    s.say('12.34');
    s.say('Best, 11.10');
    expect(f.calls).toEqual(['cancel', 'speak:12.34', 'cancel', 'speak:Best, 11.10']);
    expect(f.spoken[1]).toMatchObject({ rate: RATE, lang: 'en-GB', voice: { name: 'Daniel' } });
  });

  it('prime speaks a blank at volume 0', () => {
    const f = fakeSynth([voice('en-US', true)]);
    createSpeech(f.synth).prime();
    expect(f.calls).toEqual(['cancel', 'speak: ']);
    expect(f.spoken[0]?.volume).toBe(0);
  });

  it('onStart is wired to the utterance', () => {
    const f = fakeSynth([voice('en-US', true)]);
    const onStart = vi.fn();
    createSpeech(f.synth).say('Go', onStart);
    f.spoken[0]?.onstart?.();
    expect(onStart).toHaveBeenCalledOnce();
  });

  it('voices loading late: available until they arrive, then per the list (voiceschanged)', () => {
    const f = fakeSynth([]);
    const s = createSpeech(f.synth);
    const changes: boolean[] = [];
    s.onAvailable((a) => changes.push(a));
    expect(s.available()).toBe(true);
    s.say('Go'); // default voice, en-US
    expect(f.spoken[0]).toMatchObject({ lang: 'en-US', voice: null });
    f.setVoices([voice('pl-PL', true)]);
    expect(s.available()).toBe(false);
    s.say('12.34');
    expect(f.spoken).toHaveLength(1); // beep only
    f.setVoices([voice('en-US', true)]);
    expect(changes).toEqual([false, true]);
  });

  it('no speechSynthesis → unavailable, calls are no-ops', () => {
    const s = createSpeech(undefined);
    expect(s.available()).toBe(false);
    s.prime();
    s.say('Go');
  });
});

class FakeContext {
  static instances: FakeContext[] = [];
  state: AudioContextState | 'interrupted' = 'suspended';
  onstatechange: (() => void) | null = null;
  sampleRate = 48000;
  destination = {};
  resumes = 0;
  started = 0;
  resumeWorks = true;
  constructor() {
    FakeContext.instances.push(this);
  }
  resume() {
    this.resumes++;
    if (this.resumeWorks) {
      this.state = 'running';
      this.onstatechange?.();
    }
    return Promise.resolve();
  }
  createBuffer() {
    return {};
  }
  createBufferSource() {
    return { buffer: null, connect: () => {}, start: () => this.started++ };
  }
  setState(s: FakeContext['state']) {
    this.state = s;
    this.onstatechange?.();
  }
}

describe('createAudioUnlock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeContext.instances = [];
    vi.stubGlobal('AudioContext', FakeContext);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete (navigator as { audioSession?: unknown }).audioSession;
  });

  it('creates, resumes and primes inside the call (no await); one context for the app', () => {
    const prime = vi.fn();
    const u = createAudioUnlock({ prime });
    expect(u.context()).toBeNull();
    u.unlock();
    const ctx = FakeContext.instances[0];
    expect(prime).toHaveBeenCalledOnce();
    expect(ctx?.resumes).toBe(1);
    expect(ctx?.started).toBe(1); // silent buffer
    expect(u.context()).toBe(ctx);
    u.unlock();
    expect(FakeContext.instances).toHaveLength(1);
    expect(ctx?.resumes).toBe(1); // already running
  });

  it('sets audioSession.type = playback where available', () => {
    (navigator as { audioSession?: { type: string } }).audioSession = { type: 'auto' };
    createAudioUnlock().unlock();
    expect((navigator as { audioSession?: { type: string } }).audioSession?.type).toBe('playback');
  });

  it('still suspended after the check → locked; the next tap anywhere unlocks again', () => {
    vi.stubGlobal(
      'AudioContext',
      class extends FakeContext {
        override resumeWorks = false;
      },
    );
    const taps = new EventTarget();
    const u = createAudioUnlock({ taps });
    const changes: boolean[] = [];
    u.onLockChange((l) => changes.push(l));
    u.unlock();
    expect(u.locked()).toBe(false); // grace period
    vi.advanceTimersByTime(LOCK_CHECK_MS);
    expect(u.locked()).toBe(true);
    expect(u.context()).toBeNull();
    const ctx = FakeContext.instances[0] as FakeContext;
    ctx.resumeWorks = true;
    taps.dispatchEvent(new Event('pointerup'));
    expect(ctx.resumes).toBe(2);
    expect(u.locked()).toBe(false);
    expect(changes).toEqual([true, false]);
    taps.dispatchEvent(new Event('pointerup'));
    expect(ctx.resumes).toBe(2); // listener removed once unlocked
  });

  it('an interruption (call, background) locks after the check', () => {
    const u = createAudioUnlock({ taps: new EventTarget() });
    u.unlock();
    const ctx = FakeContext.instances[0] as FakeContext;
    ctx.setState('interrupted');
    vi.advanceTimersByTime(LOCK_CHECK_MS);
    expect(u.locked()).toBe(true);
    ctx.setState('running');
    expect(u.locked()).toBe(false);
  });

  it('no Web Audio → only primes speech', () => {
    vi.stubGlobal('AudioContext', undefined);
    const prime = vi.fn();
    const u = createAudioUnlock({ prime });
    u.unlock();
    expect(prime).toHaveBeenCalledOnce();
    expect(u.context()).toBeNull();
    expect(u.locked()).toBe(false);
  });
});
