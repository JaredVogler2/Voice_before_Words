import type { Word } from '../vocab/types';
import {
  beForm,
  capitalize,
  contractPair,
  doForm,
  negate,
  pastTense,
  presentParticiple,
  thirdPerson,
  type Person,
} from './morphology';
import {
  destination,
  isPlace,
  location,
  objectPronoun,
  personOfPronoun,
  readNounPhrase,
  renderNounPhrase,
  subjectPronoun,
  type Cat,
  type NounContext,
  type Tok,
} from './nounPhrase';
import {
  DEFAULT_LANGUAGE_OPTIONS,
  type LanguageOptions,
  type Suggestion,
  type SuggestionKind,
  type Token,
} from './types';

/**
 * The on-device sentence engine.
 *
 * Input is the sequence of symbols someone chose ("I · go · bathroom"). Output
 * is a short list of complete sentences that sequence could mean ("I need to go
 * to the bathroom.", "I'm going to the bathroom.", "I went to the bathroom.",
 * "Can I go to the bathroom?"), each tagged with what kind of reading it is.
 *
 * Two rules shape everything here:
 *
 * 1. Never add meaning. The engine supplies grammar (articles, "to", agreement,
 *    tense, word order) and offers alternative readings, but it does not invent
 *    content words. When it cannot read the input it returns nothing, and the
 *    person still has their exact words.
 * 2. The person chooses. Nothing here is ever spoken automatically; every
 *    sentence is a suggestion that must be picked.
 *
 * It runs with no network and no model, so it is also what the app falls back
 * to whenever an AI provider is slow, offline or not configured.
 */

// ───────────────────────────────────────────────────────── classification ──

const DEMONSTRATIVES = new Set(['this', 'that', 'these', 'those']);

/**
 * Verbs that are just as often things: "my turn", "a break", "more hugs".
 * After a determiner they are read as nouns (`true` marks the uncountable ones).
 */
const VERBS_AS_NOUNS: Record<string, boolean> = {
  turn: false, break: false, hug: false, kiss: false, drink: false, walk: false, ride: false, rest: false,
  call: false, text: false, look: false, try: false, cut: false, fall: false, wash: false, smile: false,
  laugh: false, cry: false, answer: false, wish: false, taste: false, smell: false, start: false,
  visit: false, change: false, talk: false, dance: false, swim: false, jump: false, kick: false,
  throw: false, catch: false, win: false, tickle: false, push: false, help: true, work: true, sleep: true,
  hope: true, play: true,
};

export function classify(tokens: Token[]): Tok[] {
  const toks = tokens.map((token, index): Tok => {
    const word = token.word;
    let cat: Cat = 'TXT';
    if (word) {
      switch (word.pos) {
        case 'pronoun': {
          const next = tokens[index + 1]?.word;
          if (DEMONSTRATIVES.has(word.id)) cat = 'DEM';
          else if (word.id === 'mine' || word.id === 'yours') cat = 'MINE';
          else if (word.id === 'her') cat = next && (next.pos === 'noun' || next.pos === 'adj') ? 'POSS' : 'OBJ';
          else if (word.subject) cat = 'SUBJ';
          else if (word.possessive) cat = 'POSS';
          else cat = 'OBJ';
          break;
        }
        case 'noun':
          cat = 'N';
          break;
        case 'verb':
          cat = 'V';
          break;
        case 'adj':
          cat = 'ADJ';
          break;
        case 'adv':
          cat = word.degree ? 'DEG' : word.group === 'time' ? 'TIME' : 'ADV';
          break;
        case 'prep':
          cat = 'P';
          break;
        case 'det':
          cat = 'DET';
          break;
        case 'conj':
          cat = 'CONJ';
          break;
        case 'question':
          cat = word.id === 'question-mark' ? 'QM' : 'Q';
          break;
        case 'neg':
          cat = 'NEG';
          break;
        case 'aux':
          cat = 'AUX';
          break;
        case 'num':
          cat = 'NUM';
          break;
        case 'social':
          cat = 'SOC';
          break;
        case 'phrase':
          cat = 'PHR';
          break;
      }
    }
    return { id: word?.id ?? token.id, text: token.text, w: word, cat };
  });
  // "you okay", "I not okay": after a subject, "okay" describes how someone is.
  for (let i = 1; i < toks.length; i++) {
    const before = toks[i - 1];
    if (toks[i].id === 'okay' && ['SUBJ', 'N', 'NEG', 'DEG', 'AUX', 'TXT'].includes(before.cat)) {
      toks[i] = { ...toks[i], cat: 'ADJ', w: { ...toks[i].w!, pos: 'adj', feeling: true } };
    }
  }
  // The "all done" tile after "all" would say it twice.
  for (let i = toks.length - 2; i >= 0; i--) {
    if (toks[i].id === 'all' && toks[i + 1].id === 'done') toks.splice(i, 1);
  }
  // "my turn", "a break", "two hugs": a verb straight after a determiner is a thing.
  for (let i = 1; i < toks.length; i++) {
    const tok = toks[i];
    const before = toks[i - 1];
    if (tok.cat !== 'V' || !(tok.id in VERBS_AS_NOUNS)) continue;
    if (before.cat !== 'POSS' && before.cat !== 'DET' && before.cat !== 'NUM') continue;
    tok.cat = 'N';
    tok.w = {
      id: tok.id,
      label: tok.text,
      text: tok.text,
      pos: 'noun',
      group: 'things',
      noun: VERBS_AS_NOUNS[tok.id] ? 'mass' : 'count',
    };
  }
  return toks;
}

// ───────────────────────────────────────────────────────────────── output ──

type End = '.' | '?' | '!';

interface Variant {
  kind: SuggestionKind;
  text: string;
  end: End;
}

function tidy(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/\bi\b/g, 'I')
    .trim();
}

function finish(text: string, end: End): string {
  const clean = tidy(text);
  if (!clean) return '';
  return capitalize(clean) + (/[.!?…]$/.test(clean) ? '' : end);
}

/** Exactly the chosen words, capitalised and punctuated. Always available. */
export function literal(tokens: Token[]): string {
  const asked = tokens.some((token) => token.word?.id === 'question-mark') || tokens[0]?.word?.pos === 'question';
  const parts = tokens
    .filter((token) => token.word?.id !== 'question-mark')
    .map((token) => token.text.trim())
    .filter(Boolean);
  if (parts.length === 0) return '';
  const joined = parts.join(' ').replace(/([.!?])\s+([a-z])/g, (_, mark: string, letter: string) => `${mark} ${letter.toUpperCase()}`);
  return finish(joined, asked ? '?' : '.');
}

// ─────────────────────────────────────────────────────────────── realiser ──

interface ClauseSpec {
  /** null makes an imperative. */
  subj: string | null;
  person: Person;
  /** The subject is a pronoun, so "I'm" / "she's" are available. */
  pronoun?: boolean;
  /** Base form of the main verb. Leave out for "be". */
  verb?: string;
  after?: string;
  modal?: string;
  tense?: 'present' | 'past' | 'future';
  progressive?: boolean;
  negative?: boolean;
  /** Adverbs that sit before the main verb: always, never, still ... */
  mid?: string[];
  mood?: 'statement' | 'yesno' | 'wh' | 'imperative';
  wh?: string;
  /** The question word is itself the subject: "Who wants a cookie?" */
  whSubject?: boolean;
}

function realize(spec: ClauseSpec, contractions: boolean): string {
  const tense = spec.tense ?? 'present';
  const past = tense === 'past';
  const after = spec.after ? ` ${spec.after}` : '';
  const mid = spec.mid?.length ? ` ${spec.mid.join(' ')}` : '';
  const mood = spec.mood ?? (spec.subj === null ? 'imperative' : 'statement');

  if (mood === 'imperative') {
    const base = spec.verb ?? 'be';
    if (spec.negative) return `${negate('do', contractions)}${mid} ${base}${after}`;
    return `${mid.trim()} ${base}${after}`;
  }

  const subj = spec.subj ?? '';
  const person: Person = mood === 'wh' && spec.whSubject ? 'third' : spec.person;

  // The auxiliary carries tense and agreement; `main` is what follows it.
  let aux: string | null;
  let main: string;
  if (spec.modal || tense === 'future') {
    aux = spec.modal ?? 'will';
    main = spec.verb ? (spec.progressive ? `be ${presentParticiple(spec.verb)}` : spec.verb) : 'be';
  } else if (!spec.verb) {
    aux = beForm(person, past);
    main = '';
  } else if (spec.progressive) {
    aux = beForm(person, past);
    main = presentParticiple(spec.verb);
  } else if (spec.negative || mood === 'yesno' || (mood === 'wh' && !spec.whSubject)) {
    aux = doForm(person, past);
    main = spec.verb;
  } else {
    aux = null;
    main = past ? pastTense(spec.verb) : person === 'third' ? thirdPerson(spec.verb) : spec.verb;
  }

  const tail = `${main ? ` ${main}` : ''}${after}`;
  const isBe = aux === 'am' || aux === 'is' || aux === 'are';

  if (mood === 'statement') {
    if (aux === null) return `${subj}${mid} ${main}${after}`;
    if (spec.negative) {
      // "I'm not", "she's not" with a pronoun; otherwise "isn't", "don't", "can't".
      if (isBe && spec.pronoun && contractions) {
        const pair = contractPair(subj, aux);
        if (pair) return `${pair} not${mid}${tail}`;
      }
      if (aux === 'am') return `${subj} am not${mid}${tail}`;
      return `${subj} ${negate(aux, contractions)}${mid}${tail}`;
    }
    // Never contract at the very end ("Yes, I am." not "Yes, I'm.").
    if (contractions && spec.pronoun && (isBe || aux === 'will') && (mid + tail).trim()) {
      const pair = contractPair(subj, aux);
      if (pair) return `${pair}${mid}${tail}`;
    }
    return `${subj} ${aux}${mid}${tail}`;
  }

  // Questions always have an auxiliary (do-support was added above).
  const helper = aux ?? doForm(person, past);

  if (mood === 'yesno') {
    if (spec.negative && helper === 'am') return `am ${subj} not${mid}${tail}`;
    const lead = spec.negative ? negate(helper, contractions) : helper;
    return `${lead} ${subj}${mid}${tail}`;
  }

  const wh = spec.wh ?? 'what';
  if (spec.whSubject) {
    if (aux === null) return `${wh}${mid} ${main}${after}`;
    if (!spec.negative && contractions && aux === 'is' && tail.trim()) {
      const pair = contractPair(wh, 'is');
      if (pair) return `${pair}${mid}${tail}`;
    }
    return `${wh} ${spec.negative ? negate(aux, contractions) : aux}${mid}${tail}`;
  }
  // "What's that?" and "Where's Mom?" are natural; "Where's it?" is not.
  const shortSubject = ['it', 'he', 'she'].includes(subj.toLowerCase());
  if (!spec.negative && contractions && helper === 'is' && !shortSubject) {
    const pair = contractPair(wh, 'is');
    if (pair) return `${pair} ${subj}${mid}${tail}`;
  }
  return `${wh} ${spec.negative ? negate(helper, contractions) : helper} ${subj}${mid}${tail}`;
}

// ─────────────────────────────────────────────────────────── verb tables ──

// A second verb is joined with "to" (want to go, try to sleep) unless the first verb is listed below.

/** Verbs followed by "-ing": stop running, finish eating. */
const GERUND_VERBS = new Set(['stop', 'finish', 'practice', 'keep']);
/** Verbs followed by a bare verb: go play, come see, help carry. */
const BARE_VERBS = new Set(['go', 'come', 'help', 'let', 'make']);
/** Verbs that take a person and then a thing: give Mom a cookie. */
const TWO_OBJECT_VERBS = new Set(['give', 'show', 'tell', 'bring', 'send', 'get', 'make', 'buy', 'read', 'ask']);
/** Objects of these get "some": I want some water. */
const SOME_VERBS = new Set([
  'want', 'need', 'have', 'get', 'give', 'bring', 'buy', 'make', 'take', 'eat', 'drink', 'cook',
]);
/** Objects of these are general: I like cookies. */
const GENERIC_VERBS = new Set(['like', 'love', 'hate']);
/** Used on their own, these usually report something that already happened. */
const PAST_BY_DEFAULT = new Set(['forget', 'fall', 'break', 'lose', 'find', 'win', 'happen', 'throw-up', 'finish']);
/** Things can do these, so a noun in front is a subject: "tummy hurt", "bus come". */
const THING_SUBJECT_VERBS = new Set([
  'hurt', 'fall', 'break', 'happen', 'come', 'go', 'start', 'finish', 'stop', 'open', 'close', 'work',
  'smell', 'taste', 'move', 'leave', 'stay',
]);
/** After want/need these read as a thing: "need break" -> "I need a break". */
const NOUN_AFTER_WANT: Record<string, string> = {
  break: 'a break',
  hug: 'a hug',
  kiss: 'a kiss',
  turn: 'a turn',
  help: 'help',
  drink: 'a drink',
  rest: 'a rest',
  change: 'a change',
};
/** Verbs that need a preposition before their object: listen to music, look at this, wait for Mom. */
const VERB_PREPOSITION: Record<string, string> = { listen: 'to', look: 'at', wait: 'for', talk: 'to' };
/** Verb + noun pairs that take no article: watch TV. */
const BARE_OBJECTS = new Set(['watch tv', 'play music', 'eat breakfast', 'eat lunch', 'eat dinner']);
/** States that make no sense without an object: "have" -> "I have it." */
const NEEDS_OBJECT = new Set(['have', 'see', 'hear', 'miss', 'mean', 'believe']);
/** Filed with the states, but they are events: "It is falling", never "It falls". */
const EVENT_VERBS = new Set(['fall', 'break', 'happen']);
/** Feelings that are about something: scared of the dog, mad at you, worried about school. */
const FEELING_PREPOSITION: Record<string, string> = {
  scared: 'of', proud: 'of', tired: 'of', angry: 'at', mad: 'at', upset: 'about', worried: 'about',
  excited: 'about', nervous: 'about', confused: 'about', embarrassed: 'about', bored: 'with',
  frustrated: 'with', happy: 'about', sad: 'about',
};
const WEATHER_NOUNS: Record<string, { verb?: string; adjective?: string }> = {
  rain: { verb: 'rain' },
  snow: { verb: 'snow' },
  sun: { adjective: 'sunny' },
  wind: { adjective: 'windy' },
  cloud: { adjective: 'cloudy' },
};
const POSSESSIVE_OF: Record<string, string> = { i: 'my', you: 'your', he: 'his', she: 'her', we: 'our', they: 'their', it: 'its' };

/** Good candidates for "Let's ...". */
const TOGETHER_VERBS = new Set([
  'play', 'go', 'eat', 'dance', 'sing', 'read', 'watch', 'swim', 'walk', 'run', 'draw', 'paint', 'cook',
  'build', 'celebrate', 'start', 'ride', 'hide', 'jump', 'leave', 'talk', 'pray', 'practice',
]);
/** Adverbs that sit before the main verb. */
const MID_ADVERBS = new Set(['always', 'never', 'sometimes', 'still', 'already', 'also', 'just', 'only', 'almost']);
/** Time words that read best at the end of the sentence. */
const END_TIMES = new Set(['now', 'later', 'soon', 'today', 'tomorrow', 'yesterday', 'tonight', 'again']);
/** Adjectives that describe the speaker when used alone: "done" -> "I'm all done." */
const SELF_ADJECTIVES = new Set([
  'done', 'finished', 'ready', 'lost', 'stuck', 'busy', 'late', 'early', 'free', 'sore', 'hot', 'cold',
  'wet', 'dirty', 'full',
]);
const WEATHER_ADJECTIVES = new Set(['sunny', 'rainy', 'snowy', 'windy', 'cloudy']);
/** Prepositions whose object is general rather than "the": with milk, for a friend. */
const WITH_PREPOSITIONS = new Set(['with', 'for', 'about', 'of', 'without']);
const DAY_NAMES = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);
const TIME_NOUN_PREPOSITION: Record<string, string> = {
  morning: 'in the morning',
  afternoon: 'in the afternoon',
  evening: 'in the evening',
  night: 'at night',
  weekend: 'on the weekend',
};

// ──────────────────────────────────────────────────────────────── parsing ──

interface Subject {
  text: string;
  person: Person;
  pronoun: boolean;
  id?: string;
  head?: Word;
  implied?: boolean;
}

interface Parse {
  wh?: Tok;
  ask: boolean;
  maybe: boolean;
  subject?: Subject;
  /** An auxiliary came first, which makes a yes/no question: "can I go". */
  auxFirst?: string;
  modal?: string;
  copula: boolean;
  negative: boolean;
  mid: string[];
  verbs: Tok[];
  rest: Tok[];
  /** Adverbs that belong after the object: "very much", "so much". */
  ends: string[];
  /** Time phrases moved to the end, already rendered. */
  times: string[];
  tense?: 'past' | 'future' | 'now';
}

const IMPLIED_I: Subject = { text: 'I', person: 'i', pronoun: true, id: 'i', implied: true };

function isPredicateStart(tok: Tok | undefined): boolean {
  if (!tok) return false;
  return ['V', 'ADJ', 'NEG', 'AUX', 'DEG', 'MINE'].includes(tok.cat) || MID_ADVERBS.has(tok.id);
}

function isNominal(tok: Tok): boolean {
  return ['N', 'ADJ', 'DET', 'NUM', 'POSS', 'DEM', 'TXT', 'DEG'].includes(tok.cat);
}

/** Pull out time words so they can go to the end, and note any tense they imply. */
function extractTimes(toks: Tok[], parse: Parse): Tok[] {
  const kept: Tok[] = [];
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    const next = toks[i + 1];
    const nextIsTimeNoun = next?.cat === 'N' && next.w?.group === 'time';
    // "last night", "next week", "this morning"
    if ((tok.id === 'last' || tok.id === 'next' || tok.id === 'this') && nextIsTimeNoun) {
      parse.times.push(`${tok.text} ${next.text}`);
      if (tok.id === 'last') parse.tense = parse.tense ?? 'past';
      if (tok.id === 'next') parse.tense = parse.tense ?? 'future';
      i++;
      continue;
    }
    if (tok.cat === 'TIME' && END_TIMES.has(tok.id)) {
      parse.times.push(tok.text);
      if (tok.w?.tense) parse.tense = parse.tense ?? tok.w.tense;
      continue;
    }
    // A day or part of the day after other words: "go school monday" -> "on Monday".
    // Only once something else has been said, so "morning" alone stays a plain word.
    if (tok.cat === 'N' && i > 0 && kept.length > 0 && toks[i - 1].cat !== 'P' && toks[i - 1].cat !== 'DET' && toks[i - 1].cat !== 'DEM') {
      if (DAY_NAMES.has(tok.id)) {
        parse.times.push(`on ${tok.text}`);
        continue;
      }
      const phrase = TIME_NOUN_PREPOSITION[tok.id];
      if (phrase && i === toks.length - 1) {
        parse.times.push(phrase);
        continue;
      }
    }
    kept.push(tok);
  }
  return kept;
}

interface SubjectUnit {
  text: string;
  person: Person;
  pronoun: boolean;
  id: string;
  head?: Word;
  end: number;
  /** A person, an animal or a name: can do anything. */
  animate: boolean;
  /** Has its own determiner ("my tummy", "the dog", "that cookie"). */
  marked: boolean;
  /** Only a subject when something that looks like a predicate follows. */
  needsPredicate: boolean;
}

function readSubjectUnit(toks: Tok[], start: number): SubjectUnit | null {
  const tok = toks[start];
  if (!tok) return null;
  if (tok.cat === 'SUBJ') {
    return { text: tok.text, person: personOfPronoun(tok.id), pronoun: true, id: tok.id, end: start + 1, animate: true, marked: true, needsPredicate: false };
  }
  // "me want", "him go"
  if (tok.cat === 'OBJ') {
    const text = subjectPronoun(tok);
    return { text, person: personOfPronoun(tok.id), pronoun: true, id: text.toLowerCase(), end: start + 1, animate: true, marked: true, needsPredicate: true };
  }
  // "that funny", "this mine" (but "that big dog" is a noun phrase)
  if (tok.cat === 'DEM' && !readNounPhrase(toks, start)) {
    return { text: tok.text, person: personOfPronoun(tok.id), pronoun: true, id: tok.id, end: start + 1, animate: false, marked: true, needsPredicate: true };
  }
  const phrase = readNounPhrase(toks, start);
  if (!phrase) return null;
  const { parts, end } = phrase;
  const head = parts.noun;
  const rendered = renderNounPhrase(parts, 'subject');
  return {
    text: rendered.text,
    person: rendered.person,
    pronoun: false,
    id: head.id,
    head: head.w,
    end,
    animate: head.cat === 'TXT' || !!head.w?.person || head.w?.group === 'animals' || head.w?.noun === 'proper',
    marked: !!(parts.det || parts.poss || parts.dem || parts.num),
    needsPredicate: true,
  };
}

function readSubject(toks: Tok[], start: number): { subject: Subject; end: number } | null {
  const first = readSubjectUnit(toks, start);
  if (!first) return null;
  const units = [first];
  let end = first.end;
  // "mom and dad", "mom dad", "you and me"
  for (;;) {
    const tok = toks[end];
    const last = units[units.length - 1];
    let from = -1;
    if (tok?.cat === 'CONJ' && tok.id === 'and') from = end + 1;
    else if (tok?.cat === 'N' && tok.w?.person && last.animate && !last.pronoun) from = end;
    if (from < 0) break;
    const more = readSubjectUnit(toks, from);
    if (!more) break;
    units.push(more);
    end = more.end;
  }

  const after = toks[end];
  const afterNext = toks[end + 1];
  const compound = units.length > 1;
  const animate = units.every((unit) => unit.animate);
  const marked = units.some((unit) => unit.marked);

  let isSubject: boolean;
  if (!compound && !first.needsPredicate) {
    isSubject = true;
  } else if (first.pronoun && !compound) {
    isSubject = isPredicateStart(after) || (first.id !== 'i' && first.id !== 'he' && first.id !== 'she' && first.id !== 'we' && first.id !== 'they' && (after?.cat === 'POSS' || after?.cat === 'ADV'));
  } else if (animate || marked) {
    isSubject =
      isPredicateStart(after) ||
      (animate && (after?.cat === 'ADV' || after?.cat === 'P' || isPlace(after))) ||
      (marked && after?.cat === 'ADV');
  } else {
    // A bare thing is a subject only in front of a description or a verb things can do.
    isSubject =
      !!after &&
      (after.cat === 'ADJ' ||
        after.cat === 'DEG' ||
        after.cat === 'AUX' ||
        (after.cat === 'NEG' && (afterNext?.cat === 'ADJ' || afterNext?.cat === 'V')) ||
        (after.cat === 'V' && THING_SUBJECT_VERBS.has(after.id)));
  }
  if (!isSubject) return null;

  if (!compound) {
    return {
      subject: { text: first.text, person: first.person, pronoun: first.pronoun, id: first.id, head: first.head },
      end,
    };
  }
  const names = units.map((unit) => unit.text);
  const text = `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return { subject: { text, person: 'plural', pronoun: false }, end };
}

function parseClause(input: Tok[]): Parse {
  const parse: Parse = { ask: false, maybe: false, copula: false, negative: false, mid: [], verbs: [], rest: [], ends: [], times: [] };

  let toks = input.filter((tok) => {
    if (tok.cat === 'QM') {
      parse.ask = true;
      return false;
    }
    if (tok.id === 'maybe') {
      parse.maybe = true;
      return false;
    }
    return true;
  });

  if (toks[0]?.cat === 'Q') {
    parse.wh = toks[0];
    toks = toks.slice(1);
    // "how" + "many" chosen as two tiles
    if (parse.wh.id === 'how' && toks[0]?.id === 'many') {
      parse.wh = { id: 'how-many', text: 'how many', cat: 'Q' };
      toks = toks.slice(1);
    }
  }

  toks = extractTimes(toks, parse);

  let i = 0;
  // An auxiliary in front asks a question: "can I go", "do you like", "is mom home".
  const first = toks[0];
  if (first?.cat === 'AUX') {
    const second = toks[1];
    const subjectFollows = !!second && ['SUBJ', 'N', 'DEM', 'POSS', 'TXT', 'DET'].includes(second.cat);
    if (first.id !== 'do' || subjectFollows) {
      parse.auxFirst = first.id;
      i = 1;
    }
  }

  const found = readSubject(toks, i);
  if (found) {
    parse.subject = found.subject;
    i = found.end;
  }

  // Negation, auxiliaries and adverbs before the verb.
  while (i < toks.length) {
    const tok = toks[i];
    if (tok.cat === 'NEG') {
      parse.negative = true;
      i++;
      continue;
    }
    if (tok.cat === 'AUX') {
      if (tok.id === 'is') {
        parse.copula = true;
        i++;
        continue;
      }
      if (tok.id === 'do') {
        const next = toks[i + 1];
        if (next && (next.cat === 'NEG' || next.cat === 'V')) {
          i++;
          continue;
        }
        break; // "do" is the main verb here
      }
      parse.modal = tok.id;
      i++;
      continue;
    }
    if (MID_ADVERBS.has(tok.id)) {
      parse.mid.push(tok.text);
      if (tok.w?.tense) parse.tense = parse.tense ?? tok.w.tense;
      i++;
      continue;
    }
    // "I really like", "I so much love mom" -> "I love Mom so much"
    const upcoming = toks[i + 1];
    if (tok.cat === 'DEG' && upcoming && (upcoming.cat === 'V' || upcoming.cat === 'NEG')) {
      if (tok.id === 'really') parse.mid.push('really');
      else if (tok.id === 'very') parse.ends.push('very much');
      else parse.ends.push(tok.text);
      i++;
      continue;
    }
    break;
  }

  const isVerb = (tok: Tok | undefined) => !!tok && (tok.cat === 'V' || (tok.cat === 'AUX' && tok.id === 'do'));

  let verbAt = -1;
  if (isVerb(toks[i])) verbAt = i;
  else if (!parse.copula) {
    // Object first: "cookie want", "I juice drink".
    for (let j = i; j < toks.length; j++) {
      if (isVerb(toks[j])) {
        verbAt = j;
        break;
      }
      if (!isNominal(toks[j])) break;
    }
  }

  if (verbAt >= 0) {
    const fronted = toks.slice(i, verbAt);
    let j = verbAt;
    parse.verbs.push(toks[j++]);
    for (;;) {
      if (toks[j]?.cat === 'V') parse.verbs.push(toks[j++]);
      else if (toks[j]?.cat === 'P' && toks[j].id === 'to' && toks[j + 1]?.cat === 'V') {
        parse.verbs.push(toks[j + 1]);
        j += 2;
      } else break;
    }
    parse.rest = [...fronted, ...toks.slice(j)];
  } else {
    parse.rest = toks.slice(i);
  }
  return parse;
}

// ──────────────────────────────────────────────────────────── complements ──

interface Complements {
  text: string;
  /** Number of noun phrases / pronouns that act as objects. */
  objects: number;
  /** A destination was found for a motion verb. */
  place?: Tok;
  /** A single adjective with nothing else. */
  loneAdjective?: Tok;
}

function objectContext(governor: Tok | undefined, negative: boolean): NounContext {
  if (negative) return 'negative';
  if (!governor) return 'specific';
  if (GENERIC_VERBS.has(governor.id)) return 'generic';
  if (SOME_VERBS.has(governor.id)) return 'specific';
  return 'predicate';
}

function renderComplements(rest: Tok[], governor: Tok | undefined, negative: boolean): Complements {
  const out: string[] = [];
  const result: Complements = { text: '', objects: 0 };
  const context = objectContext(governor, negative);
  const motion = governor?.w?.verb === 'motion';
  // "listen music" -> "listen to music", "look this" -> "look at this", "talk mom" -> "talk to Mom"
  const linker = governor ? VERB_PREPOSITION[governor.id] : undefined;
  let lastWasPhrase = false;
  let i = 0;

  let recipient = false;
  // "pain head" -> "pain in my head"
  let painBefore = false;
  let bodyNext = false;
  const pushPhrase = (text: string, isPerson = false) => {
    // "give mom cookie" is a person and a thing, not a list
    const secondObject = recipient && result.objects === 1 && !!governor && TWO_OBJECT_VERBS.has(governor.id);
    if (lastWasPhrase && painBefore && bodyNext) out.push('in');
    else if (lastWasPhrase && !secondObject) out.push('and');
    if (result.objects === 0) recipient = isPerson;
    out.push(text);
    lastWasPhrase = true;
    result.objects++;
  };

  while (i < rest.length) {
    const tok = rest[i];
    const phrase = readNounPhrase(rest, i);
    if (phrase) {
      const { parts } = phrase;
      let end = phrase.end;
      const head = parts.noun;
      // "mom car" -> "Mom's car" (but "give mom cookie" keeps two objects)
      const bare = !parts.det && !parts.poss && !parts.dem && !parts.num && parts.mods.length === 0;
      const owned = readNounPhrase(rest, end);
      if (
        bare &&
        owned &&
        (head.w?.noun === 'proper' || head.cat === 'TXT') &&
        head.w?.group !== 'places' &&
        !owned.parts.noun.w?.person &&
        !owned.parts.det &&
        !owned.parts.poss &&
        !owned.parts.dem &&
        !owned.parts.num &&
        !(governor && TWO_OBJECT_VERBS.has(governor.id)) &&
        !motion
      ) {
        owned.parts.owner = head;
        pushPhrase(renderNounPhrase(owned.parts, context).text);
        i = owned.end;
        continue;
      }
      const goesTo = motion && result.objects === 0 && !lastWasPhrase;
      if (goesTo) {
        out.push(destination(parts));
        result.place = head;
        lastWasPhrase = true;
        result.objects++;
      } else if (linker && result.objects === 0) {
        pushPhrase(`${linker} ${renderNounPhrase(parts, linker === 'to' && !head.w?.person ? 'predicate' : 'location').text}`);
      } else if (governor?.id === 'play' && result.objects === 0 && head.w?.person) {
        pushPhrase(`with ${renderNounPhrase(parts, 'location').text}`);
      } else if (governor && bare && BARE_OBJECTS.has(`${governor.id} ${head.id}`)) {
        pushPhrase(head.text);
      } else {
        bodyNext = !!head.w?.body;
        pushPhrase(renderNounPhrase(parts, context).text, !!head.w?.person || head.cat === 'TXT');
      }
      painBefore = head.w?.group === 'body' && !head.w.body;
      i = end;
      continue;
    }

    // "give me cookie": the pronoun is the recipient
    const wasPhrase = lastWasPhrase;
    lastWasPhrase = false;
    const next = rest[i + 1];
    switch (tok.cat) {
      case 'SUBJ':
      case 'OBJ':
        if (wasPhrase) out.push('and');
        out.push(linker && result.objects === 0 ? `${linker} ${objectPronoun(tok)}` : objectPronoun(tok));
        if (result.objects === 0) recipient = true;
        lastWasPhrase = true;
        result.objects++;
        break;
      case 'DEM':
        out.push(linker && result.objects === 0 ? `${linker} ${tok.text}` : tok.text);
        result.objects++;
        break;
      case 'MINE':
      case 'POSS':
        out.push(tok.text);
        result.objects++;
        break;
      case 'DEG':
        if (next?.cat === 'ADJ') {
          out.push(`${tok.text} ${next.text}`);
          if (rest.length === 2) result.loneAdjective = next;
          i++;
        } else out.push(tok.id === 'very' ? 'very much' : tok.text);
        break;
      case 'ADJ': {
        // An adjective with no noun after a verb that takes a thing: "want big" -> "the big one".
        const takesThing = governor && !['feel', 'state'].includes(governor.w?.verb ?? '') && governor.id !== 'do';
        const isObjectVerb = governor && (SOME_VERBS.has(governor.id) || GENERIC_VERBS.has(governor.id) || governor.id === 'see');
        if (rest.length === 1) result.loneAdjective = tok;
        if (takesThing && isObjectVerb && !tok.w?.feeling) {
          out.push(`the ${tok.text} one`);
          result.objects++;
        } else out.push(tok.text);
        break;
      }
      case 'DET':
        if (tok.id === 'all') out.push('all of it');
        else if (tok.id === 'another') out.push('another one');
        else if (tok.id === 'a' || tok.id === 'the') out.push(tok.text);
        else out.push(tok.text);
        if (tok.id !== 'a' && tok.id !== 'the') result.objects++;
        break;
      case 'NUM':
        out.push(tok.text);
        result.objects++;
        break;
      case 'P': {
        const target = readNounPhrase(rest, i + 1);
        if (target) {
          const noun = target.parts.noun;
          const plain = !target.parts.det && !target.parts.poss && !target.parts.dem && !target.parts.num;
          if (tok.id === 'to') {
            out.push(destination(target.parts));
            result.place = noun;
          } else if ((tok.id === 'at' || tok.id === 'in') && plain && noun.w?.place) {
            const where = location(target.parts);
            // keep the preposition the person chose when the place takes one
            out.push(/^(at|in|on) /.test(where) ? where.replace(/^(at|in|on) /, `${tok.text} `) : `${tok.text} ${where}`);
          } else {
            const ctx: NounContext = WITH_PREPOSITIONS.has(tok.id) ? 'with' : 'location';
            out.push(`${tok.text} ${renderNounPhrase(target.parts, ctx).text}`);
          }
          i = target.end;
          continue;
        }
        if (next && (next.cat === 'SUBJ' || next.cat === 'OBJ' || next.cat === 'DEM' || next.cat === 'MINE')) {
          out.push(`${tok.text} ${objectPronoun(next)}`);
          i += 2;
          continue;
        }
        out.push(tok.text);
        break;
      }
      case 'V':
        out.push(rest[i - 1]?.cat === 'CONJ' ? tok.text : `to ${tok.text}`);
        break;
      case 'NEG':
        out.push('not');
        break;
      default:
        out.push(tok.text);
    }
    i++;
  }
  result.text = out.join(' ');
  return result;
}

/** "want go eat" -> main verb "want", then "to go eat". */
function verbChain(verbs: Tok[]): string {
  const out: string[] = [];
  for (let i = 1; i < verbs.length; i++) {
    const previous = verbs[i - 1].id;
    const verb = verbs[i].text;
    if (GERUND_VERBS.has(previous)) out.push(presentParticiple(verb));
    else if (BARE_VERBS.has(previous)) out.push(verb);
    else out.push(`to ${verb}`);
  }
  return out.join(' ');
}

// ─────────────────────────────────────────────────────────────── variants ──

class Collector {
  private readonly seen = new Set<string>();
  readonly items: Variant[] = [];

  constructor(
    private readonly contractions: boolean,
    private readonly tail: string,
    private readonly lead: string,
  ) {}

  /** Add finished text. */
  text(kind: SuggestionKind, text: string, end: End = '.'): void {
    if (this.lead && (kind === 'ask' || kind === 'tell')) return; // no "Maybe can I go?"
    const body = [this.lead, text, this.tail].filter(Boolean).join(' ');
    const key = tidy(body).toLowerCase();
    if (!key || this.seen.has(key)) return;
    this.seen.add(key);
    this.items.push({ kind, text: body, end });
  }

  clause(kind: SuggestionKind, spec: ClauseSpec, end?: End): void {
    const isQuestion = spec.mood === 'yesno' || spec.mood === 'wh';
    this.text(kind, realize(spec, this.contractions), end ?? (isQuestion ? '?' : '.'));
  }
}

function join(...pieces: (string | undefined | false)[]): string {
  return pieces.filter(Boolean).join(' ');
}

function clauseVariants(toks: Tok[], contractions: boolean, polite: boolean): Variant[] {
  // "me too" is already exactly what it means.
  if (toks.length === 2 && toks[1].id === 'too' && (toks[0].cat === 'OBJ' || toks[0].cat === 'SUBJ')) return [];
  const parse = parseClause(toks);
  // "yes" / "no" in the middle only make sense after a saying verb ("say no"); otherwise leave the words alone.
  const saying = parse.verbs.some((verb) => verb.w?.verb === 'say');
  if (!saying && toks.some((tok) => tok.cat === 'SOC')) return [];
  const times = parse.times.join(' ');
  const please = polite ? ', please' : '';
  const out = new Collector(contractions, '', parse.maybe ? 'maybe' : '');
  const subject = parse.subject ?? IMPLIED_I;
  const implied = !parse.subject;
  const base = { subj: subject.text, person: subject.person, pronoun: subject.pronoun, mid: parse.mid } as const;
  const negative = parse.negative;
  const tense = parse.tense;

  // ── question words ──────────────────────────────────────────────────────
  if (parse.wh) {
    whQuestions(parse, out, times);
    return out.items;
  }

  const main = parse.verbs[0];
  const governor = parse.verbs[parse.verbs.length - 1];

  // ── no verb: descriptions, places, things ───────────────────────────────
  if (!main) {
    verbless(parse, out, times, please);
    return out.items;
  }

  const comps = renderComplements(parse.rest, governor, negative);
  const chain = verbChain(parse.verbs);
  const cls = main.w?.verb ?? 'self';
  const verb = main.text;
  const ends = parse.ends.join(' ');
  const after = join(chain, comps.text, ends, times);
  const isI = subject.person === 'i';
  const isYou = subject.person === 'you';

  // ── explicit question ("?" tile) or auxiliary first ─────────────────────
  if (parse.auxFirst || parse.ask) {
    const aux = parse.auxFirst;
    let who = subject;
    if (implied && aux) {
      // "can help" -> "Can you help?", "can go" -> "Can I go?"
      who = cls === 'other' && comps.objects === 0 ? { text: 'you', person: 'you', pronoun: true, id: 'you' } : IMPLIED_I;
    } else if (implied) {
      who = { text: 'you', person: 'you', pronoun: true, id: 'you' };
    }
    const q: ClauseSpec = {
      subj: who.text,
      person: who.person,
      pronoun: who.pronoun,
      mid: parse.mid,
      verb,
      after,
      negative,
      mood: 'yesno',
    };
    if (aux === 'is') q.progressive = true;
    else if (aux && aux !== 'do') q.modal = aux;
    else if (parse.modal) q.modal = parse.modal;
    else if (tense === 'past') q.tense = 'past';
    else if (tense === 'future') q.tense = 'future';
    else if (cls !== 'want' && cls !== 'state' && cls !== 'feel' && cls !== 'think' && !aux) q.progressive = true;
    out.clause('ask', { ...q, after: after + please });
    if (!q.modal && !q.progressive && q.tense !== 'past') out.clause('ask', { ...q, tense: 'past' });
    out.clause('say', { ...q, mood: 'statement' });
    return out.items;
  }

  // ── subject + can / will / should ... ────────────────────────────────────
  if (parse.modal) {
    const spec: ClauseSpec = { ...base, verb, after, negative, modal: parse.modal };
    out.clause('say', spec);
    if (!negative) out.clause('ask', { ...spec, mood: 'yesno' });
    return out.items;
  }

  // ── "is" + verb: "mom is go" -> "Mom is going." ─────────────────────────
  if (parse.copula) {
    out.clause('now', { ...base, verb, after, negative, progressive: true });
    out.clause('past', { ...base, verb, after, negative, tense: 'past' });
    out.clause('ask', { ...base, verb, after, negative, progressive: true, mood: 'yesno' });
    return out.items;
  }

  const stmt = (extra: Partial<ClauseSpec>): ClauseSpec => ({ ...base, verb, after, negative, ...extra });
  const wanting = (wantVerb: string, extra: Partial<ClauseSpec> = {}): ClauseSpec => ({
    ...base,
    verb: wantVerb,
    after: join('to', verb, after) + please,
    negative,
    ...extra,
  });
  const youSpec = (extra: Partial<ClauseSpec>): ClauseSpec => ({
    subj: 'you',
    person: 'you',
    pronoun: true,
    verb,
    after,
    ...extra,
  });
  const order = (kinds: SuggestionKind[], table: Partial<Record<SuggestionKind, () => void>>) => {
    for (const kind of kinds) table[kind]?.();
  };
  // A time word narrows the readings: "yesterday" rules out wishes, "tomorrow" rules out the past.
  const usual = (first: SuggestionKind, rest: SuggestionKind[]): SuggestionKind[] => {
    let all = [first, ...rest];
    if (tense === 'past') all = ['past'];
    else if (tense === 'future') all = ['future', ...all.filter((kind) => kind !== 'past' && kind !== 'now' && kind !== 'say')];
    else if (tense === 'now') all = ['now', ...all.filter((kind) => kind !== 'past')];
    return all.filter((kind, index) => all.indexOf(kind) === index);
  };

  // ── wanting verbs: want, need, like, love, hate ─────────────────────────
  if (cls === 'want') {
    let objectText = after;
    // "need break" -> "a break", "want hug" -> "a hug"
    const second = parse.verbs[1];
    if (second && parse.verbs.length === 2 && comps.objects === 0 && NOUN_AFTER_WANT[second.id] && (main.id === 'want' || main.id === 'need')) {
      objectText = join(NOUN_AFTER_WANT[second.id], comps.text, times);
    } else if (parse.verbs.length === 1 && comps.place && comps.objects === 1 && (main.id === 'want' || main.id === 'need')) {
      // "want home" -> "want to go home"
      const phrase = readNounPhrase(parse.rest, 0);
      if (phrase) objectText = join('to go', destination(phrase.parts), times);
    } else if (parse.verbs.length === 1 && parse.rest.length > 0 && isPlace(parse.rest[parse.rest.length - 1]) && comps.objects === 1 && (main.id === 'want' || main.id === 'need')) {
      const phrase = readNounPhrase(parse.rest, 0);
      if (phrase && phrase.end === parse.rest.length) objectText = join('to go', destination(phrase.parts), times);
    }
    // "need doctor" is first of all "I need a doctor", and only then "I need to go to the doctor".
    let goText = objectText.startsWith('to go ') && parse.verbs.length === 1 ? objectText.slice(3) : '';
    const onlyPhrase = readNounPhrase(parse.rest, 0);
    const professional = !!onlyPhrase && onlyPhrase.end === parse.rest.length && !!onlyPhrase.parts.noun.w?.person;
    if (goText && professional && onlyPhrase) {
      objectText = join(renderNounPhrase(onlyPhrase.parts, negative ? 'negative' : 'specific').text, times);
    } else if (!goText) goText = '';
    if (!objectText.trim()) objectText = 'it';
    const kind: SuggestionKind = main.id === 'want' || main.id === 'need' ? 'want' : 'say';
    const plain: ClauseSpec = { ...base, verb, after: objectText + please, negative };
    const hasVerbObject = parse.verbs.length > 1 && objectText.startsWith('to ');

    // "I want to watch a movie later": the time belongs to the watching, not the wanting.
    const wantKinds: SuggestionKind[] = tense === 'past' ? ['past', kind] : tense ? [kind, 'ask'] : [kind, 'ask', 'past'];
    order(wantKinds, {
      [kind]: () => {
        out.clause(kind, plain);
        if (professional && goText) out.clause(kind, { ...base, verb, after: join('to', goText) + please, negative });
      },
      past: () => out.clause('past', { ...plain, tense: 'past' }),
      future: () => out.clause('future', { ...plain, tense: 'future' }),
      ask: () => {
        if (negative) return;
        if (isYou || !isI) {
          out.clause('ask', { ...plain, mood: 'yesno' });
        } else if ((main.id === 'want' || main.id === 'need') && goText && !professional) {
          out.clause('ask', { ...base, modal: 'can', verb: 'go', after: goText.replace(/^go /, '') + please, mood: 'yesno' });
        } else if (professional) {
          // no "Can I have a doctor?"
        } else if (second?.id === 'help' && objectText.startsWith('help')) {
          out.clause('ask', youSpec({ modal: 'can', verb: 'help', after: `me${please}`, mood: 'yesno' }));
        } else if (main.id === 'want' || main.id === 'need') {
          if (hasVerbObject) {
            out.clause('ask', { ...base, modal: 'can', verb: parse.verbs[1].text, after: join(verbChain(parse.verbs.slice(1)), comps.text, times) + please, mood: 'yesno' });
          } else if (objectText !== 'it') {
            out.clause('ask', { ...base, modal: 'can', verb: 'have', after: objectText + please, mood: 'yesno' });
          }
        } else if (objectText === 'you') {
          out.clause('ask', youSpec({ verb, after: 'me', mood: 'yesno' }));
        } else if (!/\byou\b/.test(objectText)) {
          out.clause('ask', youSpec({ verb, after: objectText, mood: 'yesno' }));
        }
      },
    });
    if (isYou && !negative) {
      // "you want cookie" is far more often a question than a statement
      const asked = out.items.findIndex((item) => item.kind === 'ask');
      if (asked > 0) out.items.unshift(...out.items.splice(asked, 1));
    }
    return out.items;
  }

  // ── states: have, know, see, hear, understand, hurt ... ─────────────────
  if (cls === 'state' || cls === 'feel') {
    // "hurt head" -> "My head hurts."
    if (main.id === 'hurt' && implied && comps.objects === 1) {
      const phrase = readNounPhrase(parse.rest, 0);
      if (phrase && phrase.end === parse.rest.length) {
        const who = renderNounPhrase(phrase.parts, 'subject');
        const spec: ClauseSpec = { subj: who.text, person: who.person, verb: 'hurt', after: times, negative, mid: parse.mid };
        out.clause('say', spec);
        out.clause('past', { ...spec, tense: 'past' });
        return out.items;
      }
    }
    let who: ClauseSpec = stmt({});
    if (implied && comps.objects === 0 && ['hurt', 'break', 'happen', 'smell', 'taste'].includes(main.id)) {
      who = { ...who, subj: 'it', person: 'third', pronoun: true };
    }
    if (NEEDS_OBJECT.has(main.id) && comps.objects === 0 && !comps.text && parse.verbs.length === 1) {
      who = { ...who, after: join('it', ends, times) };
    }
    const event = EVENT_VERBS.has(main.id);
    const swapMe = (text: string | undefined) => (text === 'you' ? 'me' : text);
    if (main.id === 'happen' && implied) {
      out.clause('ask', { subj: null, person: 'third', verb, after, tense: 'past', mood: 'wh', wh: 'what', whSubject: true });
    }
    const pastFirst = PAST_BY_DEFAULT.has(main.id) && !tense;
    const present = () => {
      if (main.id === 'break' && !negative && comps.objects === 0) out.clause('say', { ...who, verb: undefined, after: join('broken', times) });
      else if (event) out.clause('now', { ...who, progressive: true });
      else out.clause('say', who);
    };
    order(pastFirst ? ['past', 'say', 'ask'] : usual('say', ['past', 'ask']), {
      say: present,
      now: present,
      past: () => out.clause('past', { ...who, tense: 'past' }),
      future: () => out.clause('future', { ...who, tense: 'future' }),
      ask: () => {
        const about = who.after ?? '';
        if (negative || main.id === 'happen' || main.id === 'hurt') return;
        // Turning "I ..." into "Do you ...?" only works when the rest is not about the speaker.
        if ((/\byou\b/.test(about) && about !== 'you') || /\b(my|me|mine)\b/.test(about)) return;
        const when = pastFirst ? { tense: 'past' as const } : {};
        if (isI && who.subj !== 'it') out.clause('ask', youSpec({ after: swapMe(who.after), mood: 'yesno', ...when }));
        else if (!event) out.clause('ask', { ...who, mood: 'yesno', ...when });
      },
    });
    if (isYou && !negative && cls === 'state') {
      const asked = out.items.findIndex((item) => item.kind === 'ask');
      if (asked > 0) out.items.unshift(...out.items.splice(asked, 1));
    }
    return out.items;
  }

  // ── thinking: think, hope, wish, wonder ─────────────────────────────────
  if (cls === 'think') {
    let thought = after;
    if (parse.rest.length > 0) {
      const inner = plainStatement(parse.rest, contractions, true);
      if (inner) thought = join(chain, inner, times);
    } else if (!chain) thought = main.id === 'wonder' ? 'about that' : 'so';
    out.clause('say', { ...base, verb, after: thought, negative });
    if (parse.rest.length === 0) out.clause('past', { ...base, verb, after: thought, negative, tense: 'past' });
    if (isI && !negative) out.clause('ask', youSpec({ after: thought, mood: 'yesno' }));
    return out.items;
  }

  // ── "you" + action: usually a request ───────────────────────────────────
  if (isYou) {
    if (negative) {
      out.clause('tell', { subj: null, person: 'you', verb, after: after + please, negative: true });
      out.clause('say', stmt({ progressive: true }));
      out.clause('past', stmt({ tense: 'past' }));
      return out.items;
    }
    order(usual('ask', ['now', 'past']), {
      ask: () => {
        out.clause('ask', stmt({ modal: 'can', after: after + please, mood: 'yesno' }));
        out.clause('ask', stmt({ progressive: true, mood: 'yesno' }));
      },
      now: () => out.clause('now', stmt({ progressive: true })),
      past: () => {
        out.clause('past', stmt({ tense: 'past' }));
        out.clause('ask', stmt({ tense: 'past', mood: 'yesno' }));
      },
      future: () => out.clause('future', stmt({ tense: 'future', mood: 'yesno' })),
    });
    return out.items;
  }

  // ── someone else doing something: Mom, he, the dog, we, they ────────────
  if (!isI) {
    const isWe = subject.id === 'we';
    const callable = !!subject.head?.person && (cls === 'other' || main.id === 'come' || main.id === 'look') && !negative;
    if (callable) {
      // "mom look" is usually calling Mom, not describing her
      const name = subject.head?.text ?? subject.text;
      out.text('tell', `${name}, ${realize({ subj: null, person: 'you', verb, after: after || (main.id === 'come' ? 'here' : '') }, contractions)}${please}`, comps.objects === 0 ? '!' : '.');
    }
    order(usual('now', isWe ? ['ask', 'past', 'say'] : ['past', 'say', 'ask']), {
      now: () => out.clause('now', stmt({ progressive: true })),
      past: () => out.clause('past', stmt({ tense: 'past' })),
      future: () => {
        out.clause('future', stmt({ tense: 'future' }));
        out.clause('future', stmt({ progressive: true }));
      },
      say: () => out.clause('say', stmt({})),
      ask: () => {
        if (negative) return;
        if (isWe) out.clause('ask', stmt({ modal: 'can', after: after + please, mood: 'yesno' }));
        else out.clause('ask', stmt({ progressive: true, mood: 'yesno' }));
      },
    });
    if (isWe && !negative && TOGETHER_VERBS.has(main.id)) out.text('tell', `let's ${join(verb, after)}`, '.');
    return out.items;
  }

  // ── from here on the subject is "I" (said or implied) ───────────────────

  if (negative) {
    if (implied && (cls === 'other' || main.id === 'come')) {
      // "not touch" -> "Don't touch."
      out.clause('tell', { subj: null, person: 'you', verb, after: after + please, negative: true });
      if (!please) out.text('tell', `please ${realize({ subj: null, person: 'you', verb, after, negative: true }, contractions)}`, '.');
      out.clause('want', wanting('want'));
    } else {
      out.clause('want', wanting('want'));
      out.clause('now', stmt({ progressive: true }));
    }
    out.clause('past', stmt({ tense: 'past' }));
    out.clause('say', stmt({ modal: 'can' }));
    return out.items;
  }

  const bathroom = comps.place?.id === 'bathroom' || comps.place?.id === 'toilet' || main.id === 'pee' || main.id === 'poop';
  const wantVerb = bathroom ? 'need' : 'want';

  // Asking someone to act: "help", "open door", "give me cookie", "come".
  const forMe = parse.rest.some((tok) => tok.id === 'me' || tok.id === 'us');
  const listenerVerb = cls === 'other' || main.id === 'tell' || main.id === 'ask' || main.id === 'come' || main.id === 'say';
  if (implied && (listenerVerb || forMe)) {
    if (main.id === 'help' && comps.objects === 0 && parse.verbs.length === 1) {
      out.text('want', `I need help${please}`, '.');
      out.text('tell', `help me${please || ', please'}`, '.');
      out.clause('ask', youSpec({ modal: 'can', verb: 'help', after: 'me', mood: 'yesno' }));
      return out.items;
    }
    if (['hug', 'kiss'].includes(main.id) && comps.objects === 0 && parse.verbs.length === 1) {
      out.text('want', `I want a ${main.text}${please}`, '.');
      out.clause('ask', { ...base, modal: 'can', verb: 'have', after: `a ${main.text}${please}`, mood: 'yesno' });
      return out.items;
    }
    const bareCommand = comps.objects === 0 && parse.verbs.length === 1 && !comps.text && !times && main.id !== 'say' && main.id !== 'put';
    const needsIt = (main.id === 'put' && comps.objects === 0) || (main.id === 'say' && comps.objects === 0 && !comps.text);
    const tail = main.id === 'come' && !after ? 'here' : needsIt ? join('it', after) : after;
    order(forMe ? ['tell', 'ask'] : usual('tell', ['ask', 'want', 'past']), {
      tell: () => {
        out.clause('tell', { subj: null, person: 'you', verb, after: tail + (bareCommand ? '' : please) }, bareCommand ? '!' : '.');
        if (bareCommand) out.text('tell', `please ${verb}`, '.');
        else if (!please) out.clause('tell', { subj: null, person: 'you', verb, after: `${tail}, please` });
      },
      ask: () => out.clause('ask', youSpec({ modal: 'can', after: tail + please, mood: 'yesno' })),
      want: () => out.clause('want', { ...base, verb: 'want', after: join('to', verb, tail) }),
      past: () => out.clause('past', stmt({ after: tail, tense: 'past' })),
      future: () => out.clause('future', stmt({ after: tail, tense: 'future' })),
      now: () => out.clause('now', stmt({ after: tail, progressive: true })),
    });
    return out.items;
  }

  // Saying: "say no" most often reports what was said.
  if (main.id === 'say') {
    order(usual('past', ['want', 'now']), {
      past: () => out.clause('past', stmt({ tense: 'past' })),
      want: () => out.clause('want', wanting('want')),
      now: () => out.clause('now', stmt({ progressive: true })),
      future: () => out.clause('future', stmt({ tense: 'future' })),
    });
    return out.items;
  }

  // Things I do: eat, drink, play, go, sleep, watch ...
  const pastFirst = PAST_BY_DEFAULT.has(main.id) && !tense;
  const steady = parse.mid.length > 0; // "never", "always": no "Can I never go?"
  const kinds = pastFirst
    ? ((['find', 'win', 'finish'].includes(main.id) ? ['past', 'want'] : ['past']) as SuggestionKind[])
    : usual('want', steady ? ['now', 'past'] : ['now', 'past', 'ask']);
  order(kinds, {
    want: () => out.clause('want', wanting(wantVerb)),
    now: () => out.clause('now', stmt({ progressive: true })),
    past: () => out.clause('past', stmt({ tense: 'past' })),
    future: () => {
      out.clause('future', stmt({ tense: 'future' }));
      out.clause('future', { ...base, verb: 'go', progressive: true, after: join('to', verb, after) });
    },
    ask: () => out.clause('ask', stmt({ modal: 'can', after: after + please, mood: 'yesno' })),
  });
  if (implied && TOGETHER_VERBS.has(main.id) && !tense) out.text('tell', `let's ${join(verb, after)}`, '.');
  return out.items;
}

/** A single statement with no alternatives, for use inside a bigger sentence. */
function plainStatement(toks: Tok[], contractions: boolean, impliedIt: boolean): string {
  if (toks.length === 0) return '';
  // "think good" -> "it is good"
  if (impliedIt) {
    const parse = parseClause(toks);
    if (!parse.subject && parse.verbs.length === 0) {
      const only = toks[toks.length - 1];
      if (only.cat === 'ADJ' || only.cat === 'DEG') {
        const text = toks.map((tok) => tok.text).join(' ');
        return realize({ subj: 'it', person: 'third', pronoun: true, after: text, negative: parse.negative }, contractions);
      }
      if (only.cat === 'SOC') return only.id === 'yes' ? 'so' : only.id === 'no' ? 'not' : only.text;
    }
  }
  const variants = clauseVariants(toks, contractions, false);
  const pick = variants.find((variant) => variant.kind === 'say' || variant.kind === 'now') ?? variants[0];
  return pick ? pick.text : toks.map((tok) => tok.text).join(' ');
}

// ───────────────────────────────────────────────────────── verbless input ──

function verbless(parse: Parse, out: Collector, times: string, please: string): void {
  const rest = parse.rest;
  const subject = parse.subject;
  const negative = parse.negative;
  const mid = parse.mid;

  // Auxiliary first with no verb: "is mom home", "can I".
  const questionFirst = !!parse.auxFirst || parse.ask;

  if (subject) {
    const base = { subj: subject.text, person: subject.person, pronoun: subject.pronoun, mid } as const;
    const isI = subject.person === 'i';
    const isYou = subject.person === 'you';

    if (rest.length === 0) {
      if (parse.modal) {
        out.clause('say', { ...base, modal: parse.modal, negative, verb: 'do', after: 'it' });
        return;
      }
      if (parse.auxFirst && parse.auxFirst !== 'is' && parse.auxFirst !== 'do') {
        out.clause('ask', { ...base, modal: parse.auxFirst, verb: 'do', after: 'it', mood: 'yesno' });
      }
      return; // just "I" or "Mom": nothing to add
    }

    const firstPhrase = readNounPhrase(rest, 0);
    const lead = rest[0];

    // Subject + feeling + what it is about: "I scared dog" -> "I'm scared of the dog."
    if (lead.cat === 'ADJ' && FEELING_PREPOSITION[lead.id] && rest.length > 1) {
      const about = readNounPhrase(rest, 1);
      const pronoun = rest.length === 2 && ['SUBJ', 'OBJ', 'DEM'].includes(rest[1].cat) ? objectPronoun(rest[1]) : '';
      if ((about && about.end === rest.length) || pronoun) {
        const target = pronoun || renderNounPhrase(about!.parts, 'location').text;
        const be: ClauseSpec = { ...base, after: join(lead.text, FEELING_PREPOSITION[lead.id], target, times), negative };
        out.clause('say', be);
        out.clause('past', { ...be, tense: 'past' });
        if (!isI) out.clause('ask', { ...be, mood: 'yesno' });
        return;
      }
    }

    // Subject + description: "I tired", "mom happy", "it very big".
    const describes = lead.cat === 'ADJ' || (lead.cat === 'DEG' && rest[1]?.cat === 'ADJ');
    if (describes && !firstPhrase) {
      const text = join(rest.map((tok) => tok.text).join(' '), times);
      const adjective = rest.find((tok) => tok.cat === 'ADJ');
      const feeling = !!adjective?.w?.feeling;
      const be: ClauseSpec = { ...base, after: text, negative };
      const asking = questionFirst || (isYou && feeling && !negative);
      const table: Partial<Record<SuggestionKind, () => void>> = {
        say: () => out.clause('say', be),
        ask: () => out.clause('ask', { ...be, mood: 'yesno' }),
        past: () => out.clause('past', { ...be, tense: 'past' }),
        future: () => out.clause('future', { ...be, tense: 'future' }),
      };
      const kinds: SuggestionKind[] = parse.tense === 'past' ? ['past', 'say', 'ask'] : parse.tense === 'future' ? ['future', 'say', 'ask'] : asking ? ['ask', 'say', 'past'] : ['say', 'past', 'ask'];
      for (const kind of kinds) {
        // Nobody asks "Am I tired?" by choosing "I tired".
        if (kind === 'ask' && isI && !questionFirst) continue;
        table[kind]?.();
        if (kind === 'say' && feeling && isI) out.clause('say', { ...base, verb: 'feel', after: text, negative });
      }
      return;
    }

    // Subject + mine: "that mine"
    if (lead.cat === 'MINE' || lead.cat === 'ADV' || lead.cat === 'P' || lead.cat === 'NUM') {
      const comps = renderComplements(rest, undefined, negative);
      const be: ClauseSpec = { ...base, after: join(comps.text, times), negative };
      out.clause(questionFirst ? 'ask' : 'say', questionFirst ? { ...be, mood: 'yesno' } : be);
      if (!questionFirst) {
        out.clause('past', { ...be, tense: 'past' });
        out.clause('ask', { ...be, mood: 'yesno' });
      }
      return;
    }

    // Subject + place: "I school", "mom work", "dad car".
    if (firstPhrase && firstPhrase.end === rest.length && isPlace(firstPhrase.parts.noun)) {
      const here = location(firstPhrase.parts);
      const there = destination(firstPhrase.parts);
      const be: ClauseSpec = { ...base, after: join(here, times), negative };
      if (questionFirst) {
        out.clause('ask', { ...be, mood: 'yesno' });
        out.clause('say', be);
        return;
      }
      if (isI && !negative && parse.tense !== 'past') {
        const need = ['bathroom', 'toilet'].includes(firstPhrase.parts.noun.id) ? 'need' : 'want';
        out.clause('want', { ...base, verb: need, after: join('to go', there, times) + please });
      }
      if (parse.tense === 'past') out.clause('past', { ...be, tense: 'past' });
      out.clause('say', be);
      if (!isI) out.clause('past', { ...base, verb: 'go', after: join(there, times), tense: 'past', negative });
      if (parse.tense !== 'past') out.clause('past', { ...be, tense: 'past' });
      if (!isI && !negative) out.clause('ask', { ...be, mood: 'yesno' });
      return;
    }

    // Subject + thing: "I cookie" -> "I want a cookie."; "it dog" -> "It is a dog."
    const comps = renderComplements(rest, undefined, negative);
    const ailment = firstPhrase?.parts.noun.w;
    if (firstPhrase && ailment?.group === 'body' && !ailment.body) {
      // "I pain" -> "I'm in pain.", "mom headache" -> "Mom has a headache."
      if (ailment.id === 'pain' && firstPhrase.end === rest.length) out.clause('say', { ...base, after: join('in pain', times), negative });
      out.clause('say', { ...base, verb: 'have', after: join(comps.text, times), negative });
      out.clause('past', { ...base, verb: 'have', after: join(comps.text, times), negative, tense: 'past' });
      return;
    }
    if (firstPhrase) {
      const thing = renderNounPhrase(firstPhrase.parts, negative ? 'negative' : 'predicate').text;
      const tail = join(rest.slice(firstPhrase.end).map((tok) => tok.text).join(' '), times);
      const be: ClauseSpec = { ...base, after: join(thing, tail), negative };
      if (questionFirst) {
        if (isI || isYou) out.clause('ask', { ...base, verb: 'have', after: join(comps.text, times), mood: 'yesno' });
        out.clause('ask', { ...be, mood: 'yesno' });
        return;
      }
      if (isI || isYou) {
        const wantSpec: ClauseSpec = { ...base, verb: 'want', after: join(comps.text, times) + please, negative };
        if (isYou && !negative) out.clause('ask', { ...wantSpec, mood: 'yesno' });
        else out.clause('want', wantSpec);
        out.clause('say', { ...base, verb: 'have', after: join(comps.text, times), negative });
        if (isI && !negative) out.clause('ask', { ...base, modal: 'can', verb: 'have', after: join(comps.text, times) + please, mood: 'yesno' });
      } else {
        out.clause('say', be);
        out.clause('say', { ...base, verb: 'have', after: join(comps.text, times), negative });
        out.clause('say', { ...base, verb: 'want', after: join(comps.text, times), negative });
      }
      return;
    }

    // Anything else after a subject: join with "be".
    const be: ClauseSpec = { ...base, after: join(comps.text, times), negative };
    out.clause(questionFirst ? 'ask' : 'say', questionFirst ? { ...be, mood: 'yesno' } : be);
    return;
  }

  // ── no subject and no verb: a thing, a place, a feeling, a fragment ─────
  if (rest.length === 0) {
    if (parse.times.length === 1 && parse.times[0] === 'again') {
      out.text('tell', `do it again${please || ', please'}`, '.');
      out.text('want', 'I want to do it again', '.');
      out.text('tell', "let's do it again", '.');
    }
    return;
  }
  const I = { subj: 'I', person: 'i' as Person, pronoun: true, mid };
  const lead = rest[0];
  const phrase = readNounPhrase(rest, 0);
  const whole = phrase && phrase.end === rest.length;

  if (parse.auxFirst && phrase) {
    // "can cookie" -> "Can I have a cookie?"
    const thing = renderNounPhrase(phrase.parts, 'specific').text;
    out.clause('ask', { ...I, modal: parse.auxFirst === 'is' || parse.auxFirst === 'do' ? 'can' : parse.auxFirst, verb: 'have', after: join(thing, times) + please, mood: 'yesno' });
    return;
  }

  // A feeling or description on its own.
  if (lead.cat === 'ADJ' || (lead.cat === 'DEG' && rest[1]?.cat === 'ADJ')) {
    if (!phrase) {
      const text = join(rest.map((tok) => tok.text).join(' '), times);
      const adjective = rest.find((tok) => tok.cat === 'ADJ')!;
      if (adjective.w?.feeling || SELF_ADJECTIVES.has(adjective.id)) {
        out.clause('say', { ...I, after: text, negative });
        if (adjective.w?.feeling) out.clause('say', { ...I, verb: 'feel', after: text, negative });
        if (!negative) out.clause('ask', { subj: 'you', person: 'you', pronoun: true, after: text, mood: 'yesno' });
        out.clause('past', { ...I, after: text, negative, tense: 'past' });
      } else {
        const it = { subj: 'it', person: 'third' as Person, pronoun: true, mid };
        out.clause('say', { ...it, after: text, negative });
        if (!WEATHER_ADJECTIVES.has(adjective.id)) {
          out.clause('say', { subj: 'that', person: 'third', pronoun: true, mid, after: text, negative });
          if (adjective.w?.color && !negative) out.clause('want', { ...I, verb: 'want', after: `the ${adjective.text} one${please}` });
        }
        out.clause('past', { ...it, after: text, negative, tense: 'past' });
        if (!negative) out.clause('ask', { ...it, after: text, mood: 'yesno' });
      }
      return;
    }
  }

  if (whole && phrase) {
    const parts = phrase.parts;
    const head = parts.noun;
    const word = head.w;
    const marked = !!(parts.det || parts.poss || parts.dem || parts.num || parts.mods.length);

    // Refusing: "no bath", "not cookie".
    if (negative) {
      const thing = renderNounPhrase(parts, 'negative').text;
      out.clause('want', { ...I, verb: 'want', after: join(thing, times), negative: true });
      if (isPlace(head)) out.clause('want', { ...I, verb: 'want', after: join('to go', destination(parts), times), negative: true });
      out.text('say', `no ${renderNounPhrase(parts, 'bare').text}`, '.');
      return;
    }

    // A place: "park" -> "I want to go to the park."
    if (isPlace(head) && !word?.person && !parts.poss && !parts.dem) {
      const there = destination(parts);
      const here = location(parts);
      const need = ['bathroom', 'toilet'].includes(head.id);
      out.clause('want', { ...I, verb: need ? 'need' : 'want', after: join('to go', there, times) + please });
      out.clause('ask', { ...(need ? I : { subj: 'we', person: 'plural' as Person, pronoun: true, mid }), modal: 'can', verb: 'go', after: join(there, times) + please, mood: 'yesno' });
      out.clause('say', { ...I, after: join(here, times) });
      out.clause('past', { ...I, verb: 'go', after: join(there, times), tense: 'past' });
      return;
    }

    // A person: "mom" -> "I want Mom." / "Where is Mom?"
    if (word?.person && !marked) {
      const who = renderNounPhrase(parts, 'subject');
      const object = renderNounPhrase(parts, 'predicate').text;
      const needed = ['doctor', 'nurse', 'dentist', 'police', 'helper', 'therapist'].includes(head.id);
      const wanted = needed ? renderNounPhrase(parts, 'specific').text : who.text === object ? object : who.text;
      out.clause('want', { ...I, verb: needed ? 'need' : 'want', after: join(wanted, times) });
      out.clause('ask', { subj: who.text, person: who.person, mood: 'wh', wh: 'where' });
      if (word.noun === 'proper') out.text('tell', who.text, '!');
      return;
    }

    // A body part: "head" -> "My head hurts."
    if (word?.body && !marked) {
      const who = renderNounPhrase(parts, 'subject');
      out.clause('say', { subj: who.text, person: who.person, verb: 'hurt', after: times });
      out.clause('say', { subj: who.text, person: who.person, verb: 'feel', after: join('funny', times) });
      return;
    }

    // "my turn", "your turn"
    if (parts.poss && (head.id === 'turn' || head.id === 'birthday')) {
      out.clause('say', { subj: 'it', person: 'third', pronoun: true, after: join(renderNounPhrase(parts, 'bare').text, times) });
      return;
    }

    // "pain" -> "I'm in pain.", "headache" -> "I have a headache."
    if (word?.group === 'body' && !word.body && !marked) {
      if (head.id === 'pain') out.clause('say', { ...I, after: join('in pain', times) });
      out.clause('say', { ...I, verb: 'have', after: join(renderNounPhrase(parts, 'specific').text, times) });
      if (head.id === 'pain') out.text('say', 'it hurts', '.');
      return;
    }

    // "rain" -> "It's raining."
    const weather = !marked ? WEATHER_NOUNS[head.id] : undefined;
    if (weather) {
      const it = { subj: 'it', person: 'third' as Person, pronoun: true, mid };
      if (weather.verb) {
        out.clause('now', { ...it, verb: weather.verb, progressive: true, after: times });
        out.clause('past', { ...it, verb: weather.verb, progressive: true, tense: 'past', after: times });
        out.clause('ask', { ...it, verb: weather.verb, progressive: true, after: times, mood: 'yesno' });
      } else {
        out.clause('say', { ...it, after: join(weather.adjective, times) });
        out.clause('ask', { ...it, after: join(weather.adjective, times), mood: 'yesno' });
      }
      out.clause('say', { ...I, verb: 'like', after: `the ${head.text}` });
      return;
    }

    // Food, drinks, things and clothes are usually asked for; animals, weather and the like are usually pointed out.
    const wantable = ['food', 'drinks', 'things', 'clothes'].includes(word?.group ?? '') || head.cat === 'TXT';
    const counted = !!(parts.det || parts.num);
    const specific = renderNounPhrase(parts, 'specific').text;
    const asThing = renderNounPhrase(parts, 'predicate').text;
    const owned = !!parts.poss;

    if (parts.dem && !parts.mods.length) {
      // "that dog" could be "That is a dog." or "I want that dog."
      const noun = renderNounPhrase({ ...parts, dem: undefined }, 'predicate').text;
      const be: ClauseSpec = { subj: parts.dem.text, person: personOfPronoun(parts.dem.id), pronoun: true, mid, after: noun };
      const wantIt = () => out.clause('want', { ...I, verb: 'want', after: join(specific, times) + please });
      if (wantable) {
        wantIt();
        out.clause('say', be);
      } else {
        out.clause('say', be);
        wantIt();
      }
      out.clause('ask', { ...be, mood: 'yesno' });
      return;
    }

    if (wantable) {
      out.clause('want', { ...I, verb: 'want', after: join(specific, times) + please });
      out.clause('ask', { ...I, modal: 'can', verb: 'have', after: join(specific, times) + please, mood: 'yesno' });
      if (owned) {
        const who = renderNounPhrase(parts, 'subject');
        out.clause('ask', { subj: who.text, person: who.person, mood: 'wh', wh: 'where' });
        out.clause('say', { subj: 'it', person: 'third', pronoun: true, mid, after: asThing });
      } else {
        out.clause('say', { ...I, verb: 'have', after: join(specific, times) });
        if (!counted) out.clause('say', { subj: 'it', person: 'third', pronoun: true, mid, after: asThing });
      }
    } else {
      if (!counted) out.clause('say', { subj: 'it', person: 'third', pronoun: true, mid, after: join(asThing, times) });
      out.clause('say', { ...I, verb: 'see', after: join(asThing, times) });
      out.clause('want', { ...I, verb: 'want', after: join(specific, times) + please });
    }
    return;
  }

  // "more", "more juice please", "another one", "two"
  if (rest.length === 1 && (lead.id === 'a' || lead.id === 'the')) return;
  if (lead.cat === 'DET' || lead.cat === 'NUM') {
    const comps = renderComplements(rest, { id: 'want', text: 'want', cat: 'V' }, negative);
    out.clause('want', { ...I, verb: 'want', after: join(comps.text, times) + please, negative });
    if (!negative) out.clause('ask', { ...I, modal: 'can', verb: 'have', after: join(comps.text, times) + please, mood: 'yesno' });
    return;
  }

  // "up", "down", "out", "in box", "with mom"
  if (lead.cat === 'P') {
    const comps = renderComplements(rest, undefined, negative);
    if (rest.length === 1) {
      const id = lead.id;
      if (id === 'on' || id === 'off') {
        out.text('tell', `turn it ${id}${please || ', please'}`, '.');
        out.clause('say', { subj: 'it', person: 'third', pronoun: true, mid, after: id, negative });
      } else if (id === 'up' || id === 'down' || id === 'out' || id === 'in') {
        out.clause('want', { ...I, verb: 'want', after: join(id === 'down' ? 'to get' : 'to go', id) + please, negative });
        if (id === 'up' && !negative) out.text('tell', `pick me up${please || ', please'}`, '.');
      }
      return;
    }
    const goesWith = lead.id === 'with' || lead.id === 'to';
    out.clause('say', { subj: 'it', person: 'third', pronoun: true, mid, after: join(comps.text, times), negative });
    if (!negative && !goesWith && !WITH_PREPOSITIONS.has(lead.id)) out.text('tell', `put it ${comps.text}${please || ', please'}`, '.');
    if (goesWith) out.clause('want', { ...I, verb: 'want', after: join('to go', comps.text, times), negative });
    return;
  }

  if (lead.cat === 'MINE') {
    out.clause('say', { subj: 'it', person: 'third', pronoun: true, mid, after: lead.text, negative });
    out.clause('say', { subj: 'that', person: 'third', pronoun: true, mid, after: lead.text, negative });
    return;
  }

  if (lead.cat === 'ADV' && (lead.id === 'here' || lead.id === 'there') && rest.length === 1) {
    out.clause('say', { subj: 'it', person: 'third', pronoun: true, mid, after: lead.text, negative });
    out.text('tell', lead.id === 'here' ? `come here${please || ', please'}` : `put it there${please || ', please'}`, '.');
    return;
  }

  if (lead.cat === 'OBJ' && rest.length === 2 && rest[1].id === 'too') {
    out.text('say', 'me too', '!');
  }
}

// ───────────────────────────────────────────────────────── question words ──

const WHAT_TIME_NOUNS = new Set(['time', 'day']);

function whQuestions(parse: Parse, out: Collector, times: string): void {
  const wh = parse.wh!;
  const id = wh.id;
  const word = wh.text;
  const subject = parse.subject;
  const main = parse.verbs[0];
  const rest = parse.rest;
  const negative = parse.negative;
  const mid = parse.mid;
  const ask = (spec: ClauseSpec, kind: SuggestionKind = 'ask') => out.clause(kind, { mood: 'wh', wh: word, mid, ...spec }, '?');

  // "how many cookies", "how much juice", "which one", "what color"
  let whPhrase = word;
  let remaining = rest;
  if (!main && !subject && (id === 'how-many' || id === 'how-much' || id === 'which')) {
    const phrase = readNounPhrase(rest, 0);
    if (phrase) {
      const noun = renderNounPhrase(phrase.parts, id === 'how-many' ? 'generic' : 'bare').text;
      whPhrase = `${word} ${noun}`;
      remaining = rest.slice(phrase.end);
      out.text('ask', join(whPhrase, remaining.map((tok) => tok.text).join(' '), times), '?');
      if (id === 'how-many') out.text('ask', join(whPhrase, 'are there', times), '?');
      if (id === 'how-much') out.text('ask', join(whPhrase, 'is there', times), '?');
      return;
    }
  }

  if (!main && !subject && rest.length === 1 && ['DEM', 'SUBJ', 'OBJ'].includes(rest[0].cat)) {
    // "what that", "who she", "where it"
    const only = rest[0];
    const text = subjectPronoun(only);
    const spec: ClauseSpec = { subj: text, person: personOfPronoun(only.id), pronoun: true, after: times, negative };
    ask(spec);
    ask({ ...spec, tense: 'past' });
    return;
  }

  if (!main && subject?.pronoun && subject.id && POSSESSIVE_OF[subject.id] && rest.length > 0) {
    // "what you name" -> "What's your name?", "where I shoes" -> "Where are my shoes?"
    const owned = readNounPhrase(rest, 0);
    if (owned && owned.end === rest.length && !owned.parts.poss && !owned.parts.det && !owned.parts.dem && !isPlace(owned.parts.noun)) {
      owned.parts.poss = { id: 'poss', text: POSSESSIVE_OF[subject.id], cat: 'POSS' };
      const who = renderNounPhrase(owned.parts, 'subject');
      ask({ subj: who.text, person: who.person, after: times, negative });
      return;
    }
  }

  if (!main) {
    // No verb: "where mom", "why you sad", "what that", "how you", "when lunch".
    if (subject) {
      const tail = join(renderComplements(rest, undefined, negative).text, times);
      const spec: ClauseSpec = { subj: subject.text, person: subject.person, pronoun: subject.pronoun, after: tail, negative };
      if (parse.modal) {
        ask({ ...spec, modal: parse.modal, verb: 'do', after: join('it', tail) });
        return;
      }
      if (parse.tense === 'past') ask({ ...spec, tense: 'past' });
      ask(spec);
      if (parse.tense !== 'past') ask({ ...spec, tense: 'past' });
      return;
    }
    if (rest.length === 0) {
      if (negative) return; // "why not" is already a whole question
      out.text('ask', word, '?');
      if (id === 'what') out.text('ask', "what's that", '?');
      if (id === 'where') out.text('ask', 'where is it', '?');
      if (id === 'how') out.text('ask', 'how are you', '?');
      if (id === 'why') out.text('ask', 'why not', '?');
      return;
    }
    const phrase = readNounPhrase(rest, 0);
    if (phrase && phrase.end === rest.length) {
      const head = phrase.parts.noun;
      if (id === 'what' && WHAT_TIME_NOUNS.has(head.id)) {
        out.text('ask', join(`what ${head.text} is it`, times), '?');
        return;
      }
      if (id === 'what' && head.id === 'name') {
        out.text('ask', "what's your name", '?');
        return;
      }
      const who = renderNounPhrase(phrase.parts, 'subject');
      ask({ subj: who.text, person: who.person, after: times, negative });
      if (id === 'what' || id === 'which') out.text('ask', join(word, renderNounPhrase(phrase.parts, 'bare').text, times), '?');
      if (id === 'where' || id === 'when') ask({ subj: who.text, person: who.person, after: times, tense: 'past' });
      return;
    }
    // "what wrong", "who sick", "why sad", "how big"
    const lone = rest.find((tok) => tok.cat === 'ADJ');
    if (lone) {
      const text = join(rest.map((tok) => tok.text).join(' '), times);
      if (id === 'what' || id === 'who') {
        ask({ subj: null, person: 'third', after: text, whSubject: true, negative });
      } else if (id === 'how') {
        out.text('ask', join('how', text, 'is it'), '?');
      } else if (lone.w?.feeling) {
        ask({ subj: 'you', person: 'you', pronoun: true, after: text, negative });
      } else {
        ask({ subj: 'it', person: 'third', pronoun: true, after: text, negative });
      }
      return;
    }
    out.text('ask', join(word, renderComplements(rest, undefined, negative).text, times), '?');
    return;
  }

  // With a verb.
  const governor = parse.verbs[parse.verbs.length - 1];
  const comps = renderComplements(rest, governor, negative);
  const verb = main.text;
  const after = join(verbChain(parse.verbs), comps.text, times);
  const cls = main.w?.verb ?? 'self';
  const stative = cls === 'want' || cls === 'state' || cls === 'feel' || cls === 'think';

  // "who want cookie" / "what happen": the question word is the subject.
  const thingHappens = id === 'what' && ['happen', 'hurt', 'fall', 'break', 'smell'].includes(main.id);
  if (!subject && (id === 'who' || thingHappens)) {
    const spec: ClauseSpec = { subj: null, person: 'third', verb, after, whSubject: true, negative };
    const pastFirst = PAST_BY_DEFAULT.has(main.id) || parse.tense === 'past';
    if (pastFirst) ask({ ...spec, tense: 'past' });
    const ongoing = ['happen', 'fall', 'break'].includes(main.id);
    if ((stative || main.id === 'hurt') && !ongoing) ask(spec);
    else ask({ ...spec, progressive: true });
    if (!pastFirst) ask({ ...spec, tense: 'past' });
    return;
  }

  const forSubject = (who: Subject, modal?: string) => {
    const spec: ClauseSpec = { subj: who.text, person: who.person, pronoun: who.pronoun, verb, after, negative };
    if (modal) {
      ask({ ...spec, modal });
      return;
    }
    if (parse.tense === 'past' || main.id === 'say') ask({ ...spec, tense: 'past' });
    if (stative) ask(spec);
    else ask({ ...spec, progressive: true });
    if (parse.tense === 'future') ask({ ...spec, tense: 'future' });
    if (parse.tense !== 'past' && main.id !== 'say') ask({ ...spec, tense: 'past' });
  };

  if (subject) {
    forSubject(subject, parse.modal);
    return;
  }
  if (parse.modal) {
    forSubject(IMPLIED_I, parse.modal);
    return;
  }
  // No subject given: offer the most likely askers.
  const you: Subject = { text: 'you', person: 'you', pronoun: true, id: 'you' };
  const we: Subject = { text: 'we', person: 'plural', pronoun: true, id: 'we' };
  if (stative || main.id === 'say' || main.id === 'do') {
    forSubject(you);
    if (main.id === 'do') ask({ subj: 'we', person: 'plural', pronoun: true, verb, after, progressive: true });
  } else {
    ask({ subj: we.text, person: we.person, pronoun: true, verb, after, progressive: true, negative });
    ask({ subj: 'I', person: 'i', pronoun: true, verb, after, modal: 'can', negative });
    ask({ subj: you.text, person: you.person, pronoun: true, verb, after, progressive: true, negative });
  }
}

// ─────────────────────────────────────────────────────────── whole message ──

/** Greeting-like words that go in front, each with how it joins what follows. */
const OPENERS: Record<string, { text: string; end: End }> = {
  yes: { text: 'yes,', end: '.' },
  no: { text: 'no,', end: '.' },
  okay: { text: 'okay,', end: '.' },
  hello: { text: 'hello,', end: '!' },
  hi: { text: 'hi,', end: '!' },
  goodbye: { text: 'goodbye,', end: '!' },
  bye: { text: 'bye,', end: '!' },
  sorry: { text: 'sorry,', end: '.' },
  'thank-you': { text: 'thank you,', end: '.' },
  'excuse-me': { text: 'excuse me,', end: '.' },
  'good-morning': { text: 'good morning,', end: '!' },
  'good-night': { text: 'good night,', end: '!' },
  wow: { text: 'wow!', end: '!' },
  'uh-oh': { text: 'uh oh!', end: '.' },
  'oh-no': { text: 'oh no!', end: '.' },
  cool: { text: 'cool!', end: '.' },
  haha: { text: 'haha!', end: '.' },
  hmm: { text: 'hmm,', end: '.' },
};

const CLAUSE_JOINERS = new Set(['because', 'but', 'so', 'if', 'then']);

function splitClauses(toks: Tok[]): { joiner?: string; toks: Tok[] }[] {
  const clauses: { joiner?: string; toks: Tok[] }[] = [{ toks: [] }];
  toks.forEach((tok, index) => {
    const next = toks[index + 1];
    const current = clauses[clauses.length - 1];
    const startsClause = !!next && (next.cat === 'SUBJ' || next.cat === 'V' || next.cat === 'NEG' || next.cat === 'AUX');
    const hasVerbBefore = current.toks.some((item) => item.cat === 'V' || item.cat === 'ADJ');
    const isJoiner =
      tok.cat === 'CONJ' &&
      current.toks.length > 0 &&
      !!next &&
      (CLAUSE_JOINERS.has(tok.id) || ((tok.id === 'and' || tok.id === 'or') && startsClause && hasVerbBefore && next.cat !== 'V'));
    if (isJoiner) clauses.push({ joiner: tok.text, toks: [] });
    else current.toks.push(tok);
  });
  return clauses.filter((clause) => clause.toks.length > 0);
}

/**
 * "I sad need mom": a subject, a description, then a verb. That is two
 * sentences sharing a subject, not one sentence with a stray adjective.
 */
function splitAfterDescription(toks: Tok[]): [Tok[], Tok[]] | null {
  const subject = toks[0];
  if (!subject || (subject.cat !== 'SUBJ' && !subject.w?.person)) return null;
  let i = 1;
  if (toks[i]?.cat === 'NEG') i++;
  while (toks[i]?.cat === 'DEG') i++;
  if (toks[i]?.cat !== 'ADJ') return null;
  const after = toks[i + 1];
  const afterNext = toks[i + 2];
  const verbFollows = after?.cat === 'V' || (after?.cat === 'NEG' && afterNext?.cat === 'V');
  if (!verbFollows) return null;
  return [toks.slice(0, i + 1), [subject, ...toks.slice(i + 1)]];
}

function build(tokens: Token[], contractions: boolean): Variant[] {
  let toks = classify(tokens);
  if (toks.length === 0) return [];

  // Ready-made phrases already say exactly what they say.
  if (toks.every((tok) => tok.cat === 'PHR')) {
    return [{ kind: 'say', text: toks.map((tok) => tok.text).join(' '), end: '.' }];
  }
  if (toks.some((tok) => tok.cat === 'PHR')) return [];

  // "please" anywhere makes the sentence polite.
  const polite = toks.some((tok) => tok.id === 'please');
  toks = toks.filter((tok) => tok.id !== 'please');
  if (toks.length === 0) return [{ kind: 'say', text: 'please', end: '.' }];

  // Words in front: "yes", "hello", "sorry" ...
  const openers: Tok[] = [];
  while (toks.length > 0 && toks[0].cat === 'SOC' && OPENERS[toks[0].id]) openers.push(toks.shift()!);
  // Trailing "thank you"
  let closing = '';
  if (toks.length > 0 && toks[toks.length - 1].id === 'thank-you') {
    closing = 'thank you';
    toks.pop();
  }

  const openerText = openers.map((tok) => OPENERS[tok.id].text).join(' ');
  const lastOpener = openers[openers.length - 1];

  if (toks.length === 0) {
    // Only social words.
    const end = lastOpener ? OPENERS[lastOpener.id].end : '.';
    const only = openers.length === 1 ? openers[0] : undefined;
    const text = join(openerText.replace(/[,!]$/, ''), closing && `, ${closing}`);
    const variants: Variant[] = [{ kind: 'say', text: text + (polite ? ', please' : ''), end }];
    if (only?.id === 'sorry') variants.unshift({ kind: 'say', text: contractions ? "I'm sorry" : 'I am sorry', end: '.' });
    if (only?.id === 'no' && polite) variants.unshift({ kind: 'say', text: 'no, thank you', end: '.' });
    if (only?.id === 'yes' && polite) variants.length = 0, variants.push({ kind: 'say', text: 'yes, please', end: '.' });
    return variants;
  }

  // "no" in front of content is usually a refusal: "no bath", "no want".
  let refusal = false;
  if (lastOpener?.id === 'no' && openers.length === 1) {
    const hasSubject = toks[0].cat === 'SUBJ';
    if (!hasSubject) {
      refusal = true;
      toks = [{ id: 'not', text: 'not', cat: 'NEG' }, ...toks];
    }
  }
  const lead = refusal ? '' : openerText;

  // Greeting a person: "hello mom" -> "Hello, Mom!"
  const greetable = lastOpener && ['hello', 'hi', 'goodbye', 'bye', 'good-morning', 'good-night', 'thank-you', 'sorry', 'excuse-me'].includes(lastOpener.id);
  if (greetable && toks.length === 1 && (toks[0].w?.person || toks[0].cat === 'TXT' || toks[0].cat === 'SUBJ')) {
    const name = toks[0].cat === 'N' ? renderNounPhrase({ mods: [], noun: toks[0] }, 'bare').text : toks[0].text;
    return [{ kind: 'say', text: `${openerText} ${name}`, end: OPENERS[lastOpener.id].end }];
  }

  // Two thoughts in a row: "I sad need mom" -> "I'm sad. I need Mom."
  const second = splitAfterDescription(toks);
  if (second) {
    const [describing, acting] = second;
    const opening = clauseVariants(describing, contractions, false).filter((variant) => variant.kind === 'say');
    const following = clauseVariants(acting, contractions, polite)[0];
    if (opening.length > 0 && following) {
      return opening.map((variant) => ({
        kind: variant.kind,
        text: `${join(lead, variant.text)}. ${capitalize(tidy(following.text))}`,
        end: following.end,
      }));
    }
  }

  const clauses = splitClauses(toks);
  const first = clauses[0];
  const firstVariants = clauseVariants(first.toks, contractions, polite);
  if (firstVariants.length === 0) return [];

  let suffix = '';
  for (const clause of clauses.slice(1)) {
    let text: string;
    const single = clause.toks.length === 1 ? clause.toks[0] : undefined;
    const describing = clause.toks.every((tok) => tok.cat === 'ADJ' || tok.cat === 'DEG');
    if (clause.joiner === 'because' && single?.cat === 'N') {
      text = `of ${renderNounPhrase({ mods: [], noun: single }, 'subject').text}`;
    } else if (describing && clause.joiner !== 'because' && clause.joiner !== 'so' && clause.joiner !== 'if') {
      // "happy but tired"
      text = clause.toks.map((tok) => tok.text).join(' ');
    } else {
      text = plainStatement(clause.toks, contractions, false);
    }
    suffix += ` ${clause.joiner} ${text}`;
  }

  // With a second clause in the present, a past-tense first clause would not match.
  const usable = suffix ? firstVariants.filter((variant) => variant.kind !== 'past') : firstVariants;
  return usable.map((variant) => {
    const body = join(lead, variant.text + suffix) + (closing ? `, ${closing}` : '');
    const end: End = suffix && variant.end === '!' ? '.' : variant.end;
    return { kind: variant.kind, text: body, end };
  });
}

/**
 * Suggest complete sentences for the chosen symbols, most likely reading first.
 * The literal words are not included; get those from `literal()`.
 */
export function suggest(tokens: Token[], options: LanguageOptions = DEFAULT_LANGUAGE_OPTIONS): Suggestion[] {
  if (tokens.length === 0) return [];
  let variants: Variant[];
  try {
    variants = build(tokens, options.contractions);
  } catch {
    // A rule that fails must never take the person's voice away.
    variants = [];
  }
  const exact = literal(tokens).toLowerCase();
  const seen = new Set<string>([exact]);
  const out: Suggestion[] = [];
  for (const variant of variants) {
    const text = finish(variant.text, variant.end);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push({ text, kind: variant.kind, source: 'rules' });
    if (out.length >= options.max) break;
  }
  return out;
}
