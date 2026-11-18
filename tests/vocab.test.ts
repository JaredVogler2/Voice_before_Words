import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { allBoards, categoryBoards, getBoard, HOME_BOARD } from '../src/vocab/boards';
import { allWords, getWord } from '../src/vocab/lexicon';
import symbolMap from '../src/vocab/symbols.json';

const SYMBOLS: Record<string, string> = symbolMap;
const symbolDir = join(__dirname, '..', 'public', 'symbols');

describe('the vocabulary', () => {
  const words = allWords();

  test('is a substantial, well-formed word list', () => {
    expect(words.length).toBeGreaterThan(800);
    const ids = new Set<string>();
    for (const word of words) {
      expect(word.id).toMatch(/^[a-z0-9-]+$/);
      expect(ids.has(word.id), `duplicate id ${word.id}`).toBe(false);
      ids.add(word.id);
      expect(word.label.trim()).not.toBe('');
      expect(word.text.trim()).not.toBe('');
    }
  });

  test('nouns say how they take "a", "some" or "the"; verbs say what kind they are', () => {
    for (const word of words) {
      if (word.pos === 'noun') expect(word.noun, word.id).toBeDefined();
      if (word.pos === 'verb') expect(word.verb, word.id).toBeDefined();
      if (word.pos === 'phrase') expect(word.speakNow, word.id).toBe(true);
    }
  });

  test('includes the words people need to keep themselves safe', () => {
    for (const id of ['stop', 'no', 'help', 'hurt', 'pain', 'scared', 'private-parts', 'touch', 'dont', 'ph-someone-hurt-me', 'ph-stop-it', 'ph-i-dont-like-that', 'ph-tell-you-something', 'ph-leave-me-alone']) {
      expect(getWord(id), id).toBeDefined();
    }
  });
});

describe('boards', () => {
  test('every word can be reached from some board', () => {
    const reachable = new Set<string>();
    for (const board of allBoards()) for (const item of board.items) if (item.kind === 'word') reachable.add(item.id);
    const unreachable = allWords().filter((word) => !reachable.has(word.id)).map((word) => word.id);
    expect(unreachable).toEqual([]);
  });

  test('boards only refer to words and boards that exist, with no word listed twice', () => {
    for (const board of allBoards()) {
      expect(board.items.length, board.id).toBeGreaterThan(0);
      const seen = new Set<string>();
      for (const item of board.items) {
        if (item.kind === 'word') {
          expect(getWord(item.id), `${board.id}: ${item.id}`).toBeDefined();
          expect(seen.has(item.id), `${board.id}: ${item.id} twice`).toBe(false);
          seen.add(item.id);
        } else {
          expect(getBoard(item.board), `${board.id}: ${item.board}`).toBeDefined();
        }
      }
      expect(getWord(board.icon), `${board.id} icon`).toBeDefined();
    }
  });

  test('the home board leads with the most useful core words', () => {
    const home = getBoard(HOME_BOARD)!;
    const first = home.items.slice(0, 9).map((item) => (item.kind === 'word' ? item.id : ''));
    // Even a 3 x 3 eye-gaze grid starts with these.
    expect(first).toEqual(['i', 'want', 'more', 'help', 'stop', 'yes', 'no', 'go', 'like']);
    expect(home.autoReturn).toBe(false);
    for (const board of categoryBoards()) expect(board.autoReturn).toBe(true);
  });
});

describe('symbols', () => {
  test('every mapped picture exists in the bundle, and nothing is bundled that is not used', () => {
    const used = new Set(Object.values(SYMBOLS));
    for (const key of used) expect(existsSync(join(symbolDir, `${key}.svg`)), key).toBe(true);
    const bundled: string[] = [];
    for (const set of ['m', 'o', 'x']) for (const file of readdirSync(join(symbolDir, set))) bundled.push(`${set}/${file.replace(/\.svg$/, '')}`);
    expect(bundled.filter((key) => !used.has(key))).toEqual([]);
  });

  test('symbols are mapped only to words that exist', () => {
    for (const id of Object.keys(SYMBOLS)) expect(getWord(id), id).toBeDefined();
  });

  test('nearly every word has a picture, and every content word a non-reader needs does', () => {
    const without = allWords().filter((word) => !SYMBOLS[word.id]);
    expect(without.length).toBeLessThan(60);
    for (const pos of ['pronoun', 'question', 'social', 'phrase', 'num']) {
      expect(without.filter((word) => word.pos === pos).map((word) => word.id), pos).toEqual([]);
    }
    for (const word of allBoards().find((board) => board.id === HOME_BOARD)!.items.slice(0, 40)) {
      if (word.kind !== 'word') continue;
      const entry = getWord(word.id)!;
      const grammarOnly = ['det', 'prep', 'conj', 'aux'].includes(entry.pos);
      if (!grammarOnly) expect(SYMBOLS[word.id], word.id).toBeDefined();
    }
  });

  test('bundled pictures are valid, scalable SVG', () => {
    for (const key of Object.values(SYMBOLS).slice(0, 80)) {
      const svg = readFileSync(join(symbolDir, `${key}.svg`), 'utf8');
      expect(svg.startsWith('<svg'), key).toBe(true);
      expect(svg, key).toContain('viewBox');
      expect(svg, key).not.toMatch(/<script|onload=|javascript:/i);
    }
  });

  test('the symbols carry their licence and credits', () => {
    const text = readFileSync(join(symbolDir, 'ATTRIBUTION.md'), 'utf8');
    expect(text).toContain('CC BY-SA 4.0');
    expect(text).toContain('Steve Lee');
    expect(text).toContain('Otsimo');
  });
});
