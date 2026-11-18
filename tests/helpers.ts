import { getWord } from '../src/vocab/lexicon';
import type { Token } from '../src/language/types';

/**
 * Build a message from a compact string of vocabulary ids, e.g. `t('i go bathroom')`.
 * Words in quotes are typed text rather than tiles: `t('i want "Rex"')`.
 */
export function t(spec: string): Token[] {
  const tokens: Token[] = [];
  for (const part of spec.match(/"[^"]*"|\S+/g) ?? []) {
    if (part.startsWith('"')) {
      const text = part.slice(1, -1);
      tokens.push({ id: `text:${text}`, text });
      continue;
    }
    const word = getWord(part);
    if (!word) throw new Error(`Unknown vocabulary id in test: ${part}`);
    tokens.push({ id: word.id, text: word.text, word });
  }
  return tokens;
}
