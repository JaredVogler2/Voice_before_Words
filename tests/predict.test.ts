import { describe, expect, test } from 'vitest';
import { emptyUsage, learn, predictNext, predictionTableIds, START } from '../src/language/predict';
import { getWord } from '../src/vocab/lexicon';
import { t } from './helpers';

describe('next-word prediction', () => {
  test('every word the tables mention exists in the vocabulary', () => {
    const missing = predictionTableIds().filter((id) => !getWord(id));
    expect(missing).toEqual([]);
  });

  test('an empty message offers good ways to begin', () => {
    const next = predictNext([], emptyUsage(), 6);
    expect(next).toHaveLength(6);
    expect(next.slice(0, 3)).toEqual(['i', 'want', 'more']);
  });

  test('what follows depends on the last word', () => {
    expect(predictNext(t('i'), emptyUsage(), 4)).toContain('want');
    expect(predictNext(t('i want eat'), emptyUsage(), 8)).toContain('pizza');
    expect(predictNext(t('i go'), emptyUsage(), 6)).toContain('bathroom');
    expect(predictNext(t('i feel'), emptyUsage(), 6)).toContain('tired');
    expect(predictNext(t('where'), emptyUsage(), 6)).toContain('mom');
  });

  test('words with no entry of their own still get sensible followers', () => {
    expect(predictNext(t('grandma'), emptyUsage(), 6)).toContain('is');
    expect(predictNext(t('walk'), emptyUsage(), 6)).toContain('home');
    expect(predictNext(t('i want "Rex"'), emptyUsage(), 4).length).toBeGreaterThan(0);
  });

  test('the word just chosen is not offered again, and phrases are never offered', () => {
    for (const spec of ['more', 'i', 'want', 'go']) {
      const next = predictNext(t(spec), emptyUsage(), 12);
      expect(next).not.toContain(spec);
      expect(next.some((id) => id.startsWith('ph-'))).toBe(false);
    }
  });

  test('it learns what this person says', () => {
    let usage = emptyUsage();
    expect(predictNext(t('i want'), usage, 3)).not.toContain('yogurt');
    for (let i = 0; i < 4; i++) usage = learn(usage, ['i', 'want', 'yogurt']);
    expect(predictNext(t('i want'), usage, 3)[0]).toBe('yogurt');
    // and learns how they like to begin
    for (let i = 0; i < 6; i++) usage = learn(usage, ['mom', 'come']);
    expect(predictNext([], usage, 3)).toContain('mom');
    expect(usage.bigram[START].mom).toBe(6);
  });

  test('learning does not change the model it was given, and skips typed words', () => {
    const before = emptyUsage();
    const after = learn(before, ['i', 'text:Rex', 'happy']);
    expect(before).toEqual(emptyUsage());
    expect(after.unigram).toEqual({ i: 1, happy: 1 });
    expect(after.bigram['text:Rex']).toEqual({ happy: 1 });
  });

  test('only available words are offered', () => {
    const next = predictNext(t('i'), emptyUsage(), 20, (id) => id !== 'want');
    expect(next).not.toContain('want');
    expect(next.length).toBeGreaterThan(3);
  });
});
