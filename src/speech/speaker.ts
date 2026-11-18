import { applyPronunciations, chooseVoice, type Pronunciation } from './voices';

/**
 * Speaking aloud with the browser's built-in speech.
 *
 * The browser API is simple but has sharp edges on phones, and every one of
 * them would silence someone mid-conversation if left alone:
 *  - Speech must first be started by a real touch or key press (`unlock`).
 *  - Voices arrive some time after the page loads, or never announce themselves.
 *  - Cancelling and speaking in the same instant can drop the new sentence.
 *  - The "finished" event sometimes never arrives, which would leave the app
 *    thinking it is still talking.
 */

export interface SpeakOptions {
  /** 1 is normal speed. */
  rate: number;
  /** 1 is normal pitch. */
  pitch: number;
  /** 0 to 1. */
  volume: number;
  voiceUri: string;
  language: string;
  onDeviceVoicesOnly: boolean;
  pronunciations: Pronunciation[];
}

export const DEFAULT_SPEAK_OPTIONS: SpeakOptions = {
  rate: 1,
  pitch: 1,
  volume: 1,
  voiceUri: '',
  language: 'en-US',
  onDeviceVoicesOnly: true,
  pronunciations: [],
};

type Listener = (speaking: boolean) => void;

/** The slice of `window.speechSynthesis` that is used, so tests can stand in for it. */
export interface SynthLike {
  speak(utterance: SpeechSynthesisUtterance): void;
  cancel(): void;
  resume?(): void;
  getVoices(): SpeechSynthesisVoice[];
  addEventListener?(type: 'voiceschanged', listener: () => void): void;
}

export class Speaker {
  private readonly listeners = new Set<Listener>();
  private current: SpeechSynthesisUtterance | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private pending: ReturnType<typeof setTimeout> | null = null;
  private speaking = false;
  private unlocked = false;
  /** Settles the promise of whatever is being said now. */
  private finish: (() => void) | null = null;

  constructor(
    private readonly synth: SynthLike | undefined = typeof window !== 'undefined' ? window.speechSynthesis : undefined,
    private readonly createUtterance: (text: string) => SpeechSynthesisUtterance = (text) => new SpeechSynthesisUtterance(text),
  ) {}

  get supported(): boolean {
    return !!this.synth;
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  /** Be told whenever speaking starts or stops. Returns a function that stops listening. */
  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setSpeaking(value: boolean): void {
    if (this.speaking === value) return;
    this.speaking = value;
    for (const listener of this.listeners) listener(value);
  }

  voices(): SpeechSynthesisVoice[] {
    return this.synth?.getVoices() ?? [];
  }

  /** Resolves once voices are available, or after a short wait if the browser never says. */
  whenVoicesReady(timeoutMs = 2500): Promise<SpeechSynthesisVoice[]> {
    return new Promise((resolve) => {
      const synth = this.synth;
      if (!synth) return resolve([]);
      const existing = synth.getVoices();
      if (existing.length > 0) return resolve(existing);
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve(synth.getVoices());
      };
      synth.addEventListener?.('voiceschanged', finish);
      // Some browsers never fire the event: look again shortly, then give up waiting.
      setTimeout(() => synth.getVoices().length > 0 && finish(), 300);
      setTimeout(finish, timeoutMs);
    });
  }

  /**
   * Call from inside a real touch, click or key press. Phones refuse to speak
   * until speech has been started that way once; after that the app can speak
   * whenever it needs to, including from eye gaze or a face switch.
   */
  unlock(): void {
    if (this.unlocked || !this.synth) return;
    this.unlocked = true;
    try {
      const silent = this.createUtterance(' ');
      silent.volume = 0;
      this.synth.speak(silent);
    } catch {
      // Not being able to pre-warm is not fatal; the first real sentence will try again.
    }
  }

  stop(): void {
    if (this.pending) clearTimeout(this.pending);
    if (this.watchdog) clearTimeout(this.watchdog);
    this.pending = null;
    this.watchdog = null;
    this.current = null;
    try {
      this.synth?.cancel();
    } catch {
      // ignore
    }
    // Whoever was waiting for the interrupted sentence must not be left waiting forever.
    const finish = this.finish;
    this.finish = null;
    finish?.();
    this.setSpeaking(false);
  }

  /** Say something, replacing anything currently being said. Resolves when it finishes or is interrupted. */
  speak(text: string, options: SpeakOptions): Promise<void> {
    const synth = this.synth;
    const spoken = applyPronunciations(text, options.pronunciations).trim();
    if (!synth || !spoken) return Promise.resolve();
    this.stop();

    return new Promise((resolve) => {
      const utterance = this.createUtterance(spoken);
      utterance.rate = Math.max(0.3, Math.min(2, options.rate));
      utterance.pitch = Math.max(0.3, Math.min(2, options.pitch));
      utterance.volume = Math.max(0, Math.min(1, options.volume));
      utterance.lang = options.language;
      const voice = chooseVoice(synth.getVoices(), options.voiceUri, options.language, options.onDeviceVoicesOnly);
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      }

      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        if (this.finish === done) this.finish = null;
        if (this.current === utterance) {
          if (this.watchdog) clearTimeout(this.watchdog);
          this.watchdog = null;
          this.current = null;
          this.setSpeaking(false);
        }
        resolve();
      };
      this.finish = done;
      utterance.onend = done;
      utterance.onerror = done;

      // Keep a reference: some browsers drop the utterance, and its events, if nothing holds it.
      this.current = utterance;
      this.setSpeaking(true);
      // In case "finished" never arrives: allow generous time for the length, then move on.
      const expected = 2500 + (spoken.length * 110) / Math.max(0.3, options.rate);
      this.watchdog = setTimeout(done, expected);

      // Speaking in the same instant as cancelling can swallow the new sentence.
      this.pending = setTimeout(() => {
        this.pending = null;
        if (this.current !== utterance) return done();
        try {
          synth.resume?.();
          synth.speak(utterance);
        } catch {
          done();
        }
      }, 40);
    });
  }
}

/** One speaker for the whole app. */
export const speaker = new Speaker();
