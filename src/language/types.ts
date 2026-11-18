import type { Word } from '../vocab/types';

/** One selected item in the message being built. */
export interface Token {
  /** Lexicon id, or `text:<typed word>` for something spelled on the keyboard. */
  id: string;
  /** What this contributes to a sentence. */
  text: string;
  /** The vocabulary entry, when the token came from a tile. */
  word?: Word;
}

/**
 * What a suggested sentence is doing. Shown as a small tag on each suggestion so
 * the person can tell at a glance which reading it is before choosing it.
 */
export type SuggestionKind =
  | 'words' // exactly the words chosen, in order
  | 'say' // a plain statement
  | 'want' // a wish or need
  | 'now' // happening now
  | 'past' // already happened
  | 'future' // will happen
  | 'ask' // a question
  | 'tell'; // asking someone to do something

export type SuggestionSource = 'words' | 'rules' | 'ai' | 'memory';

export interface Suggestion {
  text: string;
  kind: SuggestionKind;
  source: SuggestionSource;
}

export interface LanguageOptions {
  /** "I'm", "don't" rather than "I am", "do not". */
  contractions: boolean;
  /** Maximum suggestions to return (not counting the literal words). */
  max: number;
}

export const DEFAULT_LANGUAGE_OPTIONS: LanguageOptions = { contractions: true, max: 4 };
