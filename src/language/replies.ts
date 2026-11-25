import type { SuggestionKind, SuggestionSource } from './types';

/**
 * Replies to offer when someone has just spoken to the person, made on the
 * device with no AI.
 *
 * It does not try to understand the sentence. It recognises the kind of thing
 * that was said (a yes-or-no question, a choice between two things, "what do
 * you want to eat?") and offers the handful of answers that kind usually gets,
 * or a head start towards the right board. The person still chooses, and the
 * whole board is still there if none of them fits.
 */

export interface Reply {
  /** What is spoken, or for a starter, what is shown ("I want …"). */
  text: string;
  kind: SuggestionKind;
  source: SuggestionSource;
  /**
   * A starter is not spoken. It puts these words in the message and opens a
   * board, so one more choice finishes the sentence ("I want" + Food).
   */
  start?: { words: string[]; board: string };
}

const say = (text: string, kind: SuggestionKind = 'say'): Reply => ({ text, kind, source: 'rules' });
const start = (text: string, words: string[], board: string, kind: SuggestionKind = 'want'): Reply => ({ text, kind, source: 'rules', start: { words, board } });

/** Lower case, plain apostrophes, no punctuation: recognisers and typists differ on all three. */
export function normalise(heard: string): string {
  return heard
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const AUXILIARY = /^(do|does|did|are|is|was|were|am|can|could|will|would|should|shall|may|might|have|has|had|don't|doesn't|didn't|aren't|isn't|can't|won't|wouldn't|shouldn't)\b/;
/** An offer or a request for permission, where the usual answers are "Yes, please" and "No, thank you". */
const OFFER = /\b(want|wanna|need|ready)\b|\bwould you like\b|^(can|could|may|shall|should) (i|we)\b/;
/** Words that end an option when reading backwards from "or": "do you want [cereal] or toast". */
const BEFORE_OPTION = new Set(['want', 'wanna', 'like', 'have', 'prefer', 'need', 'get', 'eat', 'drink', 'play', 'wear', 'watch', 'read', 'do', 'be', 'is', 'it', 'you', 'to', 'go', 'feel', 'feeling', 'pick', 'choose', 'take', 'try', 'for', 'with', 'on', 'in', 'at']);
const LEADING = new Set(['a', 'an', 'the', 'some', 'to']);

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The two things on offer in "… cereal or toast", or null when it is not that kind of question. */
export function choiceOf(heard: string): [string, string] | null {
  const words = normalise(heard).split(' ');
  const at = words.lastIndexOf('or');
  if (at < 1 || at >= words.length - 1) return null;
  // "or not", "or what", "or something" are not a second option.
  if (['not', 'what', 'something', 'anything', 'no'].includes(words[at + 1])) return null;

  const left: string[] = [];
  for (let i = at - 1; i >= 0 && left.length < 3; i--) {
    if (BEFORE_OPTION.has(words[i])) break;
    left.unshift(words[i]);
  }
  const right = words.slice(at + 1, at + 4);
  while (left.length > 1 && LEADING.has(left[0])) left.shift();
  while (right.length > 1 && LEADING.has(right[0])) right.shift();
  if (left.length === 0 || right.length === 0) return null;
  const a = left.join(' ');
  const b = right.join(' ');
  if (a === b) return null;
  return [a, b];
}

export interface ReplyOptions {
  /** The person's name from "About me", for "What's your name?". */
  name?: string;
  contractions?: boolean;
  max?: number;
}

/** Replies for what was just said to the person, most useful first. Empty when nothing was said. */
export function localReplies(heard: string, options: ReplyOptions = {}): Reply[] {
  const q = normalise(heard);
  if (!q) return [];
  const short = options.contractions !== false;
  const max = options.max ?? 4;
  const im = short ? "I'm" : 'I am';
  const dont = short ? "don't" : 'do not';
  const unsure = say(`I ${dont} know.`);
  const out: Reply[] = [];
  const add = (...replies: Reply[]) => {
    for (const reply of replies) if (!out.some((item) => item.text === reply.text)) out.push(reply);
  };

  const choice = choiceOf(heard);

  if (/^(hi|hello|hey|good (morning|afternoon|evening))\b/.test(q) && q.split(' ').length <= 4) {
    const greeting = q.match(/^good (morning|afternoon|evening)/);
    add(say(greeting ? `${capital(greeting[0])}.` : 'Hello.'), say('How are you?', 'ask'));
  }
  if (/\b(thank you|thanks)\b/.test(q)) add(say(short ? "You're welcome." : 'You are welcome.'));
  if (/\b(bye|goodbye|see you|good night|goodnight)\b/.test(q)) add(say(/night/.test(q) ? 'Good night.' : 'Goodbye.'), say('See you later.'));
  if (/\bwhat('s| is) your name\b/.test(q) && options.name?.trim()) add(say(`My name is ${options.name.trim()}.`));

  if (/\bhow (are|r) (you|u)\b|\bhow're you\b|\bhow (do|are) you feel|\bhow('s| is) it going\b/.test(q)) {
    add(say(`${im} good.`), say(`${im} okay.`), start('I feel …', ['i', 'feel'], 'feelings', 'say'), say(`I ${dont} feel well.`));
  } else if (/\b(what('s| is) (wrong|the matter)|what hurts|where does it hurt|does (it|anything) hurt|are you (hurt|in pain|sick|okay|ok|all right|alright))\b/.test(q)) {
    add(say(`${im} okay.`), start('It hurts here …', [], 'body', 'say'), say(`I ${dont} feel well.`), say('I need help.', 'want'));
  } else if (choice) {
    add(say(`${capital(choice[0])}.`), say(`${capital(choice[1])}.`), say('Neither.'), unsure);
  } else if (/\b(what|anything|something)\b.*\b(eat|breakfast|lunch|dinner|supper|snack)\b|\b(are|r) you hungry\b/.test(q)) {
    add(start('I want … (food)', ['i', 'want'], 'food'), say(`${im} not hungry.`), unsure);
  } else if (/\b(what|anything|something)\b.*\bdrink\b|\b(are|r) you thirsty\b/.test(q)) {
    add(start('I want … (drinks)', ['i', 'want'], 'drinks'), say(`${im} not thirsty.`), unsure);
  } else if (/\bwhere\b.*\b(go|going)\b/.test(q)) {
    add(start('I want to go … (places)', ['i', 'want', 'go'], 'places'), say('Nowhere.'), unsure);
  } else if (/^where\b|\bwhere (is|are|did|do|does|was|were)\b/.test(q)) {
    add(start('… (places)', [], 'places', 'say'), unsure);
  } else if (/^who\b|\bwho (is|are|did|do|does|was|were|would)\b/.test(q)) {
    add(start('… (people)', [], 'people', 'say'), unsure);
  } else if (/^when\b|\bwhat time\b/.test(q)) {
    add(start('… (time)', [], 'time', 'say'), say('Now.'), say('Later.'), unsure);
  } else if (/\bwhat colou?r\b/.test(q)) {
    add(start('… (colors)', [], 'colors', 'say'), unsure);
  } else if (/\bwhat\b.*\b(want to|wanna|like to) (do|play)\b/.test(q)) {
    add(start('I want to … (actions)', ['i', 'want'], 'actions'), say('Nothing.'), unsure);
  } else if (AUXILIARY.test(q)) {
    // A yes-or-no question. Both answers are always offered: the app never picks a side.
    if (OFFER.test(q)) add(say('Yes, please.'), say('No, thank you.'), say('Maybe later.'), unsure);
    else add(say('Yes.'), say('No.'), say('Maybe.'), unsure);
  }

  if (out.length === 0) {
    // Not recognised: a question gets "I don't know", a statement gets "Okay".
    const question = /\?\s*$/.test(heard) || /^(what|why|how|which)\b/.test(q);
    if (question) add(unsure, say('Please say that again.', 'tell'), say('Yes.'), say('No.'));
    else add(say('Okay.'), say('No.'), say('Please say that again.', 'tell'), unsure);
  }
  return out.slice(0, max);
}
