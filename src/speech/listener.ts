/**
 * Listening to the other person: turns what someone says to the AAC user into
 * text, so the app can offer replies without anyone typing.
 *
 * This uses the browser's own speech recognition. That matters for privacy: in
 * Chrome the sound is sent to Google, and in Safari to Apple, to be turned into
 * words. It is therefore off until someone turns it on in the settings, where
 * this is spelled out. This file never touches the audio itself.
 *
 * Quirks handled here:
 *  - Only Chrome, Edge and Safari have it. Firefox does not.
 *  - A recognition session ends by itself after a pause, with or without a result.
 *  - Browsers may refuse to start without a tap ("not-allowed"). An automatic
 *    start that is refused is reported as `blocked`, not as a permanent denial.
 */

export type ListenState =
  | 'off'
  | 'listening'
  /** The browser has no speech recognition. */
  | 'unsupported'
  /** The microphone permission was refused. */
  | 'denied'
  /** The browser wants a tap before it will listen. */
  | 'blocked'
  | 'error';

export interface ListenSnapshot {
  state: ListenState;
  /** What has been heard so far in this turn, before it is final. */
  interim: string;
  /** A sentence a person can act on, when something went wrong. */
  message: string;
}

export interface ListenOptions {
  language: string;
  /** Give up after this long with nothing heard. */
  windowMs: number;
  /** Started by a tap (true) or by the app after speaking (false). */
  byHand: boolean;
  onHeard(text: string): void;
}

/** The parts of the browser's SpeechRecognition this file relies on. */
export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export interface RecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

type Factory = () => RecognitionLike | null;

function browserFactory(): RecognitionLike | null {
  if (typeof window === 'undefined') return null;
  const scope = window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike };
  const Recognition = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
  if (!Recognition) return null;
  try {
    return new Recognition();
  } catch {
    return null;
  }
}

/** Tidy a transcript: recognisers return lower case with no full stop, and sometimes a stray space. */
export function tidyTranscript(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!clean) return '';
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

const MESSAGES: Record<string, string> = {
  network: 'Listening needs an internet connection.',
  'audio-capture': 'No microphone was found.',
  'language-not-supported': 'The browser cannot listen in this language.',
};

export class Listener {
  private recognition: RecognitionLike | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private snapshot: ListenSnapshot = { state: 'off', interim: '', message: '' };
  private readonly listeners = new Set<(snapshot: ListenSnapshot) => void>();

  constructor(private readonly factory: Factory = browserFactory) {}

  get supported(): boolean {
    if (this.factory !== browserFactory) return true;
    if (typeof window === 'undefined') return false;
    const scope = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    return !!(scope.SpeechRecognition ?? scope.webkitSpeechRecognition);
  }

  get current(): ListenSnapshot {
    return this.snapshot;
  }

  get listening(): boolean {
    return this.snapshot.state === 'listening';
  }

  subscribe(listener: (snapshot: ListenSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private set(change: Partial<ListenSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...change };
    for (const listener of this.listeners) listener(this.snapshot);
  }

  /** Listen for one thing the other person says. Replaces any turn already under way. */
  start(options: ListenOptions): void {
    this.stop();
    const recognition = this.factory();
    if (!recognition) {
      this.set({ state: 'unsupported', interim: '', message: 'This browser cannot listen. Chrome, Edge and Safari can.' });
      return;
    }

    let heard = '';
    let failed = false;
    recognition.lang = options.language || 'en-US';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      if (this.recognition === recognition) this.set({ state: 'listening', interim: '', message: '' });
    };
    recognition.onresult = (event) => {
      if (this.recognition !== recognition) return;
      let final = '';
      let interim = '';
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) final += `${text} `;
        else interim += `${text} `;
      }
      heard = final.trim();
      this.set({ interim: tidyTranscript(`${final}${interim}`) });
    };
    recognition.onerror = (event) => {
      if (this.recognition !== recognition) return;
      // Silence and being stopped on purpose are not failures.
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      failed = true;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this.set(
          options.byHand
            ? { state: 'denied', interim: '', message: 'The microphone is not allowed. Allow it for this site in the browser’s settings, then try again.' }
            : { state: 'blocked', interim: '', message: 'The browser wants a tap before it listens. Tap the microphone.' },
        );
        return;
      }
      this.set({ state: 'error', interim: '', message: MESSAGES[event.error] ?? 'Listening stopped unexpectedly.' });
    };
    recognition.onend = () => {
      if (this.recognition !== recognition) return;
      this.release();
      const text = tidyTranscript(heard);
      if (!failed) this.set({ state: 'off', interim: '', message: '' });
      if (text) options.onHeard(text);
    };

    this.recognition = recognition;
    // Shown at once, so there is never a moment when the microphone is on and the screen does not say so.
    this.set({ state: 'listening', interim: '', message: '' });
    this.timer = setTimeout(() => {
      // Ask for whatever has been heard so far; `onend` then finishes the turn.
      try {
        recognition.stop();
      } catch {
        this.stop();
      }
    }, Math.max(2000, options.windowMs));
    try {
      recognition.start();
    } catch {
      this.release();
      this.set({ state: 'error', interim: '', message: 'Listening could not start.' });
    }
  }

  private release(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.recognition = null;
  }

  /** Stop at once and throw away anything half heard. */
  stop(): void {
    const recognition = this.recognition;
    this.release();
    if (recognition) {
      try {
        recognition.abort();
      } catch {
        // already stopped
      }
    }
    if (this.snapshot.state === 'listening') this.set({ state: 'off', interim: '', message: '' });
  }

  /** Forget an earlier problem, for example after the setting is turned off and on again. */
  reset(): void {
    this.stop();
    this.set({ state: 'off', interim: '', message: '' });
  }
}

export const listener = new Listener();
