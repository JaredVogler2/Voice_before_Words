import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Listener, tidyTranscript, type ListenSnapshot, type RecognitionLike } from '../src/speech/listener';

/** A recogniser the test drives by hand. */
class FakeRecognition implements RecognitionLike {
  lang = '';
  continuous = true;
  interimResults = false;
  maxAlternatives = 0;
  onstart: (() => void) | null = null;
  onresult: RecognitionLike['onresult'] = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = 0;
  stopped = 0;
  aborted = 0;
  start() {
    this.started++;
  }
  stop() {
    this.stopped++;
    this.onend?.();
  }
  abort() {
    this.aborted++;
  }
  hear(parts: [string, boolean][]) {
    this.onresult?.({ resultIndex: 0, results: parts.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal })) });
  }
}

let made: FakeRecognition[];
let listener: Listener;
let states: ListenSnapshot[];
let heard: string[];
const options = (byHand = true) => ({ language: 'en-GB', windowMs: 8000, byHand, onHeard: (text: string) => heard.push(text) });

beforeEach(() => {
  vi.useFakeTimers();
  made = [];
  heard = [];
  states = [];
  listener = new Listener(() => {
    const recognition = new FakeRecognition();
    made.push(recognition);
    return recognition;
  });
  listener.subscribe((snapshot) => states.push(snapshot));
});
afterEach(() => vi.useRealTimers());

describe('listening to the other person', () => {
  test('listens for one sentence in the chosen language and hands it over tidied', () => {
    listener.start(options());
    const recognition = made[0];
    expect(recognition).toMatchObject({ lang: 'en-GB', continuous: false, interimResults: true, started: 1 });
    expect(listener.current.state).toBe('listening');

    recognition.hear([['what do you', false]]);
    expect(listener.current.interim).toBe('What do you');
    expect(heard).toEqual([]);

    recognition.hear([['what do you want to eat', true]]);
    recognition.onend?.();
    expect(heard).toEqual(['What do you want to eat']);
    expect(listener.current).toEqual({ state: 'off', interim: '', message: '' });
  });

  test('the screen says "listening" from the moment it is asked, before the browser confirms', () => {
    listener.start(options());
    expect(states[states.length - 1].state).toBe('listening');
  });

  test('silence is not an error and hands nothing over', () => {
    listener.start(options());
    made[0].onerror?.({ error: 'no-speech' });
    made[0].onend?.();
    expect(heard).toEqual([]);
    expect(listener.current).toEqual({ state: 'off', interim: '', message: '' });
  });

  test('gives up after the window, keeping whatever was already heard', () => {
    listener.start(options());
    made[0].hear([['are you okay', true]]);
    vi.advanceTimersByTime(8100);
    expect(made[0].stopped).toBe(1);
    expect(heard).toEqual(['Are you okay']);
    expect(listener.listening).toBe(false);
  });

  test('stopping throws away anything half heard', () => {
    listener.start(options());
    made[0].hear([['do you want', false]]);
    listener.stop();
    made[0].onend?.();
    expect(made[0].aborted).toBe(1);
    expect(heard).toEqual([]);
    expect(listener.current.state).toBe('off');
  });

  test('a refused microphone is a denial when asked by hand, and only a request for a tap when automatic', () => {
    listener.start(options(true));
    made[0].onerror?.({ error: 'not-allowed' });
    made[0].onend?.();
    expect(listener.current.state).toBe('denied');
    expect(listener.current.message).toContain('not allowed');

    listener.start(options(false));
    made[1].onerror?.({ error: 'not-allowed' });
    made[1].onend?.();
    expect(listener.current.state).toBe('blocked');
    expect(listener.current.message).toContain('tap');
  });

  test('being offline is explained', () => {
    listener.start(options());
    made[0].onerror?.({ error: 'network' });
    made[0].onend?.();
    expect(listener.current).toMatchObject({ state: 'error', message: 'Listening needs an internet connection.' });
  });

  test('a browser with no speech recognition says so', () => {
    const none = new Listener(() => null);
    none.start(options());
    expect(none.current.state).toBe('unsupported');
    expect(heard).toEqual([]);
  });

  test('starting again replaces the turn under way, and the old one cannot report', () => {
    listener.start(options());
    const first = made[0];
    listener.start(options());
    expect(first.aborted).toBe(1);
    first.hear([['stale words', true]]);
    first.onend?.();
    expect(heard).toEqual([]);
    expect(listener.current.state).toBe('listening');
  });

  test('tidies what the recogniser returns', () => {
    expect(tidyTranscript('  do you   want juice ')).toBe('Do you want juice');
    expect(tidyTranscript('')).toBe('');
    expect(tidyTranscript('x'.repeat(500))).toHaveLength(300);
  });
});
