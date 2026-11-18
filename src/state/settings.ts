import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { DEFAULT_ACCESS, type AccessSettings } from '../access/controller';
import type { PersonalModel } from '../access/gazeModel';
import { DEFAULT_AI_SETTINGS, type AiSettings } from '../llm';
import type { Pronunciation } from '../speech/voices';

/**
 * Everything the person or their supporter can set, kept in this browser only.
 * There is no account and no server: settings never leave the device.
 */

export type Theme = 'system' | 'light' | 'dark' | 'contrast';
export type TileSize = 'auto' | 's' | 'm' | 'l' | 'xl';
export type CustomKind = 'thing' | 'person' | 'action' | 'describe' | 'phrase';

export interface CustomWord {
  id: string;
  label: string;
  kind: CustomKind;
  /** The category board it appears on. */
  board: string;
  /** A small picture as a data URL, if one was added. */
  image?: string;
}

export interface VoiceSettings {
  rate: number;
  pitch: number;
  volume: number;
  voiceUri: string;
  language: string;
  /** Only use voices that run on this device, so what is said is never sent to the browser maker. */
  onDeviceOnly: boolean;
  /** Say each word as it is chosen. */
  speakWords: boolean;
  pronunciations: Pronunciation[];
}

export interface SentenceSettings {
  contractions: boolean;
  /** How many suggested sentences to show. */
  count: number;
  /** Show likely next words above the board. */
  predictions: boolean;
  /** Go back to the home board after choosing a word from a category. */
  autoHome: boolean;
}

export interface LookSettings {
  theme: Theme;
  tileSize: TileSize;
  showLabels: boolean;
  /** Tint tiles by word type (the Fitzgerald key used in speech therapy). */
  colorCoding: boolean;
  reduceMotion: boolean;
}

export interface Settings {
  /** The welcome screens have been completed. */
  onboarded: boolean;
  access: AccessSettings;
  /** Saved calibrations, by method and screen orientation. */
  models: Record<string, PersonalModel>;
  voice: VoiceSettings;
  sentences: SentenceSettings;
  ai: AiSettings;
  /** Keep the API key in this browser between visits. When off it is forgotten when the tab closes. */
  rememberKey: boolean;
  profile: { name: string; about: string };
  look: LookSettings;
  hiddenWords: string[];
  customWords: CustomWord[];
}

export const DEFAULT_SETTINGS: Settings = {
  onboarded: false,
  access: DEFAULT_ACCESS,
  models: {},
  voice: {
    rate: 1,
    pitch: 1,
    volume: 1,
    voiceUri: '',
    language: typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('en') ? navigator.language : 'en-US',
    onDeviceOnly: true,
    speakWords: false,
    pronunciations: [],
  },
  sentences: { contractions: true, count: 3, predictions: true, autoHome: true },
  ai: DEFAULT_AI_SETTINGS,
  rememberKey: true,
  profile: { name: '', about: '' },
  look: { theme: 'system', tileSize: 'auto', showLabels: true, colorCoding: true, reduceMotion: false },
  hiddenWords: [],
  customWords: [],
};

interface SettingsStore extends Settings {
  /** Change one group of settings, e.g. `patch('voice', { rate: 1.2 })`. */
  patch<K extends 'access' | 'voice' | 'sentences' | 'ai' | 'profile' | 'look'>(group: K, change: Partial<Settings[K]>): void;
  set(change: Partial<Settings>): void;
  saveModel(key: string, model: PersonalModel): void;
  forgetModels(): void;
  addCustomWord(word: CustomWord): void;
  removeCustomWord(id: string): void;
  toggleHidden(id: string): void;
  /** Everything back to how it was on first use. */
  reset(): void;
}

const STORAGE_KEY = 'voice-before-words:settings';

/** Fill in anything a saved copy from an older version is missing. */
function withDefaults(saved: Partial<Settings> | undefined): Settings {
  const s = saved ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    access: { ...DEFAULT_SETTINGS.access, ...s.access },
    voice: { ...DEFAULT_SETTINGS.voice, ...s.voice },
    sentences: { ...DEFAULT_SETTINGS.sentences, ...s.sentences },
    ai: { ...DEFAULT_SETTINGS.ai, ...s.ai },
    profile: { ...DEFAULT_SETTINGS.profile, ...s.profile },
    look: { ...DEFAULT_SETTINGS.look, ...s.look },
    models: s.models ?? {},
    hiddenWords: s.hiddenWords ?? [],
    customWords: s.customWords ?? [],
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

function safeStorage() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('voice-before-words:probe', '1');
      localStorage.removeItem('voice-before-words:probe');
      return localStorage;
    }
  } catch {
    // Private browsing or storage switched off: carry on without saving.
  }
  return memoryStorage;
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      patch: (group, change) => set((state) => ({ [group]: { ...state[group], ...change } }) as Partial<SettingsStore>),
      set: (change) => set(change),
      saveModel: (key, model) => set((state) => ({ models: { ...state.models, [key]: model } })),
      forgetModels: () => set({ models: {} }),
      addCustomWord: (word) => set((state) => ({ customWords: [...state.customWords.filter((item) => item.id !== word.id), word] })),
      removeCustomWord: (id) => set((state) => ({ customWords: state.customWords.filter((item) => item.id !== id) })),
      toggleHidden: (id) =>
        set((state) => ({
          hiddenWords: state.hiddenWords.includes(id) ? state.hiddenWords.filter((item) => item !== id) : [...state.hiddenWords, id],
        })),
      reset: () => set({ ...DEFAULT_SETTINGS }),
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(safeStorage),
      // Functions are not saved, and neither is the key when the person asked for it not to be.
      partialize: (state) => {
        const { patch, set: _set, saveModel, forgetModels, addCustomWord, removeCustomWord, toggleHidden, reset, ...data } = state;
        void patch, _set, saveModel, forgetModels, addCustomWord, removeCustomWord, toggleHidden, reset;
        return data.rememberKey ? data : { ...data, ai: { ...data.ai, apiKey: '' } };
      },
      merge: (persisted, current) => ({ ...current, ...withDefaults(persisted as Partial<Settings>) }),
    },
  ),
);

/** The settings as plain data, for exporting a backup. The API key is never included. */
export function exportSettings(): Settings {
  const { patch, set, saveModel, forgetModels, addCustomWord, removeCustomWord, toggleHidden, reset, ...data } = useSettings.getState();
  void patch, set, saveModel, forgetModels, addCustomWord, removeCustomWord, toggleHidden, reset;
  return { ...data, ai: { ...data.ai, apiKey: '' } };
}

export function importSettings(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const incoming = withDefaults(data as Partial<Settings>);
  // A backup never carries a key, so keep the one already here.
  const key = useSettings.getState().ai.apiKey;
  useSettings.setState({ ...incoming, ai: { ...incoming.ai, apiKey: key } });
  return true;
}
