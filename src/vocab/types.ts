/**
 * Vocabulary data model.
 *
 * A `Word` is one thing a person can select: a single word, a short multi-word
 * unit ("ice cream", "turn on"), or a whole ready-made phrase. Besides what the
 * tile shows, each word carries just enough grammar for the on-device sentence
 * engine to put it into a sentence correctly without a language model.
 */

export type Pos =
  | 'pronoun'
  | 'noun'
  | 'verb'
  | 'adj'
  | 'adv'
  | 'prep'
  | 'det'
  | 'conj'
  | 'question'
  | 'social'
  | 'neg'
  | 'aux'
  | 'num'
  | 'phrase';

/** How a noun behaves when it needs a determiner. */
export type NounKind =
  | 'count' // a cookie / cookies
  | 'mass' // some water
  | 'plural' // (some) grapes, my shoes
  | 'unique' // the TV, the park
  | 'bare' // lunch, home (no article)
  | 'proper'; // Mom, Grandma (capitalised, no article)

/** How a place combines with "go": to the park / to a party / to school / home / to my room. */
export type PlaceKind = 'the' | 'a' | 'to' | 'bare' | 'my';

/**
 * Verb classes drive what a bare verb most plausibly means.
 * - want:   desire verbs that take "to + verb" (want, need, like, love, hate)
 * - self:   things I do, so a bare verb reads as a wish ("eat" -> "I want to eat.")
 * - other:  things I ask of someone ("help", "open") -> request / imperative
 * - state:  stative verbs, no progressive ("I know", never "I am knowing")
 * - motion: verbs that take a destination (go, come, walk)
 * - feel:   "feel" + adjective
 * - say:    communication verbs
 * - think:  cognition verbs
 */
export type VerbClass = 'want' | 'self' | 'other' | 'state' | 'motion' | 'feel' | 'say' | 'think';

export type TenseCue = 'past' | 'future' | 'now';

export interface Word {
  /** Stable identifier, unique across the vocabulary. */
  id: string;
  /** What the tile shows. */
  label: string;
  /** What goes into a sentence (defaults to the label). */
  text: string;
  pos: Pos;
  /** Which category board the word lives on (food, places, feelings ...). */
  group: string;

  // nouns
  noun?: NounKind;
  place?: PlaceKind;
  person?: boolean;
  body?: boolean;
  /** Default determiner is "my" (my phone, my blanket, my head). */
  mine?: boolean;
  /** Irregular plural form. */
  plural?: string;

  // verbs
  verb?: VerbClass;

  // adjectives
  feeling?: boolean;
  color?: boolean;

  // adverbs
  tense?: TenseCue;
  /** Degree adverbs that sit in front of an adjective or verb (very, really, too). */
  degree?: boolean;

  // pronouns
  /** Subject form (I, you, he ...). */
  subject?: boolean;
  /** Object form (me, him ...). */
  object?: boolean;
  /** Possessive determiner (my, your ...). */
  possessive?: boolean;
  /** Third person singular: takes "is" and "-s". */
  third?: boolean;
  /** Plural subject: takes "are". */
  many?: boolean;

  /** A ready-made utterance: selecting it speaks immediately. */
  speakNow?: boolean;
  /** Added by the person or their supporter rather than shipped with the app. */
  custom?: boolean;
}

/** Fitzgerald-key colour families used to tint tiles. */
export type ColorKey =
  | 'people'
  | 'verb'
  | 'describe'
  | 'noun'
  | 'social'
  | 'question'
  | 'little'
  | 'negation'
  | 'time'
  | 'folder'
  | 'action';

export type BoardItem =
  | { kind: 'word'; id: string }
  | { kind: 'folder'; board: string };

export interface Board {
  id: string;
  label: string;
  /** Word id whose symbol represents this board on folder tiles. */
  icon: string;
  items: BoardItem[];
  /** Selecting a word here returns to the home board (fringe vocabulary). */
  autoReturn: boolean;
}
