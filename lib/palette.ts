// The command palette's order (components/CommandPalette.tsx), kept apart
// from the component so the rules can be tested on their own.
//
// The palette is the dashboard's search: someone types "ab" for Abos or an
// Abbuchung, "lo" for Lohn or Lotto, "me" for Media Markt — and presses
// Enter on whatever sits on top. So an entry that ends something (Abmelden)
// is a last resort: it is left out of every query shorter than three
// characters, and when it matches, it comes after every other result —
// actions, accounts and bookings alike. "abm", "logout" or "abmelden" still
// find it, and it is preselected only when nothing else matches.

import { fuzzyScore } from './fuzzy.ts';

export type PaletteEntry = {
  label: string;
  /** Extra words that find it ("pdf" for Kontoauszug). */
  keywords?: readonly string[];
  /** Identifiers (IBAN, account number): matched as a run of characters, never fuzzily. */
  ids?: readonly string[];
  /** Listed before anything is typed. */
  featured?: boolean;
  /** Ends something rather than opening it — see the header. */
  lastResort?: boolean;
};

/** The shortest query a last-resort entry answers to. */
export const LAST_RESORT_MIN_QUERY = 3;
/** Actions shown for a query, at most — the bookings below them must stay in view. */
export const MAX_ACTIONS = 8;

/** "12,99", "-49,90", ">100": an amount, which only bookings can answer. */
export const isAmountQuery = (q: string) => /^[\s\d.,+\-−<>=€]+$/.test(q);

/** How well an entry answers `query` (trimmed); 0 for not at all. */
export function scoreEntry(entry: PaletteEntry, query: string): number {
  // Four or more characters of an IBAN or account number, typed with or
  // without its spaces, find that account.
  const compact = query.replace(/\s+/g, '').toUpperCase();
  const idHit = compact.length >= 4
    && (entry.ids ?? []).some((id) => id.replace(/\s+/g, '').toUpperCase().includes(compact));
  if (idHit) return 70;
  if (isAmountQuery(query)) return 0;
  return fuzzyScore(entry.label, query, entry.keywords);
}

/** Best first; equal scores keep the list's own order. */
function rank<T extends PaletteEntry>(list: readonly T[], query: string): T[] {
  return list
    .map((entry, i) => ({ entry, i, score: scoreEntry(entry, query) }))
    .filter((r) => r.score > 0)
    .sort((x, y) => y.score - x.score || x.i - y.i)
    .map((r) => r.entry);
}

/**
 * What the palette lists for `query`, group by group. `last` holds the
 * last-resort entries that answer it: the caller renders them after
 * everything else, bookings included.
 */
export function paletteResults<T extends PaletteEntry>(
  actions: readonly T[],
  accounts: readonly T[],
  query: string,
): { actions: T[]; accounts: T[]; last: T[] } {
  const q = query.trim();
  const ordinary = actions.filter((a) => !a.lastResort);
  const lastResort = actions.filter((a) => a.lastResort);
  if (!q) {
    return {
      actions: ordinary.filter((a) => a.featured),
      accounts: [...accounts],
      last: lastResort.filter((a) => a.featured),
    };
  }
  return {
    actions: rank(ordinary, q).slice(0, MAX_ACTIONS),
    accounts: rank(accounts, q),
    last: q.length >= LAST_RESORT_MIN_QUERY ? rank(lastResort, q) : [],
  };
}
