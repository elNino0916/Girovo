// The command palette's order (components/CommandPalette.tsx), kept apart
// from the component so the rules can be tested on their own.
//
// The palette is the dashboard's search: someone types "ab" for Abos or an
// Abbuchung, "lo" for Lohn or Lotto, "me" for Media Markt — and presses
// Enter on whatever sits on top. So an entry that ends something (Abmelden)
// is a last resort. It answers only a deliberate query: three or more
// characters that start its own name ("abm", "abmelden"), or one of its words
// typed out in full ("logout", "ausloggen", "sitzung"). Never a fuzzy hit:
// "med", "den" or "mel" are inside the name, "logo" is the start of "logout"
// but far more often Firmenlogos — with nothing else matching, any of them
// would leave Abmelden alone and preselected, one Enter from the logout.
// When it answers, it comes after every other result — actions, accounts and
// bookings alike — and is preselected only when nothing else matches.

import { fold, fuzzyScore } from './fuzzy.ts';

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

/** The shortest word of a keyword phrase that answers for the whole phrase. */
const PHRASE_WORD_MIN = 5;

/**
 * Whether a last-resort entry answers `query` (trimmed): from three
 * characters on, the start of its label, or the whole of one of its keywords
 * or of a word in one that says something on its own ("sitzung" of "sitzung
 * beenden") — five letters or more, so "log", "out" and "sign" of "log out"
 * and "sign out" never do: they are the start of far too much else.
 */
export function answersLastResort(entry: PaletteEntry, query: string): boolean {
  const q = fold(query);
  if (q.length < LAST_RESORT_MIN_QUERY) return false;
  if (fold(entry.label).startsWith(q)) return true;
  return (entry.keywords ?? []).some((k) => {
    const kw = fold(k);
    return kw === q || (q.length >= PHRASE_WORD_MIN && kw.split(' ').includes(q));
  });
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
    last: rank(lastResort.filter((e) => answersLastResort(e, q)), q),
  };
}
