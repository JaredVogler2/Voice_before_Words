/**
 * English word forms: verb inflection, plurals, a/an and capitalisation.
 *
 * Deliberately table-plus-rules rather than a general NLP library: the app must
 * work offline on a phone, and a small, tested set of rules is predictable in a
 * way that matters when the output is someone's voice.
 */

/** [past, past participle, third person singular?, -ing form?] */
const IRREGULAR_VERBS: Record<string, [string, string, string?, string?]> = {
  be: ['was', 'been', 'is', 'being'],
  have: ['had', 'had', 'has'],
  do: ['did', 'done', 'does'],
  go: ['went', 'gone', 'goes'],
  eat: ['ate', 'eaten'],
  drink: ['drank', 'drunk'],
  sleep: ['slept', 'slept'],
  come: ['came', 'come'],
  run: ['ran', 'run'],
  drive: ['drove', 'driven'],
  ride: ['rode', 'ridden'],
  read: ['read', 'read'],
  sit: ['sat', 'sat'],
  stand: ['stood', 'stood'],
  swim: ['swam', 'swum'],
  sing: ['sang', 'sung'],
  draw: ['drew', 'drawn'],
  write: ['wrote', 'written'],
  choose: ['chose', 'chosen'],
  win: ['won', 'won'],
  lose: ['lost', 'lost'],
  buy: ['bought', 'bought'],
  pay: ['paid', 'paid'],
  leave: ['left', 'left'],
  wear: ['wore', 'worn'],
  build: ['built', 'built'],
  throw: ['threw', 'thrown'],
  catch: ['caught', 'caught'],
  cut: ['cut', 'cut'],
  give: ['gave', 'given'],
  take: ['took', 'taken'],
  get: ['got', 'gotten'],
  make: ['made', 'made'],
  put: ['put', 'put'],
  tell: ['told', 'told'],
  bring: ['brought', 'brought'],
  hold: ['held', 'held'],
  find: ['found', 'found'],
  let: ['let', 'let'],
  keep: ['kept', 'kept'],
  send: ['sent', 'sent'],
  know: ['knew', 'known'],
  see: ['saw', 'seen'],
  hear: ['heard', 'heard'],
  understand: ['understood', 'understood'],
  forget: ['forgot', 'forgotten'],
  hurt: ['hurt', 'hurt'],
  mean: ['meant', 'meant'],
  fall: ['fell', 'fallen'],
  break: ['broke', 'broken'],
  feel: ['felt', 'felt'],
  think: ['thought', 'thought'],
  say: ['said', 'said', 'says'],
  hide: ['hid', 'hidden'],
  wake: ['woke', 'woken'],
  lie: ['lay', 'lain'],
  begin: ['began', 'begun'],
  speak: ['spoke', 'spoken'],
  teach: ['taught', 'taught'],
  sell: ['sold', 'sold'],
  meet: ['met', 'met'],
  fly: ['flew', 'flown', 'flies'],
  grow: ['grew', 'grown'],
  hit: ['hit', 'hit'],
  shut: ['shut', 'shut'],
  spend: ['spent', 'spent'],
  bite: ['bit', 'bitten'],
  blow: ['blew', 'blown'],
  feed: ['fed', 'fed'],
  fight: ['fought', 'fought'],
  shake: ['shook', 'shaken'],
  smell: ['smelled', 'smelled'],
  wish: ['wished', 'wished'],
};

/** Verbs whose final consonant doubles before -ed / -ing. */
const DOUBLING = new Set([
  'stop', 'hug', 'cut', 'put', 'sit', 'run', 'swim', 'win', 'get', 'let', 'forget', 'shop', 'clap',
  'hop', 'skip', 'tap', 'drop', 'plan', 'nap', 'chat', 'pet', 'rub', 'tug', 'grab', 'step', 'jog',
  'beg', 'pop', 'hit', 'set', 'shut', 'spin', 'dig', 'begin', 'stir', 'trip', 'wrap', 'zip', 'hum',
  'nod', 'pat', 'rip', 'tip', 'wag', 'swap', 'scrub', 'spot',
]);

const VOWELS = 'aeiou';

function isVowel(ch: string | undefined): boolean {
  return !!ch && VOWELS.includes(ch);
}

/** Split "turn on" / "brush my teeth" into the verb that inflects and the rest. */
function splitVerb(base: string): [string, string] {
  const space = base.indexOf(' ');
  return space < 0 ? [base, ''] : [base.slice(0, space), base.slice(space)];
}

export function thirdPerson(base: string): string {
  const [head, rest] = splitVerb(base);
  const irregular = IRREGULAR_VERBS[head]?.[2];
  if (irregular) return irregular + rest;
  if (/(s|x|z|ch|sh|o)$/.test(head)) return `${head}es${rest}`;
  if (/[^aeiou]y$/.test(head)) return `${head.slice(0, -1)}ies${rest}`;
  return `${head}s${rest}`;
}

export function pastTense(base: string): string {
  const [head, rest] = splitVerb(base);
  const irregular = IRREGULAR_VERBS[head]?.[0];
  if (irregular) return irregular + rest;
  return regularPast(head) + rest;
}

export function pastParticiple(base: string): string {
  const [head, rest] = splitVerb(base);
  const irregular = IRREGULAR_VERBS[head]?.[1];
  if (irregular) return irregular + rest;
  return regularPast(head) + rest;
}

function regularPast(head: string): string {
  if (head.endsWith('e')) return `${head}d`;
  if (/[^aeiou]y$/.test(head)) return `${head.slice(0, -1)}ied`;
  if (DOUBLING.has(head)) return `${head}${head[head.length - 1]}ed`;
  return `${head}ed`;
}

export function presentParticiple(base: string): string {
  const [head, rest] = splitVerb(base);
  const irregular = IRREGULAR_VERBS[head]?.[3];
  if (irregular) return irregular + rest;
  if (head.endsWith('ie')) return `${head.slice(0, -2)}ying${rest}`;
  if (head.endsWith('e') && !/(ee|ye|oe)$/.test(head) && head !== 'be') return `${head.slice(0, -1)}ing${rest}`;
  if (DOUBLING.has(head)) return `${head}${head[head.length - 1]}ing${rest}`;
  return `${head}ing${rest}`;
}

/** Plural of a noun (regular rules; irregular forms are supplied by the lexicon). */
export function pluralize(noun: string, irregular?: string): string {
  if (irregular) return irregular;
  const lower = noun.toLowerCase();
  if (/(s|x|z|ch|sh)$/.test(lower)) return `${noun}es`;
  if (/[^aeiou]y$/.test(lower)) return `${noun.slice(0, -1)}ies`;
  return `${noun}s`;
}

const AN_EXCEPTIONS = /^(hour|honest|honor|heir)/i;
const A_EXCEPTIONS = /^(uni|use|usu|user|euro|one\b|once\b|ukulele|utensil|u-)/i;

/** "a" or "an" for the word that follows. */
export function indefiniteArticle(next: string): 'a' | 'an' {
  const word = next.trim();
  if (!word) return 'a';
  if (AN_EXCEPTIONS.test(word)) return 'an';
  if (A_EXCEPTIONS.test(word)) return 'a';
  return isVowel(word[0]?.toLowerCase()) ? 'an' : 'a';
}

export function capitalize(text: string): string {
  const index = text.search(/[A-Za-z0-9À-ÿ]/);
  if (index < 0) return text;
  return text.slice(0, index) + text[index].toUpperCase() + text.slice(index + 1);
}

export type Person = 'i' | 'you' | 'third' | 'plural';

/** Present-tense "be" for a subject. */
export function beForm(person: Person, past = false): string {
  if (past) return person === 'i' || person === 'third' ? 'was' : 'were';
  if (person === 'i') return 'am';
  if (person === 'third') return 'is';
  return 'are';
}

/** Present-tense "do" for a subject. */
export function doForm(person: Person, past = false): string {
  if (past) return 'did';
  return person === 'third' ? 'does' : 'do';
}

const NEGATIVE_CONTRACTIONS: Record<string, string> = {
  do: "don't",
  does: "doesn't",
  did: "didn't",
  is: "isn't",
  are: "aren't",
  was: "wasn't",
  were: "weren't",
  can: "can't",
  will: "won't",
  could: "couldn't",
  should: "shouldn't",
  would: "wouldn't",
  have: "haven't",
  has: "hasn't",
};

/** "do" -> "don't" when contractions are on, otherwise "do not" ("cannot" for can). */
export function negate(aux: string, contract: boolean): string {
  if (contract && NEGATIVE_CONTRACTIONS[aux]) return NEGATIVE_CONTRACTIONS[aux];
  if (aux === 'can') return 'cannot';
  return `${aux} not`;
}

const SUBJECT_BE_CONTRACTIONS: Record<string, string> = {
  'i am': "I'm",
  'you are': "you're",
  'he is': "he's",
  'she is': "she's",
  'it is': "it's",
  'we are': "we're",
  'they are': "they're",
  'that is': "that's",
  'there is': "there's",
  'what is': "what's",
  'where is': "where's",
  'who is': "who's",
  'how is': "how's",
  'i will': "I'll",
  'you will': "you'll",
  'he will': "he'll",
  'she will': "she'll",
  'it will': "it'll",
  'we will': "we'll",
  'they will': "they'll",
};

/** "I" + "am" -> "I'm" when that pair has a standard contraction. */
export function contractPair(first: string, second: string): string | null {
  return SUBJECT_BE_CONTRACTIONS[`${first.toLowerCase()} ${second.toLowerCase()}`] ?? null;
}
