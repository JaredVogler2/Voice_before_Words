import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DEFAULT_SPEAK_OPTIONS, Speaker, type SynthLike } from '../src/speech/speaker';
import { applyPronunciations, chooseVoice, rankVoices, scoreVoice, type VoiceLike } from '../src/speech/voices';

const voice = (name: string, lang = 'en-US', localService = true, isDefault = false): VoiceLike => ({
  voiceURI: name,
  name,
  lang,
  localService,
  default: isDefault,
});

const VOICES: VoiceLike[] = [
  voice('Samantha', 'en-US', true, true),
  voice('Ava (Premium)'),
  voice('Zoe (Enhanced)'),
  voice('Daniel', 'en-GB'),
  voice('Google US English', 'en-US', false),
  voice('Microsoft Aria Online (Natural) - English (United States)', 'en-US', false),
  voice('Zarvox'),
  voice('Bahh'),
  voice('Fred'),
  voice('Monica', 'es-ES'),
];

describe('choosing a voice', () => {
  test('the most natural voice comes first, and joke voices are never offered first', () => {
    const ranked = rankVoices(VOICES, 'en-US', false);
    expect(ranked[0].name).toMatch(/Natural/);
    expect(ranked.map((v) => v.name)).not.toContain('Zarvox');
    expect(ranked.map((v) => v.name)).not.toContain('Bahh');
    expect(ranked[ranked.length - 1].name).toBe('Fred');
    expect(ranked.find((v) => v.name === 'Ava (Premium)')!.tier).toBe('natural');
    expect(ranked.find((v) => v.name === 'Samantha')!.tier).toBe('basic');
  });

  test('on-device only leaves out voices that send text to the browser maker', () => {
    const ranked = rankVoices(VOICES, 'en-US', true);
    expect(ranked.every((v) => v.onDevice)).toBe(true);
    expect(ranked[0].name).toBe('Ava (Premium)');
  });

  test('only voices for the language are listed, with the matching region preferred', () => {
    expect(rankVoices(VOICES, 'es-ES', true).map((v) => v.name)).toEqual(['Monica']);
    const british = rankVoices([voice('A', 'en-US'), voice('B', 'en-GB')], 'en-GB', true);
    expect(british[0].name).toBe('B');
  });

  test('the person\'s own choice wins when it is available and allowed', () => {
    expect(chooseVoice(VOICES, 'Daniel', 'en-US', true)?.name).toBe('Daniel');
    // an online voice chosen earlier is not used once on-device only is on
    expect(chooseVoice(VOICES, 'Google US English', 'en-US', true)?.name).toBe('Ava (Premium)');
    expect(chooseVoice(VOICES, 'Google US English', 'en-US', false)?.name).toBe('Google US English');
    expect(chooseVoice(VOICES, 'Gone', 'en-US', true)?.name).toBe('Ava (Premium)');
  });

  test('some voice is always better than silence', () => {
    const onlyOnline = [voice('Google US English', 'en-US', false)];
    expect(chooseVoice(onlyOnline, '', 'en-US', true)?.name).toBe('Google US English');
    const otherLanguage = [voice('Monica', 'es-ES', true, true)];
    expect(chooseVoice(otherLanguage, '', 'en-US', true)?.name).toBe('Monica');
    expect(chooseVoice([], '', 'en-US', true)).toBeUndefined();
  });

  test('scores follow what the name says about quality', () => {
    expect(scoreVoice(voice('Ava (Premium)'))).toBeGreaterThan(scoreVoice(voice('Zoe (Enhanced)')));
    expect(scoreVoice(voice('Zoe (Enhanced)'))).toBeGreaterThan(scoreVoice(voice('Samantha')));
    expect(scoreVoice(voice('Zarvox'))).toBeLessThan(-500);
  });
});

describe('saying words differently', () => {
  const list = [{ word: 'Nguyen', say: 'win' }, { word: 'Dr', say: 'doctor' }, { word: '', say: 'x' }, { word: 'Zoe', say: ' ' }];

  test('replaces whole words, whatever the case, and leaves the rest alone', () => {
    expect(applyPronunciations('I see Dr Nguyen.', list)).toBe('I see doctor win.');
    expect(applyPronunciations('nguyen and NGUYEN', list)).toBe('win and win');
    expect(applyPronunciations('I am Dry.', list)).toBe('I am Dry.');
    expect(applyPronunciations('Hi Zoe', list)).toBe('Hi Zoe');
    expect(applyPronunciations('nothing to change', [])).toBe('nothing to change');
  });

  test('handles punctuation in the word being replaced', () => {
    expect(applyPronunciations('I use C++ daily', [{ word: 'C++', say: 'see plus plus' }])).toBe('I use see plus plus daily');
  });
});

/** A stand-in for the browser's speech engine. */
function fakeSynth(options: { finish?: boolean } = {}) {
  const spoken: { text: string; rate: number; volume: number; voice: unknown; utterance: { onend: (() => void) | null } }[] = [];
  let cancelled = 0;
  const synth: SynthLike = {
    speak(utterance) {
      spoken.push({ text: utterance.text, rate: utterance.rate, volume: utterance.volume, voice: utterance.voice, utterance: utterance as never });
      if (options.finish !== false && utterance.text.trim()) setTimeout(() => utterance.onend?.(new Event('end') as SpeechSynthesisEvent), 200);
    },
    cancel() {
      cancelled++;
    },
    getVoices: () => VOICES as unknown as SpeechSynthesisVoice[],
  };
  const make = (text: string) => ({ text, rate: 1, pitch: 1, volume: 1, lang: '', voice: null, onend: null, onerror: null }) as unknown as SpeechSynthesisUtterance;
  return { synth, spoken, make, cancelled: () => cancelled };
}

describe('the speaker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('speaks with the chosen settings and the best voice, and reports when it starts and stops', async () => {
    const fake = fakeSynth();
    const speaker = new Speaker(fake.synth, fake.make);
    const changes: boolean[] = [];
    speaker.onChange((value) => changes.push(value));
    const done = speaker.speak('I need help.', { ...DEFAULT_SPEAK_OPTIONS, rate: 1.2 });
    expect(speaker.isSpeaking).toBe(true);
    await vi.advanceTimersByTimeAsync(400);
    await done;
    expect(fake.spoken).toHaveLength(1);
    expect(fake.spoken[0].text).toBe('I need help.');
    expect(fake.spoken[0].rate).toBe(1.2);
    expect((fake.spoken[0].voice as VoiceLike).name).toBe('Ava (Premium)');
    expect(changes).toEqual([true, false]);
  });

  test('a new sentence replaces the one being spoken', async () => {
    const fake = fakeSynth({ finish: false });
    const speaker = new Speaker(fake.synth, fake.make);
    const first = speaker.speak('First sentence.', DEFAULT_SPEAK_OPTIONS);
    await vi.advanceTimersByTimeAsync(60);
    const second = speaker.speak('Second sentence.', DEFAULT_SPEAK_OPTIONS);
    await vi.advanceTimersByTimeAsync(60);
    await first;
    expect(fake.spoken.map((item) => item.text)).toEqual(['First sentence.', 'Second sentence.']);
    expect(fake.cancelled()).toBeGreaterThanOrEqual(2);
    expect(speaker.isSpeaking).toBe(true);
    speaker.stop();
    await second;
    expect(speaker.isSpeaking).toBe(false);
  });

  test('does not stay "speaking" forever when the browser never says it finished', async () => {
    const fake = fakeSynth({ finish: false });
    const speaker = new Speaker(fake.synth, fake.make);
    const done = speaker.speak('Hello.', DEFAULT_SPEAK_OPTIONS);
    await vi.advanceTimersByTimeAsync(10000);
    await done;
    expect(speaker.isSpeaking).toBe(false);
  });

  test('applies pronunciations, clamps extreme settings, and ignores empty text', async () => {
    const fake = fakeSynth();
    const speaker = new Speaker(fake.synth, fake.make);
    const done = speaker.speak('Hi Nguyen', { ...DEFAULT_SPEAK_OPTIONS, rate: 9, volume: 4, pronunciations: [{ word: 'Nguyen', say: 'win' }] });
    await vi.advanceTimersByTimeAsync(400);
    await done;
    expect(fake.spoken[0]).toMatchObject({ text: 'Hi win', rate: 2, volume: 1 });
    await speaker.speak('   ', DEFAULT_SPEAK_OPTIONS);
    expect(fake.spoken).toHaveLength(1);
  });

  test('unlocking primes speech silently, once', () => {
    const fake = fakeSynth();
    const speaker = new Speaker(fake.synth, fake.make);
    speaker.unlock();
    speaker.unlock();
    expect(fake.spoken).toHaveLength(1);
    expect(fake.spoken[0].volume).toBe(0);
  });

  test('without a speech engine nothing breaks', async () => {
    const speaker = new Speaker(undefined, () => ({}) as SpeechSynthesisUtterance);
    expect(speaker.supported).toBe(false);
    await speaker.speak('Hello', DEFAULT_SPEAK_OPTIONS);
    speaker.unlock();
    speaker.stop();
    expect(await speaker.whenVoicesReady(10)).toEqual([]);
  });
});
