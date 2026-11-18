import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { access } from '../access/controller';
import { literal, suggest } from '../language/engine';
import { emptyUsage, learn, type UsageModel } from '../language/predict';
import type { Suggestion, Token } from '../language/types';
import { AiError, aiSuggest, describeAiError, isAiReady, SuggestionMemory } from '../llm';
import { speaker } from '../speech/speaker';
import { HOME_BOARD } from '../vocab/boards';
import { getWord } from '../vocab/lexicon';
import type { Word } from '../vocab/types';
import { useSettings } from './settings';

/**
 * The conversation: the message being built, what to suggest for it, what has
 * been said. Only the history, the learned word habits and the remembered AI
 * answers are saved, and only on this device.
 */

export interface Spoken {
  text: string;
  at: number;
}

export type AiState = 'off' | 'waiting' | 'ready' | 'failed';

interface TalkStore {
  tokens: Token[];
  /** Letters being spelled on the keyboard, not yet added as a word. */
  typed: string;
  /** The message has been spoken; choosing another word starts a new one. */
  spoken: boolean;
  board: string;
  page: number;
  suggestions: Suggestion[];
  ai: AiState;
  aiMessage: string;
  /** What Clear removed, so it can be put back. */
  cleared: Token[] | null;
  /** What the other person said, if someone typed it in for context. */
  partnerSaid: string;
  /** The sentence last spoken, shown so it can be read or repeated. */
  lastSaid: string;

  history: Spoken[];
  usage: UsageModel;
  memory: [string, Suggestion[]][];
  saved: string[];

  add(word: Word): void;
  type(letter: string): void;
  commitTyped(): void;
  backspace(): void;
  clear(): void;
  undoClear(): void;
  /** Speak a sentence built from the current message. */
  say(text: string): void;
  /** Speak something that is not the current message (a quick phrase, a repeat). */
  sayPhrase(text: string): void;
  open(board: string): void;
  setPage(page: number): void;
  setPartnerSaid(text: string): void;
  toggleSaved(text: string): void;
  refresh(): void;
  forgetHistory(): void;
}

const memory = new SuggestionMemory();
let pending: AbortController | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/** AI suggestions first, then on-device ones that say something different, up to the limit. */
function merge(primary: Suggestion[], secondary: Suggestion[], exact: string, max: number): Suggestion[] {
  const seen = new Set<string>([exact.toLowerCase()]);
  const out: Suggestion[] = [];
  for (const suggestion of [...primary, ...secondary]) {
    const key = suggestion.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(suggestion);
    if (out.length >= max) break;
  }
  return out;
}

function speakOptions() {
  const voice = useSettings.getState().voice;
  return {
    rate: voice.rate,
    pitch: voice.pitch,
    volume: voice.volume,
    voiceUri: voice.voiceUri,
    language: voice.language,
    onDeviceVoicesOnly: voice.onDeviceOnly,
    pronunciations: voice.pronunciations,
  };
}

const memoryStorage = (() => {
  const map = new Map<string, string>();
  return {
    getItem: (name: string) => map.get(name) ?? null,
    setItem: (name: string, value: string) => void map.set(name, value),
    removeItem: (name: string) => void map.delete(name),
  };
})();

export const useTalk = create<TalkStore>()(
  persist(
    (set, get) => ({
      tokens: [],
      typed: '',
      spoken: false,
      board: HOME_BOARD,
      page: 0,
      suggestions: [],
      ai: 'off',
      aiMessage: '',
      cleared: null,
      partnerSaid: '',
      lastSaid: '',
      history: [],
      usage: emptyUsage(),
      memory: [],
      saved: [],

      add(word) {
        const settings = useSettings.getState();
        if (word.speakNow) {
          get().sayPhrase(word.text);
          return;
        }
        const start = get().spoken ? [] : get().tokens;
        const tokens = [...start, { id: word.id, text: word.text, word }];
        set({ tokens, typed: '', spoken: false, cleared: null });
        if (settings.voice.speakWords) void speaker.speak(word.label, speakOptions());
        if (settings.sentences.autoHome && get().board !== HOME_BOARD && get().board !== 'keyboard') set({ board: HOME_BOARD, page: 0 });
        access.layoutChanged();
        get().refresh();
      },

      type(letter) {
        set((state) => ({ typed: state.typed + letter, tokens: state.spoken ? [] : state.tokens, spoken: false }));
      },

      commitTyped() {
        const typed = get().typed.trim();
        if (!typed) return;
        // A typed word that is in the vocabulary behaves exactly like its tile.
        const known = getWord(typed.toLowerCase());
        const token: Token = known && !known.speakNow ? { id: known.id, text: known.text, word: known } : { id: `text:${typed}`, text: typed };
        set((state) => ({ tokens: [...state.tokens, token], typed: '' }));
        get().refresh();
      },

      backspace() {
        const { typed, tokens } = get();
        if (typed) {
          set({ typed: typed.slice(0, -1) });
          return;
        }
        if (tokens.length === 0) return;
        access.undoLearning();
        set({ tokens: tokens.slice(0, -1), spoken: false });
        get().refresh();
      },

      clear() {
        const { tokens } = get();
        set({ tokens: [], typed: '', spoken: false, cleared: tokens.length > 0 ? tokens : null });
        get().refresh();
      },

      undoClear() {
        const cleared = get().cleared;
        if (!cleared) return;
        set({ tokens: cleared, cleared: null, spoken: false });
        get().refresh();
      },

      say(text) {
        const { tokens, history, usage } = get();
        void speaker.speak(text, speakOptions());
        set({
          spoken: true,
          // What the other person said was context for this answer only.
          partnerSaid: '',
          lastSaid: text,
          history: [...history, { text, at: Date.now() }].slice(-200),
          usage: learn(usage, tokens.map((token) => token.id)),
        });
      },

      sayPhrase(text) {
        void speaker.speak(text, speakOptions());
        set((state) => ({ lastSaid: text, history: [...state.history, { text, at: Date.now() }].slice(-200) }));
      },

      open(board) {
        if (board === get().board) return;
        set({ board, page: 0 });
        access.layoutChanged();
      },

      setPage(page) {
        set({ page: Math.max(0, page) });
        access.layoutChanged();
      },

      setPartnerSaid(text) {
        set({ partnerSaid: text });
        get().refresh();
      },

      toggleSaved(text) {
        set((state) => ({ saved: state.saved.includes(text) ? state.saved.filter((item) => item !== text) : [...state.saved, text].slice(-40) }));
      },

      forgetHistory() {
        memory.clear();
        set({ history: [], usage: emptyUsage(), memory: [], saved: [], lastSaid: '' });
      },

      refresh() {
        const { tokens, partnerSaid, history } = get();
        const settings = useSettings.getState();
        const max = settings.sentences.count;
        pending?.abort();
        pending = null;
        if (timer) clearTimeout(timer);
        timer = null;

        const ready = isAiReady(settings.ai);
        if (tokens.length === 0) {
          set({ suggestions: [], ai: ready ? 'ready' : 'off', aiMessage: '' });
          return;
        }
        const exact = literal(tokens);
        const local = suggest(tokens, { contractions: settings.sentences.contractions, max });
        // One word alone is handled well on the device; the AI earns its keep from two words up.
        if (!ready || tokens.length < 2) {
          set({ suggestions: local, ai: ready ? 'ready' : 'off', aiMessage: '' });
          return;
        }

        const words = tokens.map((token) => token.text);
        // What the other person said changes the answer, so those are not remembered.
        const remembered = partnerSaid ? undefined : memory.get(words);
        if (remembered) {
          set({ suggestions: merge(remembered, local, exact, max), ai: 'ready', aiMessage: '' });
          return;
        }

        set({ suggestions: local, ai: 'waiting', aiMessage: '' });
        const controller = new AbortController();
        pending = controller;
        // Wait a moment: there is no point asking about a message that is still being built.
        timer = setTimeout(() => {
          aiSuggest(
            {
              words,
              history: history.slice(-4).map((item) => item.text),
              about: [settings.profile.name && `Their name is ${settings.profile.name}.`, settings.profile.about].filter(Boolean).join(' '),
              partnerSaid,
              max,
              contractions: settings.sentences.contractions,
            },
            settings.ai,
            controller.signal,
          )
            .then((fromAi) => {
              if (controller.signal.aborted || get().tokens !== tokens) return;
              if (!partnerSaid) {
                memory.set(words, fromAi);
                set({ memory: memory.toJSON() });
              }
              set({ suggestions: merge(fromAi, local, exact, max), ai: 'ready', aiMessage: '' });
            })
            .catch((error: unknown) => {
              if (controller.signal.aborted) return;
              const failure = error instanceof AiError ? error : new AiError('network', 'Something went wrong.');
              if (failure.kind === 'aborted') return;
              // The on-device suggestions are already showing, so nothing is lost. Just say why.
              set({ ai: 'failed', aiMessage: describeAiError(failure) });
            });
        }, 450);
      },
    }),
    {
      name: 'voice-before-words:talk',
      version: 1,
      storage: createJSONStorage(() => {
        try {
          if (typeof localStorage !== 'undefined') return localStorage;
        } catch {
          // fall through
        }
        return memoryStorage;
      }),
      partialize: (state) => ({ history: state.history, usage: state.usage, memory: state.memory, saved: state.saved }),
      onRehydrateStorage: () => (state) => {
        // Refill the in-memory phrase memory from what was saved last time.
        for (const [key, value] of state?.memory ?? []) memory.set(key.split('|'), value);
      },
    },
  ),
);

/** The exact words of the message being built. */
export function currentLiteral(tokens: Token[]): string {
  return literal(tokens);
}

/** Phrases to offer when nothing has been chosen yet: saved ones, then the person's own most used. */
export function quickPhrases(history: Spoken[], saved: string[], count: number): string[] {
  const counts = new Map<string, number>();
  for (const item of history) counts.set(item.text, (counts.get(item.text) ?? 0) + 1);
  const frequent = Array.from(counts.entries())
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([text]) => text);
  const starters = ['I need help.', 'Yes.', 'No.', 'I need a break.', 'Thank you.'];
  const out: string[] = [];
  for (const text of [...saved, ...frequent, ...starters]) {
    if (!out.includes(text)) out.push(text);
    if (out.length >= count) break;
  }
  return out;
}
