// What a category guess for the bookings the keyword rules miss looks like,
// whichever model makes it: e5 on the desktop (lib/category-model.ts), Gemini
// Nano on Android (lib/nano-categories.ts, mobile/server/categories.ts). Kept
// apart from both so neither drags the other's runtime into its bundle.

import type { CategoryId } from './categories.ts';

/** The categories a guess may name — the spending ones. */
export type GuessableCategory = Extract<CategoryId,
  'housing' | 'groceries' | 'mobility' | 'shopping' | 'leisure' | 'media' | 'health' | 'insurance' | 'taxes' | 'savings'>;

export const GUESSABLE: GuessableCategory[] = [
  'housing', 'groceries', 'mobility', 'shopping', 'leisure', 'media', 'health', 'insurance', 'taxes', 'savings',
];

/** A counterparty to guess for: its key (lib/categories.ts counterpartyKey), name and Verwendungszweck. */
export type GuessItem = { key: string; name: string; purpose?: string | null };
/** A counterparty the user filed by rule, as the model's example. */
export type GuessExample = { name: string; category: GuessableCategory };
