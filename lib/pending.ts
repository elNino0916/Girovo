// Vorgemerkte Umsätze against the statement that came after them.
//
// A Vorgemerkt list reaches the app one of two ways: fetched on request
// (HKVMK — it can take a TAN, so nothing ever refreshes it on its own), or
// sent by the bank beside the Umsätze of a statement read (Sparkassen do:
// lib/fints-statements.ts). Either list can be older than a statement loaded
// later in the same session, which may already hold some of its items as
// bookings: the Lastschrift announced this morning and booked at noon. Shown
// on, it would count twice — once inside the Kontostand that already includes
// it, once more as "Vorgemerkt", and twice in an exported file.
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

/** One account's Vorgemerkt list from one source, and when it was read (epoch ms). */
export type PendingRead<T> = { txs: readonly T[]; loadedAt: number };

/**
 * The list the bank sent with the Umsätze, after a statement read at `at`.
 *
 * `sent` is what that answer carried beside the Umsätze — undefined when it
 * carried no such part, null when it carried one that could not be read. A
 * bank that sent a list before and sends none with a read reaching today has
 * nothing vorgemerkt any more. A read of a past range says nothing about
 * today, and an unreadable part says nothing at all: the earlier list stands,
 * as old as it is, and the same object comes back.
 */
export function afterStatementRead<T>(
  prev: PendingRead<T> | undefined,
  sent: readonly T[] | null | undefined,
  reachesToday: boolean,
  at: number,
): PendingRead<T> | undefined {
  if (sent) return { txs: sent, loadedAt: at };
  if (sent === undefined && prev && reachesToday) return { txs: [], loadedAt: at };
  return prev;
}

/** One account's Vorgemerkte as shown, and how they stand against its newest statement. */
export type PendingView<T> = {
  txs: readonly T[];
  /** How fresh the rows shown are: when the older list among those that contribute rows was read. */
  loadedAt: number;
  /** A statement read after a list that contributes rows reaches that list's day. */
  behindStatement: boolean;
  /** How many listed items that statement already shows as booked (and are gone here). */
  booked: number;
  /** When either list was last read — rows or not: whether a read has landed. */
  readAt: number;
};

/** How many days apart two sources may date the same Vormerkposten. */
const SAME_ITEM_DAYS = 2;

const squashName = (s: string | null | undefined) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** The same counterparty: by IBAN where both name one, else by name — MT942 cuts names short, camt does not. */
function sameParty(a: Item, b: Item): boolean {
  const ia = compactIban(a.remoteIban);
  const ib = compactIban(b.remoteIban);
  if (ia && ib) return ia === ib;
  const na = squashName(a.remoteName);
  const nb = squashName(b.remoteName);
  return !!na && !!nb && (na.startsWith(nb) || nb.startsWith(na));
}

/**
 * The items of `extra` that `listed` — another source's list of Vormerkposten
 * — does not have. Not txKey: the sources date the same item differently
 * (MT942 a local midnight, camt a local noon, so a different day in UTC, and
 * a Buchungstag where the other has only the Valuta). Same amount, and the
 * same real reference or the same counterparty a few days apart; each listed
 * item accounts for one extra item only.
 */
function notListed<T extends Item>(extra: readonly T[], listed: readonly Item[]): readonly T[] {
  if (!extra.length || !listed.length) return extra;
  const used = new Set<number>();
  const left = extra.filter((e) => {
    const day = dayOf(e);
    const ref = refKey(e);
    const hit = listed.findIndex((l, i) => {
      if (used.has(i) || cents(l.amount) !== cents(e.amount)) return false;
      if (ref && ref === refKey(l)) return true;
      const listedDay = dayOf(l);
      const near = Number.isNaN(day) || Number.isNaN(listedDay) || Math.abs(listedDay - day) <= SAME_ITEM_DAYS;
      return near && sameParty(e, l);
    });
    if (hit < 0) return true;
    used.add(hit);
    return false;
  });
  return left.length === extra.length ? extra : left;
}

/**
 * One account's Vorgemerkte against its newest statement read.
 *
 * `noted`: the list the bank sent with a statement read; `fetched`: the list
 * fetched on its own (HKVMK). A list older than a statement that reaches its
 * day loses what that statement shows as booked (unbookedPending). A list
 * that came *with* the statement — read at the same moment — is taken as the
 * bank sorted it: two identical card payments, one of them booked, are two.
 *
 * With both lists, the one fetched on its own adds only what the other does
 * not list; an empty one never hides the other's items. Its freshness then
 * counts only when it adds rows: a later empty answer does not vouch for the
 * other list's items, and an older list with nothing to add does not age them.
 */
export function pendingView<T extends Item>(
  sources: { noted?: PendingRead<T>; fetched?: PendingRead<T> },
  statement: { loadedAt: number; to: string; booked: readonly Item[] } | undefined,
): PendingView<T> | undefined {
  const live = (read: PendingRead<T>): PendingView<T> => {
    const behindStatement = !!statement && statement.loadedAt > read.loadedAt
      && statement.to >= dayKey(read.loadedAt);
    const txs = behindStatement ? unbookedPending(read.txs, statement!.booked) : read.txs;
    return { txs, loadedAt: read.loadedAt, behindStatement, booked: read.txs.length - txs.length, readAt: read.loadedAt };
  };
  const noted = sources.noted && live(sources.noted);
  const fetched = sources.fetched && live(sources.fetched);
  if (!noted || !fetched) return noted || fetched;
  const readAt = Math.max(noted.readAt, fetched.readAt);
  const extra = notListed(fetched.txs, noted.txs);
  if (!extra.length) return { ...noted, readAt };
  const shown = noted.txs.length ? [noted, fetched] : [fetched];
  return {
    txs: [...noted.txs, ...extra],
    loadedAt: Math.min(...shown.map((v) => v.loadedAt)),
    behindStatement: shown.some((v) => v.behindStatement),
    booked: noted.booked + fetched.booked,
    readAt,
  };
}
