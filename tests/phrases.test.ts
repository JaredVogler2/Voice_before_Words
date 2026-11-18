import { describe, expect, test } from 'vitest';
import { cleanFavourites, phraseBoard } from '../src/state/phrases';

const said = (...texts: string[]) => texts.map((text, index) => ({ text, at: index }));

describe('my phrases', () => {
  test('favourites come first, then what is said most, then the most recent', () => {
    const history = said('I am hungry.', 'Yes.', 'I need help.', 'Yes.', 'I am hungry.', 'Yes.', 'Good night.', 'Thank you.');
    const board = phraseBoard(history, ['Good night.']);
    expect(board.map((item) => item.text)).toEqual(['Good night.', 'Yes.', 'I am hungry.', 'Thank you.', 'I need help.']);
    expect(board[0]).toEqual({ text: 'Good night.', saved: true, count: 1 });
    expect(board[1]).toEqual({ text: 'Yes.', saved: false, count: 3 });
  });

  test('a favourite stays even when it has dropped out of the history, and each sentence appears once', () => {
    const board = phraseBoard(said('Yes.', 'Yes.'), ['My name is Sam.', 'Yes.']);
    expect(board).toEqual([
      { text: 'My name is Sam.', saved: true, count: 0 },
      { text: 'Yes.', saved: true, count: 2 },
    ]);
  });

  test('the list is capped, but never cuts off a favourite', () => {
    const history = said(...Array.from({ length: 60 }, (_, index) => `Sentence ${index}.`));
    expect(phraseBoard(history, [], 10)).toHaveLength(10);
    const favourites = Array.from({ length: 12 }, (_, index) => `Favourite ${index}.`);
    expect(phraseBoard(history, favourites, 10)).toHaveLength(12);
  });

  test('favourites from a backup file are cleaned before use', () => {
    expect(cleanFavourites(['  Hello   there. ', 'Hello there.', 42, '', null, 'Bye.'])).toEqual(['Hello there.', 'Bye.']);
    expect(cleanFavourites('not a list')).toEqual([]);
    expect(cleanFavourites(Array.from({ length: 80 }, (_, index) => `Line ${index}`))).toHaveLength(40);
  });
});
