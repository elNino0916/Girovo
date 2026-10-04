// The two things worth a second look before a transfer goes out: whether it
// looks like a payment already made, and what it does to the account.
//
// Both are hints, never blocks: paying the same person twice is often exactly
// right, and the bank decides what it will execute. Pure functions over data
// the session already holds — nothing here asks the bank anything.
//
// Dependency-free apart from sibling lib modules, for the client and
// `node --test`.

import type { ActivityEntry } from './app-types';
import type { SerializedBalance, SerializedTransaction } from './fints-types';
import type { SentOrder } from './sent-orders';
import { bookingKind } from './categorize.ts';
import { dayKey, dayNumber, displayName, fmtDate, isoDate, toLocalDate } from './format.ts';
import { SENT_ORDER_DAYS } from './sent-orders.ts';

/** Same amount to the same IBAN within this many days → ask. The vault keeps orders exactly this long. */
export const DUPLICATE_WINDOW_DAYS = SENT_ORDER_DAYS;

const compactIban = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, '').toUpperCase();
const fmtTime = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')} Uhr`;

// ---------------------------------------------------------------------------
// Duplicate check
// ---------------------------------------------------------------------------

export type Duplicate = { sentence: string };

/**
 * Whether the same amount already went to the same IBAN within the last two
 * weeks. Freshest evidence first, because it may not be booked yet:
 *
 *  1. this session's own orders (`activity`), which know the payee's name;
 *  2. the orders of the last two weeks kept in the vault (`sent`), which
 *     survive a logout — the case of an order left "Status unklar";
 *  3. the vorgemerkte Umsätze, where they were fetched (`pending`);
 *  4. the loaded statements (`txByAccount`).
 *
 * Refused orders moved no money and never count.
 */
export function findDuplicate(input: {
  iban: string;
  cents: number;
  name: string;
  activity: readonly ActivityEntry[];
  sent: readonly SentOrder[];
  pending: Record<string, readonly SerializedTransaction[]>;
  txByAccount: Record<string, readonly SerializedTransaction[]>;
  fmt: (value: number) => string;
  now?: Date;
}): Duplicate | null {
  const now = input.now ?? new Date();
  const today = dayNumber(isoDate(now));
  const iban = compactIban(input.iban);
  const within = (key: string) => {
    const n = dayNumber(key);
    return Number.isFinite(n) && today - n <= DUPLICATE_WINDOW_DAYS && n - today <= DUPLICATE_WINDOW_DAYS;
  };
  const money = input.fmt(input.cents / 100);
  const when = (at: Date) => (dayKey(at) === isoDate(now) ? `Heute um ${fmtTime(at)}` : `Am ${fmtDate(at)} um ${fmtTime(at)}`);
  const sentence = (at: Date, who: string, outcome: 'executed' | 'unknown') => (outcome === 'executed'
    ? `${when(at)} hast du bereits ${money} an ${who} überwiesen.`
    : `${when(at)} hast du bereits eine Überweisung über ${money} an ${who} gesendet, deren Ausführung nicht bestätigt wurde.`);

  for (const a of input.activity) {
    if (a.outcome === 'failed' || compactIban(a.iban) !== iban || Math.round(a.amount * 100) !== input.cents) continue;
    const at = new Date(a.at);
    if (!within(dayKey(at))) continue;
    return { sentence: sentence(at, displayName(a.name) || input.name, a.outcome) };
  }

  for (const o of input.sent) {
    if (compactIban(o.iban) !== iban || o.cents !== input.cents) continue;
    const at = new Date(o.at);
    if (!within(dayKey(at))) continue;
    return { sentence: sentence(at, input.name, o.outcome) };
  }

  const newest = (lists: Record<string, readonly SerializedTransaction[]>) => {
    let best: { tx: SerializedTransaction; day: string } | null = null;
    for (const list of Object.values(lists)) {
      for (const tx of list ?? []) {
        if (!(tx.amount < 0) || Math.round(-tx.amount * 100) !== input.cents) continue;
        if (compactIban(tx.remoteIban) !== iban) continue;
        const day = dayKey(tx.entryDate || tx.valueDate);
        if (!within(day)) continue;
        if (!best || day > best.day) best = { tx, day };
      }
    }
    return best;
  };

  const pending = newest(input.pending);
  if (pending) {
    const who = displayName(pending.tx.remoteName) || input.name;
    return {
      sentence: bookingKind(pending.tx) === 'lastschrift'
        ? `${who} zieht bereits ${money} per Lastschrift ein – die Buchung ist vorgemerkt.`
        : `Bei deinen vorgemerkten Umsätzen steht bereits eine Zahlung über ${money} an ${who}.`,
    };
  }

  const booked = newest(input.txByAccount);
  if (!booked) return null;
  const who = displayName(booked.tx.remoteName) || input.name;
  const date = fmtDate(toLocalDate(booked.day) ?? booked.day);
  return {
    sentence: bookingKind(booked.tx) === 'lastschrift'
      ? `Am ${date} hat ${who} bereits ${money} per Lastschrift eingezogen.`
      : `Am ${date} hast du bereits ${money} an ${who} überwiesen.`,
  };
}

// ---------------------------------------------------------------------------
// The account's figures
// ---------------------------------------------------------------------------

/**
 * What the account can spend right now, as far as the session knows: the
 * bank's own "verfügbar" figure when it sent one, otherwise the booked balance
 * (labelled as such — a balance is not an availability).
 */
export function spendable(b: SerializedBalance | null | undefined): { kind: 'available' | 'balance'; value: number; date: Date | null } | null {
  if (!b) return null;
  const date = toLocalDate(b.date);
  if (b.availableAmount != null && Number.isFinite(b.availableAmount)) return { kind: 'available', value: b.availableAmount, date };
  if (Number.isFinite(b.balance)) return { kind: 'balance', value: b.balance, date };
  return null;
}

export type FundsWarning =
  /** More than the bank says is available (or, without that figure, than the Kontostand): it may refuse the order. */
  | { kind: 'over'; basis: 'available' | 'balance' }
  /** Covered by Verfügbar, but the Kontostand ends below zero: the order runs on the Dispositionsrahmen. */
  | { kind: 'overdraft'; balanceAfter: number };

/**
 * What the account's last known figures say about sending `cents` from it,
 * or null when there is nothing to say — or nothing known. Only for an
 * account kept in euros: a SEPA order is in euros, and across currencies a
 * comparison would be a guess. `overdraft: false` leaves out the Dispo note
 * (a credit card's balance is below zero by nature).
 */
export function fundsWarning(
  b: SerializedBalance | null | undefined,
  cents: number,
  opts: { currency?: string | null; overdraft?: boolean } = {},
): FundsWarning | null {
  if ((opts.currency || 'EUR') !== 'EUR' || !(cents > 0)) return null;
  const funds = spendable(b);
  if (!funds) return null;
  if (cents > Math.round(funds.value * 100)) return { kind: 'over', basis: funds.kind };
  if (funds.kind !== 'available' || opts.overdraft === false || !b || !Number.isFinite(b.balance)) return null;
  const afterCents = Math.round(b.balance * 100) - cents;
  return afterCents < 0 ? { kind: 'overdraft', balanceAfter: afterCents / 100 } : null;
}

// ---------------------------------------------------------------------------
// "Status unklar": is it there?
// ---------------------------------------------------------------------------

export type SentTransferSighting = { where: 'booked' | 'pending'; tx: SerializedTransaction };

/**
 * After an order whose outcome is unknown: a debit of the same amount to the
 * same IBAN, from the day it was sent on, in the account's freshly loaded
 * bookings — or, failing that, among its vorgemerkte Umsätze. A booking beats
 * a Vormerkposten; the newest of each wins. Null when neither shows one.
 */
export function findSentTransfer(input: {
  iban: string;
  cents: number;
  since: Date;
  booked?: readonly SerializedTransaction[] | null;
  pending?: readonly SerializedTransaction[] | null;
}): SentTransferSighting | null {
  const iban = compactIban(input.iban);
  const from = dayKey(input.since);
  const newest = (list: readonly SerializedTransaction[] | null | undefined) => {
    let best: { tx: SerializedTransaction; day: string } | null = null;
    for (const tx of list ?? []) {
      if (!(tx.amount < 0) || Math.round(-tx.amount * 100) !== input.cents) continue;
      if (compactIban(tx.remoteIban) !== iban) continue;
      const day = dayKey(tx.entryDate || tx.valueDate);
      if (!day || day < from) continue;
      if (!best || day > best.day) best = { tx, day };
    }
    return best?.tx ?? null;
  };
  const booked = newest(input.booked);
  if (booked) return { where: 'booked', tx: booked };
  const pending = newest(input.pending);
  return pending ? { where: 'pending', tx: pending } : null;
}
