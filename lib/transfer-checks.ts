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
import type { SerializedBalance, SerializedBankOrder, SerializedTransaction } from './fints-types';
import type { OrderSchedule } from './order-schedule';
import type { SentOrder } from './sent-orders';
import { bookingKind } from './categorize.ts';
import { dayKey, dayNumber, displayName, fmtDate, isoDate, toLocalDate } from './format.ts';
import { msgs } from './i18n/index.ts';
import { rhythmLine } from './order-schedule.ts';
import { SENT_ORDER_DAYS } from './sent-orders.ts';

/** Same amount to the same IBAN within this many days → ask. The vault keeps orders exactly this long. */
export const DUPLICATE_WINDOW_DAYS = SENT_ORDER_DAYS;

const compactIban = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, '').toUpperCase();
/** "9:05 Uhr" ("9:05"). */
const fmtTime = (d: Date) => msgs().transfer.clock(`${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`);

// ---------------------------------------------------------------------------
// Duplicate check
// ---------------------------------------------------------------------------

/**
 * What the review step says about a payment that looks like one already made.
 * `sentence` and `title` are worded when they are read — amount, date and
 * words in the language speaking right now — so a check kept across a change
 * of language speaks the new one.
 */
export type Duplicate = { sentence: string; title: string };

/** What the evidence was: a payment, or an order the bank keeps for later. */
type Evidence = 'payment' | 'dated' | 'standing';

const worded = (say: () => string, evidence: Evidence = 'payment'): Duplicate => ({
  get sentence() {
    return say();
  },
  get title() {
    return evidence === 'payment' ? msgs().transfer.review.duplicateTitle : msgs().orders.duplicate.title[evidence];
  },
});

/**
 * Whether the same amount already went to the same IBAN within the last two
 * weeks. Freshest evidence first, because it may not be booked yet:
 *
 *  1. this session's own orders (`activity`), which know the payee's name;
 *  2. the orders of the last two weeks kept in the vault (`sent`), which
 *     survive a logout — the case of an order left "Status unklar";
 *  3. the bank's own lists of orders for later, where they were read
 *     (`bankOrders`) — whenever they run;
 *  4. the vorgemerkte Umsätze, where they were fetched (`pending`);
 *  5. the loaded statements (`txByAccount`).
 *
 * Refused orders moved no money and never count.
 *
 * What counts depends on what is being placed (`schedule`). A transfer now or
 * a terminierte Überweisung is one payment: any payment or terminierte
 * Überweisung of the same amount to the same IBAN counts, never a
 * Dauerauftrag — paying this month's rent by hand beside a new Dauerauftrag
 * for it is ordinary. A Dauerauftrag is compared with Daueraufträge alone:
 * that it matches a payment already made is what a recurring payment does.
 */
export function findDuplicate(input: {
  iban: string;
  cents: number;
  name: string;
  /** Absent: a transfer carried out now. */
  schedule?: OrderSchedule | null;
  activity: readonly ActivityEntry[];
  sent: readonly SentOrder[];
  /** The bank's lists of Daueraufträge and terminierte Überweisungen as read, any account. */
  bankOrders?: readonly SerializedBankOrder[];
  pending: Record<string, readonly SerializedTransaction[]>;
  txByAccount: Record<string, readonly SerializedTransaction[]>;
  fmt: (value: number) => string;
  now?: Date;
}): Duplicate | null {
  const now = input.now ?? new Date();
  const today = dayNumber(isoDate(now));
  const iban = compactIban(input.iban);
  const standing = input.schedule?.kind === 'standing';
  /** Whether an earlier order of this kind (undefined: a transfer now) speaks for this one. */
  const comparable = (kind: 'dated' | 'standing' | undefined) => (standing ? kind === 'standing' : kind !== 'standing');
  const within = (key: string) => {
    const n = dayNumber(key);
    return Number.isFinite(n) && today - n <= DUPLICATE_WINDOW_DAYS && n - today <= DUPLICATE_WINDOW_DAYS;
  };
  const words = () => msgs().transfer.duplicate;
  const later = () => msgs().orders.duplicate;
  const money = () => input.fmt(input.cents / 100);
  const when = (at: Date) => (dayKey(at) === isoDate(now)
    ? words().todayAt(fmtTime(at))
    : words().dayAt(fmtDate(at), fmtTime(at)));
  const due = (key: string | undefined) => fmtDate(toLocalDate(key ?? '') ?? key ?? '');
  const sentence = (
    at: Date, who: string, outcome: 'executed' | 'unknown', kind?: 'dated' | 'standing', dueOn?: string,
  ): Duplicate => {
    const done = outcome === 'executed';
    if (kind === 'standing') {
      return worded(() => (done
        ? later().placedStanding(when(at), money(), who)
        : later().placedStandingUnclear(when(at), money(), who)), 'standing');
    }
    if (kind === 'dated') {
      return worded(() => (done
        ? later().placedDated(when(at), money(), who, due(dueOn))
        : later().placedDatedUnclear(when(at), money(), who, due(dueOn))), 'dated');
    }
    return worded(() => (done ? words().sent(when(at), money(), who) : words().sentUnclear(when(at), money(), who)));
  };

  for (const a of input.activity) {
    if (a.outcome === 'failed' || compactIban(a.iban) !== iban || Math.round(a.amount * 100) !== input.cents) continue;
    if (!comparable(a.schedule?.kind)) continue;
    const at = new Date(a.at);
    if (!within(dayKey(at))) continue;
    const s = a.schedule;
    return sentence(at, displayName(a.name) || input.name, a.outcome, s?.kind, s ? (s.kind === 'dated' ? s.date : s.first) : undefined);
  }

  for (const o of input.sent) {
    if (compactIban(o.iban) !== iban || o.cents !== input.cents || !comparable(o.kind)) continue;
    const at = new Date(o.at);
    if (!within(dayKey(at))) continue;
    return sentence(at, input.name, o.outcome, o.kind, o.due);
  }

  for (const b of input.bankOrders ?? []) {
    if (compactIban(b.iban) !== iban || Math.round(b.amount * 100) !== input.cents || !comparable(b.kind)) continue;
    const who = displayName(b.name) || input.name;
    const s = b.schedule;
    if (b.kind === 'standing') {
      return worded(() => later().bankStanding(money(), who, s?.kind === 'standing' ? rhythmLine(s) : null), 'standing');
    }
    return worded(() => later().bankDated(money(), who, s?.kind === 'dated' ? due(s.date) : null), 'dated');
  }

  // Bookings and Vormerkposten are payments: they say nothing about a Dauerauftrag.
  if (standing) return null;

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
    const debit = bookingKind(pending.tx) === 'lastschrift';
    return worded(() => (debit ? words().debitPending(who, money()) : words().pending(money(), who)));
  }

  const booked = newest(input.txByAccount);
  if (!booked) return null;
  const who = displayName(booked.tx.remoteName) || input.name;
  const day = booked.day;
  const debit = bookingKind(booked.tx) === 'lastschrift';
  return worded(() => {
    const date = fmtDate(toLocalDate(day) ?? day);
    return debit ? words().debitBooked(date, who, money()) : words().booked(date, money(), who);
  });
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

/**
 * After a terminierte Überweisung or a Dauerauftrag whose outcome is
 * unknown: the order of the same kind, IBAN and amount in the bank's freshly
 * read list — the one whose schedule matches best (the same date, or the same
 * rhythm and day), else any. Null when the list holds none.
 */
export function findPlacedOrder(input: {
  iban: string;
  cents: number;
  schedule: OrderSchedule;
  orders?: readonly SerializedBankOrder[] | null;
}): SerializedBankOrder | null {
  const iban = compactIban(input.iban);
  const want = input.schedule;
  const same = (input.orders ?? []).filter((o) => o.kind === want.kind
    && compactIban(o.iban) === iban && Math.round(o.amount * 100) === input.cents);
  const exact = same.find((o) => {
    const s = o.schedule;
    if (!s || s.kind !== want.kind) return false;
    if (s.kind === 'dated' && want.kind === 'dated') return s.date === want.date;
    return s.kind === 'standing' && want.kind === 'standing'
      && s.unit === want.unit && s.interval === want.interval && s.day === want.day;
  });
  return exact ?? same[0] ?? null;
}

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
