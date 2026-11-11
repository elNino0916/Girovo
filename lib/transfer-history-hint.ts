// Girovo Next: the hint on "Überweisung prüfen" when a transfer is far larger
// than what went to the same payee before ("Lea Hoffmann hast du bisher 3-mal
// 25,00 € geschickt. Diesmal sind es 250,00 €.").
//
// Matched by the payee's IBAN only: a name is no proof it is the same
// account, and a booking without an IBAN says nothing. Only transfers count
// (a direct debit or a card payment to the same IBAN is not money sent).
// A hint, never a block. Pure, over the bookings the session already holds;
// dependency-free apart from sibling lib modules, for the client and
// `node --test`.

import type { SerializedTransaction } from './fints-types';
import { bookingKind, type BookingKind } from './categorize.ts';
import { compactIban } from './format.ts';

/** At least this many earlier transfers to the payee. */
export const HINT_MIN_EARLIER = 2;
/** This transfer is at least this many times the largest earlier one. */
export const HINT_FACTOR = 3;

/** What a debit can be when it is money sent; "sonstige" is a debit the bank did not name. */
const SENT: ReadonlySet<BookingKind> = new Set(['ueberweisung', 'echtzeit', 'dauerauftrag', 'sonstige']);

export type TransferHistoryHint = {
  /** How many earlier transfers to the payee the bookings show. */
  count: number;
  /** The largest of them, in euros. */
  largest: number;
  /** When every one of them was the same amount: that amount, in euros. */
  same: number | null;
};

/**
 * The hint for a transfer of `cents` to `iban`, or null when there is none to
 * give: fewer than two earlier transfers to that IBAN, or this one less than
 * three times the largest of them.
 */
export function transferHistoryHint(input: {
  iban: string;
  cents: number;
  txByAccount: Record<string, readonly SerializedTransaction[] | null | undefined>;
}): TransferHistoryHint | null {
  const iban = compactIban(input.iban);
  if (!iban || !(input.cents > 0)) return null;
  const earlier: number[] = [];
  for (const list of Object.values(input.txByAccount)) {
    for (const tx of list ?? []) {
      if (!(tx.amount < 0) || (tx.currency && tx.currency !== 'EUR')) continue;
      if (compactIban(tx.remoteIban) !== iban) continue;
      if (!SENT.has(bookingKind(tx))) continue;
      earlier.push(Math.round(-tx.amount * 100));
    }
  }
  if (earlier.length < HINT_MIN_EARLIER) return null;
  const largest = Math.max(...earlier);
  if (!(largest > 0) || input.cents < HINT_FACTOR * largest) return null;
  return {
    count: earlier.length,
    largest: largest / 100,
    same: earlier.every((c) => c === largest) ? largest / 100 : null,
  };
}
