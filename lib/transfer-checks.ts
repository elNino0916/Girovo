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
import { dayFromNumber, dayKey, dayNumber, displayName, fmtDate, isoDate, toLocalDate } from './format.ts';
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

/**
 * What "Jetzt nachsehen" saw. `unsure`: debits like it are there, but each
 * of them may be an older payment or another order's of the same payment —
 * `count` of them; `tx` is the one nearest after the order.
 */
export type SentTransferSighting =
  | { where: 'booked' | 'pending'; tx: SerializedTransaction; unsure?: false }
  | { where: 'booked' | 'pending'; tx: SerializedTransaction; unsure: true; count: number };

/** How long an order may take to show among the bookings: a long weekend. */
const BOOKING_LAG_DAYS = 3;

/** One debit as a key that stays the same when the same list is read again. */
const debitKey = (tx: SerializedTransaction) => [
  dayKey(tx.entryDate || tx.valueDate), tx.amount, tx.purpose, tx.e2eReference, tx.bankReference, tx.customerReference,
].map((v) => String(v ?? '')).join('|');

/** `list` without one entry for each of `held` (by debitKey): what was not there before. */
function notHeld(list: readonly SerializedTransaction[], held: readonly SerializedTransaction[]): SerializedTransaction[] {
  const left = new Map<string, number>();
  for (const tx of held) left.set(debitKey(tx), (left.get(debitKey(tx)) ?? 0) + 1);
  return list.filter((tx) => {
    const n = left.get(debitKey(tx)) ?? 0;
    if (n > 0) left.set(debitKey(tx), n - 1);
    return n === 0;
  });
}

/**
 * After an order whose outcome is unknown: is it among the account's freshly
 * read bookings (`booked`) or Vormerkposten (`pending`)? Null where a list was
 * not read. What counts is a debit of the same amount to the same IBAN, dated
 * from the day the order went out (`since`) on — and only one that was not
 * there already:
 *
 *  - `before` holds the lists as they stood when the order went out. A
 *    booking stays booked, a Vormerkposten stays one or becomes a booking: so
 *    as many debits as they held are taken off. A list left out (or null) was
 *    not on hand, and nothing can be taken off for it.
 *  - `sent` (lib/sent-orders.ts), this login's orders: another order of the
 *    same payment from the same account, sent shortly before this one (or a
 *    terminierte Überweisung due about now), books a debit just like it. It
 *    counts as one more debit that may be among those found — unless a debit
 *    of its own can be pointed to: one dated from its day on but before the
 *    day this order went out, each debit for one order only, and one the
 *    lists held only for an order sent before they were read (`before.at`).
 *
 * Found: at least one debit is left that none of that can explain. The one
 * nearest after the order is named, a booking before a Vormerkposten, one
 * already there before passed over. `unsure`: there are debits that were not
 * certainly there before, but older ones or the other orders could explain
 * each of them. Null: nothing that was not there before.
 *
 * A payment of the same amount to the same IBAN made elsewhere (online
 * banking) cannot be told apart unless a list held it before the order.
 */
export function findSentTransfer(input: {
  iban: string;
  cents: number;
  since: Date;
  booked?: readonly SerializedTransaction[] | null;
  pending?: readonly SerializedTransaction[] | null;
  before?: {
    booked?: readonly SerializedTransaction[] | null;
    pending?: readonly SerializedTransaction[] | null;
    /** epoch ms: when the older of the two lists on hand was read. */
    at?: number | null;
  } | null;
  sent?: readonly SentOrder[];
  /** The account the order left from, for `sent`. */
  accountNumber?: string;
}): SentTransferSighting | null {
  const iban = compactIban(input.iban);
  const from = dayKey(input.since);
  const sentAt = input.since.getTime();
  const lagFrom = dayFromNumber(dayNumber(from) - BOOKING_LAG_DAYS);
  const dayOf = (tx: SerializedTransaction) => dayKey(tx.entryDate || tx.valueDate);
  const like = (tx: SerializedTransaction) => tx.amount < 0 && Math.round(-tx.amount * 100) === input.cents
    && compactIban(tx.remoteIban) === iban;
  const datedFrom = (list: readonly SerializedTransaction[] | null | undefined, day: string) =>
    (list ?? []).filter((tx) => like(tx) && dayOf(tx) >= day);

  const booked = datedFrom(input.booked, from);
  const pending = datedFrom(input.pending, from);
  const before = input.before ?? {};
  const heldBooked = datedFrom(before.booked, from);
  // Any day: one from before the order may be booked under a later date by now.
  const heldPending = (before.pending ?? []).filter(like);

  // Certainly there before: the bookings held (still booked), and the
  // Vormerkposten held that are still listed as they were.
  const newPending = notHeld(pending, heldPending);
  const certainlyOld = (input.booked ? Math.min(heldBooked.length, booked.length) : 0) + pending.length - newPending.length;
  const count = booked.length + pending.length - certainlyOld;
  if (count <= 0) return null;

  // Perhaps there before: every booking held, and every Vormerkposten held
  // but one still listed under a day before the order (counted nowhere).
  const listedEarlier = datedFrom(input.pending, '').filter((tx) => dayOf(tx) < from);
  const heldAside = heldPending.length - notHeld(heldPending, listedEarlier).length;
  // …or another order's: a transfer sent within the lag, or a terminierte
  // Überweisung due within it (carried out at the start of its day). `day`:
  // the first day it can book on; `at`: from when it can have a debit.
  const others: { day: string; at: number }[] = [];
  for (const o of input.sent ?? []) {
    if (o.accountNumber !== input.accountNumber || compactIban(o.iban) !== iban || o.cents !== input.cents) continue;
    const t = Date.parse(o.at);
    if (!(t < sentAt)) continue;
    const sentOn = dayKey(new Date(t));
    if (!o.kind && sentOn >= lagFrom) others.push({ day: sentOn, at: t });
    else if (o.kind === 'dated' && o.due && o.due >= lagFrom && o.due <= from) {
      others.push({ day: o.due, at: toLocalDate(o.due)?.getTime() ?? t });
    }
  }
  // Such an order is accounted for only by a debit that can be its own, as
  // read now: dated from its day on, but before the day this order went out
  // (so none of the debits counted above), and — if the lists held it — held
  // only once that order could have a debit. Each debit for one order. Any
  // order left over may be behind one of the debits counted.
  const readAt = before.at ?? null;
  const earlierBooked = datedFrom(input.booked, lagFrom).filter((tx) => dayOf(tx) < from);
  const earlierListed = listedEarlier.filter((tx) => dayOf(tx) >= lagFrom);
  const freshBookedEarlier = notHeld(earlierBooked, datedFrom(before.booked, lagFrom));
  const freshListedEarlier = notHeld(earlierListed, heldPending);
  const debits = [
    ...earlierBooked.map((tx) => ({ day: dayOf(tx), held: !freshBookedEarlier.includes(tx) })),
    ...earlierListed.map((tx) => ({ day: dayOf(tx), held: !freshListedEarlier.includes(tx) })),
  ];
  const fits = (o: (typeof others)[number], d: (typeof debits)[number]) =>
    d.day >= o.day && (!d.held || (readAt != null && o.at < readAt));
  // Each order to a debit of its own where one can be found (a matching: an
  // order may take a debit another holds if that one can move to a different one).
  const holder: number[] = debits.map(() => -1);
  const take = (oi: number, seen: boolean[]): boolean => {
    for (let di = 0; di < debits.length; di++) {
      if (seen[di] || !fits(others[oi], debits[di])) continue;
      seen[di] = true;
      if (holder[di] < 0 || take(holder[di], seen)) {
        holder[di] = oi;
        return true;
      }
    }
    return false;
  };
  const unexplained = others.filter((_, oi) => !take(oi, [])).length;
  const possiblyOld = (input.booked ? heldBooked.length : 0) + heldPending.length - heldAside + unexplained;

  const nearest = (list: readonly SerializedTransaction[]) => {
    let best: SerializedTransaction | null = null;
    for (const tx of list) if (!best || dayOf(tx) < dayOf(best)) best = tx;
    return best;
  };
  const freshBooked = nearest(notHeld(booked, heldBooked));
  const freshPending = nearest(newPending);
  const named = freshBooked ? { where: 'booked' as const, tx: freshBooked }
    : freshPending ? { where: 'pending' as const, tx: freshPending }
    : booked.length ? { where: 'booked' as const, tx: nearest(booked)! }
    : { where: 'pending' as const, tx: nearest(pending)! };
  return booked.length + pending.length - possiblyOld >= 1 ? named : { ...named, unsure: true, count };
}
