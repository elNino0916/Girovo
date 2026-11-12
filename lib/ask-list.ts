// Girovo AI: answers that are lists (components/insights/ask/ListAnswer.tsx).
// A ranking ("In welchen Restaurants war ich im August?") shows every place
// or category, the first few at once and the rest on a press; a list ("Zeig
// alle Zahlungen an Amazon") shows the newest bookings. What is said above
// them, and how many rows show, is decided here.
//
// Pure: no path aliases, `.ts` on sibling imports.

import type { AskQuery } from './nano-ask.ts';

/** How many rows of a ranking show before "Alle N zeigen". */
export const RANK_SHOWN = 8;

/** The sentence a ranking's line is said with (lib/i18n/messages/ask.ts list.rank). */
export type RankWords = 'dining' | 'shops' | 'payeeOut' | 'payeeIn' | 'categoryOut' | 'categoryIn';

/** Restaurants, shops, payees or categories, money out or in: which words a ranking is said in. */
export function rankWords(q: AskQuery): RankWords {
  const into = q.dir === 'in' || q.category === 'income';
  if (q.rank?.by === 'category') return into ? 'categoryIn' : 'categoryOut';
  if (into) return 'payeeIn';
  if (q.category === 'dining') return 'dining';
  if (q.category === 'groceries' || q.category === 'shopping') return 'shops';
  return 'payeeOut';
}

/** The rows a ranking shows (the first RANK_SHOWN until opened, then all) and how many it has in all when it hides some. */
export function rankShown<T>(rows: readonly T[], open: boolean): { rows: readonly T[]; hidden: number } {
  if (rows.length <= RANK_SHOWN) return { rows, hidden: 0 };
  return open ? { rows, hidden: 0 } : { rows: rows.slice(0, RANK_SHOWN), hidden: rows.length - RANK_SHOWN };
}

/** The sentence a list's line is said with (lib/i18n/messages/ask.ts list), and whether it names the total. */
export function listWords(q: AskQuery): { words: 'withName' | 'withCategory' | 'plain'; total: boolean } {
  // Money out and in together make no total worth saying.
  const total = q.dir !== 'all';
  return { words: q.search ? 'withName' : q.category ? 'withCategory' : 'plain', total };
}
