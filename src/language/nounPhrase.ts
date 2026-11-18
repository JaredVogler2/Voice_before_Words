import type { Word } from '../vocab/types';
import { indefiniteArticle, pluralize, type Person } from './morphology';

/**
 * Noun phrases: turning "cookie", "more juice", "my red shoes" or "two apple"
 * into text with the right determiner and number for where it sits in the
 * sentence. Most of what makes telegraphic input sound wrong is a missing
 * "a", "the", "some" or "my", so this is where much of the repair happens.
 */

export type Cat =
  | 'SUBJ' // I you he she we they it everyone ...
  | 'OBJ' // me him us them
  | 'POSS' // my your his her our their
  | 'DEM' // this that these those
  | 'MINE' // mine yours
  | 'N'
  | 'V'
  | 'ADJ'
  | 'DEG' // very really too
  | 'TIME'
  | 'ADV'
  | 'P'
  | 'DET'
  | 'CONJ'
  | 'Q'
  | 'QM' // the "?" tile
  | 'NEG'
  | 'AUX'
  | 'NUM'
  | 'SOC'
  | 'PHR'
  | 'TXT'; // typed on the keyboard

export interface Tok {
  id: string;
  text: string;
  w?: Word;
  cat: Cat;
}

export interface NounPhraseParts {
  det?: Tok;
  poss?: Tok;
  dem?: Tok;
  num?: Tok;
  /** A person whose thing this is: "Mom" + "car" -> "Mom's car". */
  owner?: Tok;
  /** Degree words and adjectives, in order. */
  mods: string[];
  noun: Tok;
}

/**
 * Where the phrase sits, which decides its default determiner.
 * - specific: object of want / need / have / get ...   -> a cookie, some water
 * - generic:  object of like / love / hate              -> cookies, water
 * - negative: object under "not"                        -> a cookie, water
 * - subject:  doing the action                          -> the dog, my tummy
 * - predicate: after "is"                               -> a dog, water
 * - location: after in / on / under / at ...            -> the box
 * - with:     after with / for / about / of             -> a spoon, milk
 * - bare:     no article at all
 */
export type NounContext =
  | 'specific'
  | 'generic'
  | 'negative'
  | 'subject'
  | 'predicate'
  | 'location'
  | 'with'
  | 'bare';

export interface NounPhrase {
  text: string;
  person: Person;
  head?: Word;
}

const PLURAL_DETERMINERS = new Set(['some', 'all', 'more', 'any', 'both', 'many', 'a-lot', 'enough', 'other']);

function isCountable(word: Word | undefined): boolean {
  return !word || word.noun === undefined || word.noun === 'count' || word.noun === 'unique';
}

function withArticle(rest: string): string {
  return `${indefiniteArticle(rest)} ${rest}`;
}

/** Read a noun phrase starting at `start`. Returns null when no noun is found. */
export function readNounPhrase(toks: Tok[], start: number): { parts: NounPhraseParts; end: number } | null {
  let i = start;
  const parts: Partial<NounPhraseParts> & { mods: string[] } = { mods: [] };

  // A leading determiner-like word, optionally followed by a possessive ("all my toys").
  const first = toks[i];
  if (!first) return null;
  if (first.cat === 'DET') {
    parts.det = first;
    i++;
    if (toks[i]?.cat === 'POSS') parts.poss = toks[i++];
    else if (toks[i]?.cat === 'NUM') parts.num = toks[i++];
  } else if (first.cat === 'POSS') {
    parts.poss = first;
    i++;
  } else if (first.cat === 'DEM') {
    parts.dem = first;
    i++;
  } else if (first.cat === 'NUM') {
    parts.num = first;
    i++;
    if (toks[i]?.cat === 'DET' && toks[i].id === 'more') parts.det = toks[i++];
  }

  while (toks[i] && (toks[i].cat === 'DEG' || toks[i].cat === 'ADJ')) {
    parts.mods.push(toks[i].text);
    i++;
  }
  // "very" with nothing to modify is not part of a noun phrase.
  const head = toks[i];
  if (!head || (head.cat !== 'N' && head.cat !== 'TXT')) return null;
  parts.noun = head;
  i++;
  return { parts: parts as NounPhraseParts, end: i };
}

/** The noun on its own, pluralised when asked. */
function nounText(noun: Tok, plural: boolean): string {
  const word = noun.w;
  if (!plural || !word || !isCountable(word)) return noun.text;
  return pluralize(noun.text, word.plural);
}

/** "Mom" is a name on its own but an ordinary noun after a determiner: "your mom". */
function common(noun: Tok): Tok {
  const word = noun.w;
  if (word?.noun !== 'proper' || !word.person || word.label.toLowerCase() !== word.text.toLowerCase()) return noun;
  return { ...noun, text: word.label };
}

export function renderNounPhrase(input: NounPhraseParts, context: NounContext): NounPhrase {
  const determined = !!(input.det || input.poss || input.dem || input.num);
  const parts = determined ? { ...input, noun: common(input.noun) } : input;
  const word = parts.noun.w;
  const kind = parts.noun.cat === 'TXT' ? 'proper' : (word?.noun ?? 'count');
  const mods = parts.mods.join(' ');
  const join = (...pieces: string[]) => pieces.filter(Boolean).join(' ');
  let plural = kind === 'plural';
  let text: string;

  const owner = parts.owner ? `${parts.owner.text}'s` : '';

  if (parts.num) {
    plural = plural || parts.num.id !== 'one';
    const more = parts.det?.id === 'more' ? 'more' : '';
    text = join(parts.num.text, more, mods, nounText(parts.noun, parts.num.id !== 'one'));
  } else if (parts.det) {
    const id = parts.det.id;
    const many = PLURAL_DETERMINERS.has(id) && isCountable(word) && kind !== 'unique';
    plural = plural || many;
    const noun = nounText(parts.noun, many);
    const possessive = parts.poss?.text ?? '';
    if (id === 'a') text = withArticle(join(mods, noun));
    else if (id === 'all') text = join('all', possessive || 'the', mods, noun);
    else if (id === 'a-lot') text = join('a lot of', possessive, mods, noun);
    else if (id === 'other') text = join(possessive || 'the', 'other', mods, noun);
    else if (id === 'a-little') text = join('a little', mods, noun);
    else text = join(parts.det.text, possessive, mods, noun);
  } else if (parts.dem) {
    const many = parts.dem.id === 'these' || parts.dem.id === 'those';
    plural = plural || many;
    text = join(parts.dem.text, mods, nounText(parts.noun, many));
  } else if (parts.poss) {
    text = join(parts.poss.text, mods, parts.noun.text);
  } else if (owner) {
    text = join(owner, mods, parts.noun.text);
  } else {
    text = defaultDeterminer(parts.noun, kind, mods, context);
    if (context === 'generic' && isCountable(word) && kind === 'count' && !word?.mine) plural = true;
  }

  return { text, person: plural ? 'plural' : 'third', head: word };
}

function defaultDeterminer(noun: Tok, kind: string, mods: string, context: NounContext): string {
  const word = noun.w;
  const join = (...pieces: string[]) => pieces.filter(Boolean).join(' ');
  const plain = join(mods, noun.text);
  if (kind === 'proper' || context === 'bare') return plain;
  if (word?.mine) return join('my', plain);
  if (kind === 'bare') return plain;
  if (kind === 'unique') return join('the', plain);

  switch (context) {
    case 'generic':
      // "I like cookies", "I like milk"
      return kind === 'count' ? join(mods, pluralize(noun.text, word?.plural)) : plain;
    case 'specific':
      // "I want a cookie", "I want some milk", "I want some grapes"
      return kind === 'count' ? withArticle(plain) : join('some', plain);
    case 'negative':
    case 'predicate':
    case 'with':
      // "I don't want a cookie", "It is a dog", "with a spoon"; mass and plural stay bare
      return kind === 'count' ? withArticle(plain) : plain;
    case 'subject':
    case 'location':
      return join('the', plain);
    default:
      return plain;
  }
}

/** Prepositions for being somewhere, where "at" would sound wrong. */
const AT_PREPOSITION: Record<string, string> = {
  bathroom: 'in',
  bedroom: 'in',
  kitchen: 'in',
  'living-room': 'in',
  room: 'in',
  car: 'in',
  classroom: 'in',
  office: 'in',
  garden: 'in',
  yard: 'in',
  bed: 'in',
  house: 'in',
  town: 'in',
  class: 'in',
  bus: 'on',
  toilet: 'on',
};

function placeNoun(noun: Tok, mods: string): { kind: string; text: string } {
  const word = noun.w;
  const text = [mods, noun.text].filter(Boolean).join(' ');
  if (noun.cat === 'TXT') return { kind: 'to', text };
  if (word?.place) return { kind: word.place, text };
  if (word?.noun === 'proper') return { kind: 'to', text };
  if (word?.mine) return { kind: 'my', text };
  if (word?.noun === 'bare') return { kind: 'to', text };
  return { kind: 'the', text };
}

/** Destination after a motion verb: "to the park", "to school", "home", "to my room", "to Grandma". */
export function destination(parts: NounPhraseParts): string {
  if (parts.det || parts.dem || parts.poss || parts.num || parts.owner) {
    return `to ${renderNounPhrase(parts, 'location').text}`;
  }
  const { kind, text } = placeNoun(parts.noun, parts.mods.join(' '));
  switch (kind) {
    case 'bare':
      return text;
    case 'to':
      return `to ${text}`;
    case 'a':
      return `to ${withArticle(text)}`;
    case 'my':
      return `to my ${text}`;
    default:
      return `to the ${text}`;
  }
}

/** Being somewhere: "at the park", "at school", "home", "in my room", "in the car". */
export function location(parts: NounPhraseParts): string {
  const preposition = AT_PREPOSITION[parts.noun.id] ?? 'at';
  if (parts.det || parts.dem || parts.poss || parts.num || parts.owner) {
    return `${preposition} ${renderNounPhrase(parts, 'location').text}`;
  }
  const { kind, text } = placeNoun(parts.noun, parts.mods.join(' '));
  switch (kind) {
    case 'bare':
      return text;
    case 'to':
      return `${preposition} ${text}`;
    case 'a':
      return `${preposition} ${withArticle(text)}`;
    case 'my':
      return `${preposition} my ${text}`;
    default:
      return `${preposition} the ${text}`;
  }
}

export function isPlace(tok: Tok | undefined): boolean {
  return !!tok && tok.cat === 'N' && !!tok.w?.place;
}

/** Subject pronoun -> object pronoun ("help I" -> "help me"). */
const OBJECT_FORMS: Record<string, string> = { i: 'me', he: 'him', she: 'her', we: 'us', they: 'them' };
/** Object pronoun -> subject pronoun ("me want" -> "I want"). */
const SUBJECT_FORMS: Record<string, string> = { me: 'I', him: 'he', her: 'she', us: 'we', them: 'they' };

export function objectPronoun(tok: Tok): string {
  return OBJECT_FORMS[tok.id] ?? tok.text;
}

export function subjectPronoun(tok: Tok): string {
  return SUBJECT_FORMS[tok.id] ?? tok.text;
}

export function personOfPronoun(id: string): Person {
  if (id === 'i' || id === 'me') return 'i';
  if (id === 'you') return 'you';
  if (id === 'we' || id === 'us' || id === 'they' || id === 'them' || id === 'these' || id === 'those') return 'plural';
  return 'third';
}
