import { CATEGORIES_BOARD, HOME_BOARD, categoryBoards, getBoard } from '../vocab/boards';
import { getWord } from '../vocab/lexicon';
import { symbolUrl } from '../vocab/symbols';
import type { Board, BoardItem, ColorKey, Word } from '../vocab/types';
import type { CustomKind, CustomWord, Settings } from './settings';

/**
 * The vocabulary as this person sees it: the built-in words, minus any they
 * have hidden, plus any they have added.
 */

const CUSTOM_GROUP: Record<CustomKind, string> = {
  thing: 'things',
  person: 'people',
  action: 'actions',
  describe: 'describe',
  phrase: 'chat',
};

export function customToWord(custom: CustomWord): Word {
  const base = { id: custom.id, label: custom.label, text: custom.label, group: custom.board || CUSTOM_GROUP[custom.kind], custom: true };
  switch (custom.kind) {
    case 'person':
      // A name: capitalised, no "a" or "the".
      return { ...base, text: custom.label.charAt(0).toUpperCase() + custom.label.slice(1), pos: 'noun', noun: 'proper', person: true };
    case 'action':
      return { ...base, text: custom.label.toLowerCase(), pos: 'verb', verb: 'self' };
    case 'describe':
      return { ...base, text: custom.label.toLowerCase(), pos: 'adj' };
    case 'phrase':
      return { ...base, pos: 'phrase', speakNow: true };
    default:
      return { ...base, text: custom.label.toLowerCase(), pos: 'noun', noun: 'count' };
  }
}

export interface Vocabulary {
  word(id: string): Word | undefined;
  /** Picture for a word: a bundled symbol, a photo the person added, or nothing. */
  image(id: string): string | null;
  board(id: string): Board | undefined;
  isAvailable(id: string): boolean;
  categories(): Board[];
}

export function buildVocabulary(settings: Pick<Settings, 'hiddenWords' | 'customWords'>): Vocabulary {
  const hidden = new Set(settings.hiddenWords);
  const custom = new Map<string, { word: Word; image?: string; board: string }>();
  for (const item of settings.customWords) {
    custom.set(item.id, { word: customToWord(item), image: item.image, board: item.board || CUSTOM_GROUP[item.kind] });
  }
  const word = (id: string) => custom.get(id)?.word ?? getWord(id);
  const boards = new Map<string, Board>();

  const board = (id: string): Board | undefined => {
    const cached = boards.get(id);
    if (cached) return cached;
    const base = getBoard(id);
    if (!base) return undefined;
    let items: BoardItem[] = base.items.filter((item) => item.kind !== 'word' || !hidden.has(item.id));
    if (id !== HOME_BOARD && id !== CATEGORIES_BOARD) {
      // Words the person added come first on their board: they added them because they matter.
      const added: BoardItem[] = [];
      for (const [customId, entry] of custom) if (entry.board === id && !hidden.has(customId)) added.push({ kind: 'word', id: customId });
      items = [...added, ...items];
    }
    const result = { ...base, items };
    boards.set(id, result);
    return result;
  };

  return {
    word,
    image: (id) => custom.get(id)?.image ?? symbolUrl(id),
    board,
    isAvailable: (id) => !hidden.has(id) && !!word(id),
    categories: () => categoryBoards().map((category) => board(category.id)!),
  };
}

/** Which colour family a word's tile takes (the modified Fitzgerald key). */
export function colorOf(word: Word): ColorKey {
  switch (word.pos) {
    case 'pronoun':
      return 'people';
    case 'noun':
      if (word.person) return 'people';
      return word.group === 'time' ? 'time' : 'noun';
    case 'verb':
    case 'aux':
      return 'verb';
    case 'adj':
      return 'describe';
    case 'adv':
      return word.group === 'time' ? 'time' : 'describe';
    case 'question':
      return 'question';
    case 'social':
    case 'phrase':
      return 'social';
    case 'neg':
      return 'negation';
    default:
      return 'little';
  }
}
