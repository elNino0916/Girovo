// Vorgemerkte Umsätze against the statement that came after them.
//
// The Vormerkposten list (HKVMK) is fetched on request only — it can take a
// TAN — so nothing ever refreshes it on its own. A statement loaded later in
// the same session may already hold some of those items as bookings: the
// Lastschrift announced this morning and booked at noon. Shown on, it would
// count twice — once inside the Kontostand that already includes it, once
// more as "Vorgemerkt", and twice in an exported file.
//
// Pure and dependency-free apart from sibling lib modules, so the
// `node --test` suite can run it under Node's own type stripping.

import { txKey } from './categories.ts';
import { dayKey, dayNumber } from './format.ts';
import type { SerializedTransaction } from './fints-types';

/**
 * How far a booking may be dated *before* its Vormerkposten and still be it.
 * Banks differ by a day or two in which date they put on either; a month
 * apart is the next instalment of the same debit, not this one.
 */
const EARLIER_BOOKING_DAYS = 3;

type Item = Pick<
  SerializedTransaction,
  'entryDate' | 'valueDate' | 'amount' | 'remoteIban' | 'remoteName' | 'e2eReference' | 'bankReference'
>;

/** SEPA's ways of saying "no reference". */
const realRef = (s: string | null | undefined) => {
  const v = String(s ?? '').trim();
  return v && v !== 'NOTPROVIDED' && v !== 'NONREF' ? v : '';
};

const cents = (n: number) => Math.round(Number(n) * 100);
const compactIban = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, '').toUpperCase();
const dayOf = (tx: Item) => dayNumber(dayKey(tx.entryDate || tx.valueDate));

/**
 * The same order by its end-to-end reference, whatever day either side
 * carries: a card Vormerkposten is dated the day of the purchase, its booking
 * a day or three later, so the day-bound txKey alone would miss it.
 */
const refKey = (tx: Item) => {
  const ref = realRef(tx.e2eReference);
  return ref ? `${ref}|${cents(tx.amount)}|${compactIban(tx.remoteIban)}` : '';
};

function push(index: Map<string, number[]>, key: string, i: number) {
  if (!key) return;
  const list = index.get(key);
  if (list) list.push(i);
  else index.set(key, [i]);
}

/**
 * The Vormerkposten of `pending` that `booked` does not list as booked yet.
 *
 * A Vormerkposten counts as booked when a booking has the same txKey (day,
 * amount, counterparty, reference), or the same real end-to-end reference,
 * amount and counterparty IBAN at most a few days earlier or any time later.
 * Each booking accounts for one Vormerkposten only — two identical card
 * payments on one day, one of them booked, leave the other one standing.
 *
 * Only meaningful against a statement fetched *after* the list, reaching the
 * day it was fetched; the caller decides that. The same array comes back when
 * nothing was booked, so a memo keyed on it does not recompute.
 */
export function unbookedPending<T extends Item>(pending: readonly T[], booked: readonly Item[]): readonly T[] {
  if (!pending.length || !booked.length) return pending;
  const byTxKey = new Map<string, number[]>();
  const byRef = new Map<string, number[]>();
  booked.forEach((b, i) => {
    push(byTxKey, txKey(b), i);
    push(byRef, refKey(b), i);
  });
  const used = new Set<number>();
  const take = (candidates: number[] | undefined, ok: (i: number) => boolean = () => true) => {
    const hit = candidates?.find((i) => !used.has(i) && ok(i));
    if (hit === undefined) return false;
    used.add(hit);
    return true;
  };

  const left = pending.filter((p) => {
    if (take(byTxKey.get(txKey(p)))) return false;
    const key = refKey(p);
    if (!key) return true;
    const day = dayOf(p);
    return !take(byRef.get(key), (i) => {
      const bookedDay = dayOf(booked[i]);
      // Undated on either side: the reference, amount and IBAN still agree.
      return Number.isNaN(day) || Number.isNaN(bookedDay) || bookedDay >= day - EARLIER_BOOKING_DAYS;
    });
  });
  return left.length === pending.length ? pending : left;
}
