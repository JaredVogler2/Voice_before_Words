import { describe, expect, test } from 'vitest';
import { choiceOf, localReplies, normalise } from '../src/language/replies';
import { getWord } from '../src/vocab/lexicon';
import { categoryBoards } from '../src/vocab/boards';

const texts = (heard: string, options = {}) => localReplies(heard, options).map((reply) => reply.text);

describe('replies made on the device', () => {
  test('nothing said, nothing offered', () => {
    expect(localReplies('')).toEqual([]);
    expect(localReplies('   ?!')).toEqual([]);
  });

  test('a yes-or-no question always gets both a yes and a no', () => {
    for (const heard of ['Are you tired?', 'did you sleep well', 'Is it too loud', "Can you see the screen?", "don't you like it"]) {
      const out = texts(heard);
      expect(out, heard).toContain('Yes.');
      expect(out, heard).toContain('No.');
      expect(out.indexOf('Yes.'), heard).toBeLessThan(2);
      expect(out.indexOf('No.'), heard).toBeLessThan(2);
    }
  });

  test('an offer gets polite answers, still both ways', () => {
    expect(texts('Do you want some juice?').slice(0, 2)).toEqual(['Yes, please.', 'No, thank you.']);
    expect(texts('would you like to go outside').slice(0, 2)).toEqual(['Yes, please.', 'No, thank you.']);
  });

  test('a choice between two things offers each of them', () => {
    expect(choiceOf('Do you want cereal or toast?')).toEqual(['cereal', 'toast']);
    expect(choiceOf('Would you like the red one or the blue one')).toEqual(['red one', 'blue one']);
    expect(choiceOf('do you want to go to the park or stay home')).toEqual(['park', 'stay home']);
    expect(texts('Do you want cereal or toast?')).toEqual(['Cereal.', 'Toast.', 'Neither.', "I don't know."]);
  });

  test('"or not" and "or something" are not a second choice', () => {
    expect(choiceOf('Are you coming or not?')).toBeNull();
    expect(choiceOf('do you want a snack or something')).toBeNull();
    expect(texts('Are you coming or not?')).toContain('Yes.');
  });

  test('"what do you want to eat" gives a head start to the food board, not a guess', () => {
    const out = localReplies('What do you want to eat?');
    expect(out[0]).toMatchObject({ text: 'I want … (food)', start: { words: ['i', 'want'], board: 'food' } });
    expect(texts('What do you want to eat?')).toContain("I'm not hungry.");
    expect(localReplies('what would you like to drink')[0].start).toEqual({ words: ['i', 'want'], board: 'drinks' });
    expect(localReplies('Are you hungry?')[0].start?.board).toBe('food');
  });

  test('where, who, when and how-are-you lead to the right words', () => {
    expect(localReplies('Where do you want to go?')[0].start).toEqual({ words: ['i', 'want', 'go'], board: 'places' });
    expect(localReplies('Who did you see today?')[0].start?.board).toBe('people');
    expect(localReplies('When is it?')[0].start?.board).toBe('time');
    expect(texts('How are you?').slice(0, 2)).toEqual(["I'm good.", "I'm okay."]);
    expect(localReplies('how are you feeling').some((reply) => reply.start?.board === 'feelings')).toBe(true);
    expect(localReplies("What's wrong?").some((reply) => reply.start?.board === 'body')).toBe(true);
  });

  test('every starter uses words and boards that exist', () => {
    const boards = new Set(categoryBoards().map((board) => board.id));
    const samples = ['What do you want to eat?', 'what do you want to drink', 'Where do you want to go?', 'Where is it?', 'Who is that?', 'When?', 'What colour is it?', 'What do you want to do?', 'How are you?', "What's the matter?"];
    for (const heard of samples) {
      for (const reply of localReplies(heard, { max: 9 })) {
        if (!reply.start) continue;
        expect(boards.has(reply.start.board), `${heard}: board ${reply.start.board}`).toBe(true);
        for (const id of reply.start.words) expect(getWord(id), `${heard}: word ${id}`).toBeTruthy();
      }
    }
  });

  test('greetings, thanks and goodbyes get the usual answer', () => {
    expect(texts('Hello')[0]).toBe('Hello.');
    expect(texts('Good morning!')[0]).toBe('Good morning.');
    expect(texts('Thank you')[0]).toBe("You're welcome.");
    expect(texts('Good night')[0]).toBe('Good night.');
  });

  test('uses the name from "About me" when asked for it, and only then', () => {
    expect(texts("What's your name?", { name: 'Sam' })[0]).toBe('My name is Sam.');
    expect(texts("What's your name?").join(' ')).not.toContain('My name');
  });

  test('something it does not recognise still gets a way to answer', () => {
    expect(texts('Why is the sky blue?')).toEqual(["I don't know.", 'Please say that again.', 'Yes.', 'No.']);
    expect(texts('Time for bed')).toEqual(['Okay.', 'No.', 'Please say that again.', "I don't know."]);
  });

  test('respects the no-contractions setting and the limit', () => {
    expect(texts('How are you?', { contractions: false }).slice(0, 2)).toEqual(['I am good.', 'I am okay.']);
    expect(texts('Why?', { contractions: false })[0]).toBe('I do not know.');
    expect(localReplies('Are you okay?', { max: 2 })).toHaveLength(2);
  });

  test('recognisers and typists differ on case, apostrophes and punctuation', () => {
    expect(normalise('  What’s   WRONG?! ')).toBe("what's wrong");
    expect(texts('WHAT DO YOU WANT TO EAT')).toEqual(texts('what do you want to eat?'));
  });
});
