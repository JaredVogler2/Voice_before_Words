/**
 * "My phrases": the sentences a person keeps coming back to.
 *
 * Favourites are chosen on purpose and never dropped. After them come the
 * sentences said most often, then the most recent. All of it is worked out from
 * what is kept in this browser; nothing is sent anywhere.
 */

export interface SpokenLine {
  text: string;
  at: number;
}

export interface Phrase {
  text: string;
  /** Kept on purpose as a favourite. */
  saved: boolean;
  /** How many times it has been said (as far back as the history goes). */
  count: number;
}

export const MAX_FAVOURITES = 40;

export function phraseBoard(history: SpokenLine[], saved: string[], limit = 40): Phrase[] {
  const counts = new Map<string, number>();
  const lastSaid = new Map<string, number>();
  history.forEach((item, index) => {
    counts.set(item.text, (counts.get(item.text) ?? 0) + 1);
    lastSaid.set(item.text, index);
  });
  const out: Phrase[] = saved.map((text) => ({ text, saved: true, count: counts.get(text) ?? 0 }));
  const taken = new Set(saved);
  const rest = Array.from(counts.keys()).filter((text) => !taken.has(text));
  // Said more than once: by how often. Then everything else, newest first.
  const often = rest.filter((text) => counts.get(text)! >= 2).sort((a, b) => counts.get(b)! - counts.get(a)! || lastSaid.get(b)! - lastSaid.get(a)!);
  const recent = rest.filter((text) => counts.get(text)! < 2).sort((a, b) => lastSaid.get(b)! - lastSaid.get(a)!);
  for (const text of [...often, ...recent]) out.push({ text, saved: false, count: counts.get(text)! });
  return out.slice(0, Math.max(limit, saved.length));
}

/** A list of favourites from a backup file, made safe to load. */
export function cleanFavourites(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const text = item.replace(/\s+/g, ' ').trim().slice(0, 240);
    if (text && !out.includes(text)) out.push(text);
  }
  return out.slice(0, MAX_FAVOURITES);
}
