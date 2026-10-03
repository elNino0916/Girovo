// The year of an MT940 Buchungstag.
//
// An MT940 :61: line carries the Wertstellung in full (YYMMDD) but the
// Buchungstag only as MMDD. lib-fints (mt940parser.js) supplies the year as
// `entryMonth <= valueMonth ? valueYear : valueYear - 1`, i.e. it assumes a
// booking is never entered in a later month than its value date. Across the
// turn of the year that is exactly backwards for the most common case:
// German banks do not post on 31.12., so interest, fees and late card
// payments valued 31.12.2025 are booked 02.01.2026 — and lib-fints dates them
// 02.01.2025. Such a booking then sorts to the bottom of Umsätze, drops out of
// January's Monatsbilanz and Analyse, and misplaces the Kontoverlauf.
//
// The fix is the one the format implies: a booking is entered within days of
// its value date, so the year to choose is the one that puts the Buchungstag
// nearest the Wertstellung. Only a date that is a whole year out is moved —
// one that lands within two months of the value date once moved. Anything
// else (CAMT carries both dates in full) is the bank's own word and passes
// through untouched.
//
// Kept here rather than in a patch of lib-fints, so a library upgrade cannot
// silently undo it, and pure, so `node --test` covers it (lib/entry-date.test.ts).

const DAY_MS = 86_400_000;
/** Closer than this, the year is taken as given. */
const HALF_YEAR_MS = 183 * DAY_MS;
/** How far a corrected Buchungstag may sit from its Wertstellung. */
const PLAUSIBLE_MS = 62 * DAY_MS;

/**
 * `entry` moved by one year when it is more than half a year from `value`
 * and the move brings it within two months of it; otherwise `entry` itself,
 * unchanged (also when either is missing or unreadable). The move keeps the
 * time of day, so lib-fints' local-midnight dates stay local midnight.
 */
export function nearestEntryYear<T extends Date | string>(entry: T, value: Date | string | null | undefined): T | Date {
  if (!entry || !value) return entry;
  const e = entry instanceof Date ? entry : new Date(entry);
  const v = value instanceof Date ? value : new Date(value);
  const et = e.getTime();
  const vt = v.getTime();
  if (Number.isNaN(et) || Number.isNaN(vt)) return entry;
  const diff = et - vt;
  if (Math.abs(diff) <= HALF_YEAR_MS) return entry;
  const shifted = new Date(et);
  shifted.setFullYear(e.getFullYear() + (diff < 0 ? 1 : -1));
  return Math.abs(shifted.getTime() - vt) <= PLAUSIBLE_MS ? shifted : entry;
}
