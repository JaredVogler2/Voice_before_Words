import { allWords, getWord } from '../vocab/lexicon';
import type { Word } from '../vocab/types';
import type { Token } from './types';

/**
 * Next-word prediction.
 *
 * Two sources are blended:
 *  - what generally follows what in everyday speech (the tables below), and
 *  - what *this person* tends to say next, learned on the device from their own
 *    choices and never sent anywhere.
 *
 * Prediction only ever proposes tiles to tap. It does not add words to the
 * message by itself.
 */

/** Counts of single words and of word pairs. `^` stands for the start of a message. */
export interface UsageModel {
  unigram: Record<string, number>;
  bigram: Record<string, Record<string, number>>;
}

export const START = '^';

export function emptyUsage(): UsageModel {
  return { unigram: {}, bigram: {} };
}

/** Record a spoken message. Returns a new model; the input is not changed. */
export function learn(usage: UsageModel, ids: string[]): UsageModel {
  const unigram = { ...usage.unigram };
  const bigram: UsageModel['bigram'] = { ...usage.bigram };
  let previous = START;
  for (const id of ids) {
    if (id.startsWith('text:')) {
      previous = id;
      continue;
    }
    unigram[id] = (unigram[id] ?? 0) + 1;
    bigram[previous] = { ...(bigram[previous] ?? {}), [id]: (bigram[previous]?.[id] ?? 0) + 1 };
    previous = id;
  }
  return { unigram, bigram };
}

function list(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** Good ways to begin. */
const STARTERS = list('i want more help stop you go like what where need not can my it eat drink play');

/** What tends to follow particular words. */
const AFTER: Record<string, string[]> = {
  i: list('want need like feel go have dont can see know think love eat play'),
  you: list('want like can help go have know see need come look'),
  it: list('is hurt not good bad fall break hot cold big'),
  he: list('want is go like have not say can'),
  she: list('want is go like have not say can'),
  we: list('go can play eat want need have'),
  they: list('go want play have like not'),
  my: list('turn mom dad phone tablet head tummy friend room bed blanket name talker'),
  your: list('turn name mom dad phone'),
  this: list('is mine good bad funny not'),
  that: list('is mine good bad funny not'),
  want: list('more to eat drink go play that it water help watch sleep hug not'),
  need: list('help bathroom break more to water medicine sleep rest it'),
  like: list('it that this you to play eat music pizza'),
  love: list('you it mom dad that'),
  go: list('home outside bathroom to school park store bed now again'),
  come: list('here now with home'),
  eat: list('more pizza cookie apple sandwich lunch dinner breakfast snack now'),
  drink: list('water milk juice more now'),
  play: list('outside with game ball more music now again'),
  watch: list('tv movie video tv-show cartoon'),
  listen: list('music song story'),
  read: list('book story'),
  feel: list('happy sad tired sick angry scared good bad hungry'),
  help: list('me please now mom dad'),
  give: list('me it that more mom'),
  get: list('it that more me'),
  put: list('it here there on in'),
  look: list('this that here me'),
  see: list('it that you mom dog'),
  have: list('it more that pain headache'),
  open: list('it door this that'),
  'turn-on': list('tv light music it'),
  'turn-off': list('tv light music it'),
  not: list('want like now good go know that'),
  dont: list('want like know touch go'),
  more: list('juice water cookie food please music'),
  what: list('is that you time do happen'),
  where: list('is mom dad you my bathroom go'),
  who: list('is that you'),
  when: list('we lunch go home'),
  why: list('not you'),
  how: list('you many big'),
  can: list('i you we'),
  is: list('it that mom he she'),
  and: list('i you mom dad then'),
  to: list('go eat play home school bed'),
  in: list('the my here bed car'),
  on: list('the my table tv'),
  with: list('me you mom dad friend'),
  very: list('happy sad tired good bad hot cold'),
  hello: list('mom dad friend teacher'),
  'thank-you': list('mom dad'),
  yes: list('please i'),
  no: list('thank-you more i'),
  please: list('help more'),
};

/** What tends to follow a kind of word, when the word itself has no entry. */
function afterKind(word: Word): string[] {
  switch (word.pos) {
    case 'pronoun':
      return word.possessive ? AFTER.my : AFTER.i;
    case 'verb':
      if (word.verb === 'motion') return AFTER.go;
      if (word.verb === 'want') return AFTER.want;
      if (word.verb === 'feel') return AFTER.feel;
      return list('it that more now again with please me');
    case 'noun':
      if (word.person) return list('is want go help not happy here come');
      return list('please and now more again is not');
    case 'adj':
      return list('and but because now not very');
    case 'question':
      return AFTER.what;
    case 'det':
      return AFTER.more;
    case 'neg':
      return AFTER.not;
    case 'aux':
      return AFTER.can;
    case 'prep':
      return list('the my me you here there');
    case 'conj':
      return AFTER.and;
    default:
      return STARTERS;
  }
}

/** Every id the tables mention, so a test can check none has gone stale. */
export function predictionTableIds(): string[] {
  const ids = new Set<string>(STARTERS);
  for (const [key, values] of Object.entries(AFTER)) {
    ids.add(key);
    values.forEach((id) => ids.add(id));
  }
  return Array.from(ids);
}

let knownIds: Set<string> | undefined;
function isKnown(id: string): boolean {
  knownIds ??= new Set(allWords().map((word) => word.id));
  return knownIds.has(id);
}

/**
 * The most likely next words, best first.
 * @param isAvailable lets the caller leave out hidden words and include ones the person added.
 */
export function predictNext(
  tokens: Token[],
  usage: UsageModel,
  count: number,
  isAvailable: (id: string) => boolean = isKnown,
): string[] {
  const last = tokens[tokens.length - 1];
  const previous = last ? last.id : START;
  const scores = new Map<string, number>();
  const bump = (id: string, amount: number) => {
    if (!isAvailable(id)) return;
    scores.set(id, (scores.get(id) ?? 0) + amount);
  };

  // General knowledge: earlier in the list means more likely.
  let general: string[];
  if (!last) general = STARTERS;
  else if (AFTER[previous]) general = AFTER[previous];
  else {
    const word = last.word ?? getWord(previous);
    general = word ? afterKind(word) : list('is and please now');
  }
  general.forEach((id, index) => bump(id, 10 - index * 0.5));

  // Personal habits: what this person has said right after this word before.
  const follows = usage.bigram[previous];
  if (follows) {
    const total = Object.values(follows).reduce((sum, n) => sum + n, 0);
    for (const [id, n] of Object.entries(follows)) bump(id, 6 * Math.log2(1 + n) + 8 * (n / total));
  }
  // A gentle preference for words used often in general.
  for (const id of Array.from(scores.keys())) {
    const used = usage.unigram[id];
    if (used) bump(id, Math.min(2, Math.log10(1 + used)));
  }

  // Do not offer the word just chosen, or ready-made phrases.
  if (last) scores.delete(previous);
  return Array.from(scores.entries())
    .filter(([id]) => !id.startsWith('ph-'))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, count)
    .map(([id]) => id);
}
