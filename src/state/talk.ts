import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { access } from '../access/controller';
import { literal, suggest } from '../language/engine';
import { localReplies, type Reply } from '../language/replies';
import { emptyUsage, learn, type UsageModel } from '../language/predict';
import type { Suggestion, Token } from '../language/types';
import { AiError, aiSuggest, describeAiError, isAiReady, SuggestionMemory } from '../llm';
import { speaker } from '../speech/speaker';
import { HOME_BOARD } from '../vocab/boards';
import { getWord } from '../vocab/lexicon';
import type { Word } from '../vocab/types';
import { listenAfter, onHeard } from './listening';
import { cleanFavourites, MAX_FAVOURITES } from './phrases';
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

/** One thing said in the conversation, by the person or by whoever is talking with them. */
export interface Turn {
  who: 'me' | 'partner';
  text: string;
  at: number;
}

/** How much of the conversation is kept in mind, and for how long after it goes quiet. */
const MAX_TURNS = 12;
const TURN_LIFE_MS = 15 * 60 * 1000;

function withTurn(turns: Turn[], who: Turn['who'], text: string): Turn[] {
  const now = Date.now();
  const clean = text.trim();
  const fresh = turns.filter((turn) => now - turn.at < TURN_LIFE_MS);
  return clean ? [...fresh, { who, text: clean, at: now }].slice(-MAX_TURNS) : fresh;
}

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
  /** What the other person said: typed in by someone, or heard by the microphone. */
  partnerSaid: string;
  /** Where `partnerSaid` came from, so the screen can say "Heard" only for the microphone. */
  partnerFrom: 'typed' | 'heard';
  /** Answers on offer to `partnerSaid` while no words have been chosen yet. */
  replies: Reply[];
  /**
   * Both sides of the current conversation, so replies can follow it. Kept in
   * memory only: the other person's words are never saved to the device.
   */
  turns: Turn[];
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
  /** The microphone heard the other person say this. */
  heard(text: string): void;
  /** Use a suggested reply: speak it, or for a starter, begin the message with it. */
  useReply(reply: Reply): void;
  /** Add a sentence to the favourites, or take it out. */
  toggleSaved(text: string): void;
  /** Replace the favourites, for restoring a backup. */
  setSaved(list: unknown): void;
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
      partnerFrom: 'typed',
      replies: [],
      turns: [],
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
        const { tokens, history, usage, partnerSaid, turns } = get();
        listenAfter(speaker.speak(text, speakOptions()));
        set({
          spoken: true,
          // What the other person said was context for this answer only.
          partnerSaid: '',
          replies: [],
          turns: withTurn(withTurn(turns, 'partner', partnerSaid), 'me', text),
          lastSaid: text,
          history: [...history, { text, at: Date.now() }].slice(-200),
          usage: learn(usage, tokens.map((token) => token.id)),
        });
      },

      sayPhrase(text) {
        // A whole phrase said while a question is waiting, with no message started, is the answer to it.
        const answering = get().tokens.length === 0 && !!get().partnerSaid;
        listenAfter(speaker.speak(text, speakOptions()));
        set((state) => ({
          partnerSaid: answering ? '' : state.partnerSaid,
          turns: withTurn(answering ? withTurn(state.turns, 'partner', state.partnerSaid) : state.turns, 'me', text),
          lastSaid: text,
          history: [...state.history, { text, at: Date.now() }].slice(-200),
        }));
        if (answering) get().refresh();
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
        set({ partnerSaid: text, partnerFrom: 'typed' });
        get().refresh();
      },

      heard(text) {
        const clean = text.trim();
        if (!clean) return;
        // Something said earlier and never answered is still part of the conversation.
        set((state) => ({
          partnerSaid: clean,
          partnerFrom: 'heard',
          turns: withTurn(state.turns, 'partner', state.partnerSaid),
          // A message that has already been spoken makes way for the answers to what came back.
          tokens: state.spoken ? [] : state.tokens,
          spoken: false,
        }));
        access.layoutChanged();
        get().refresh();
      },

      useReply(reply) {
        if (!reply.start) {
          get().sayPhrase(reply.text);
          return;
        }
        const tokens: Token[] = [];
        for (const id of reply.start.words) {
          const word = getWord(id);
          if (word) tokens.push({ id: word.id, text: word.text, word });
        }
        set({ tokens, typed: '', spoken: false, cleared: null, board: reply.start.board, page: 0 });
        access.layoutChanged();
        get().refresh();
      },

      toggleSaved(text) {
        set((state) => ({ saved: state.saved.includes(text) ? state.saved.filter((item) => item !== text) : [...state.saved, text].slice(-MAX_FAVOURITES) }));
      },

      setSaved(list) {
        set({ saved: cleanFavourites(list) });
      },

      forgetHistory() {
        memory.clear();
        // Favourites were chosen on purpose, so clearing the history leaves them alone.
        set({ history: [], usage: emptyUsage(), memory: [], lastSaid: '', turns: [], partnerSaid: '', replies: [] });
      },

      refresh() {
        const { tokens, partnerSaid, history, turns } = get();
        const settings = useSettings.getState();
        const max = settings.sentences.count;
        pending?.abort();
        pending = null;
        if (timer) clearTimeout(timer);
        timer = null;

        const ready = isAiReady(settings.ai);
        const about = [settings.profile.name && `Their name is ${settings.profile.name}.`, settings.profile.about].filter(Boolean).join(' ');
        if (tokens.length === 0) {
          const heard = partnerSaid.trim();
          if (!heard) {
            set({ suggestions: [], replies: [], ai: ready ? 'ready' : 'off', aiMessage: '' });
            return;
          }
          // Someone has spoken and nothing is chosen yet: offer answers. On-device ones show at once.
          const slots = max + 1;
          const local = localReplies(heard, { name: settings.profile.name, contractions: settings.sentences.contractions, max: slots });
          if (!ready) {
            set({ suggestions: [], replies: local, ai: 'off', aiMessage: '' });
            return;
          }
          set({ suggestions: [], replies: local, ai: 'waiting', aiMessage: '' });
          const controller = new AbortController();
          pending = controller;
          timer = setTimeout(() => {
            aiSuggest(
              { words: [], history: [], about, partnerSaid: heard, mode: 'replies', turns: turns.map(({ who, text }) => ({ who, text })), max: slots, contractions: settings.sentences.contractions },
              settings.ai,
              controller.signal,
            )
              .then((fromAi) => {
                if (controller.signal.aborted || get().partnerSaid.trim() !== heard || get().tokens.length > 0) return;
                // The AI's answers first, then a starter towards the right board, then on-device ones to fill up.
                const starters = local.filter((reply) => reply.start);
                const merged: Reply[] = [];
                for (const reply of [...fromAi.slice(0, starters.length > 0 ? slots - 1 : slots), ...starters, ...local]) {
                  if (!merged.some((item) => item.text.toLowerCase() === reply.text.toLowerCase())) merged.push(reply);
                  if (merged.length >= slots) break;
                }
                set({ replies: merged, ai: 'ready', aiMessage: '' });
              })
              .catch((error: unknown) => {
                if (controller.signal.aborted) return;
                const failure = error instanceof AiError ? error : new AiError('network', 'Something went wrong.');
                if (failure.kind === 'aborted') return;
                set({ ai: 'failed', aiMessage: describeAiError(failure) });
              });
          }, 350);
          return;
        }
        if (get().replies.length > 0) set({ replies: [] });
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
              about,
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

// What the microphone hears goes into the conversation.
onHeard((text) => useTalk.getState().heard(text));

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
