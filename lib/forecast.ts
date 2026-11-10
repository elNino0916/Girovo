// Where an account's balance is heading by the end of the month: today's
// balance, the Vorgemerkte still to book, the regular payments the bookings
// show (lib/recurring.ts) and the bank's own Daueraufträge and
// Terminüberweisungen where they were read — and, as an estimate apart, what
// the account usually spends besides them.
//
// An expectation, never a fact, and said as one: whole euros with "ca.", the
// basis in words, and nothing that is not in the loaded data. Its point is the
// low: the day the balance may dip below zero, or into the Dispo, before the
// salary arrives — said in time to move money, not after the bank charged
// Sollzinsen.
//
// Pure and node-test-safe: no path aliases, `.ts` on sibling imports.

import { LATE_DAYS, expectedDates, seriesBase, seriesIdentity, seriesTitle, type RecurringSeries } from './recurring.ts';
import type { SerializedBankOrder, SerializedTransaction } from './fints-types';
import { bookingDay } from './analytics.ts';
import { addDaysKey, compactIban, dayKey, dayNumber } from './format.ts';
import { nextExecution } from './order-schedule.ts';

export type ForecastEvent = {
  date: string;
  /** Signed, in the account's currency. */
  amount: number;
  kind: 'series' | 'order' | 'pending';
  /** The series' or the order's payee, as the data names it; '' for the Vorgemerkten. */
  name: string;
  /** The amount genuinely varies (a phone bill, a salary): the figure is a typical one. */
  approximate: boolean;
};

export type Forecast = {
  today: string;
  /** The last day projected: the month's end. */
  until: string;
  /** The bank's balance the projection starts from. */
  start: number;
  /** What the account usually spends besides its regular payments, per day; null without a whole month to learn from. */
  usualPerDay: number | null;
  /** Over how many whole months `usualPerDay` was worked out. */
  usualMonths: number;
  /** In date order, the Vorgemerkten first (they book any day now). */
  events: ForecastEvent[];
  /** The expected balance at `until`. */
  end: number;
  /** The lowest expected end-of-day balance from today to `until`, and its day. */
  low: { date: string; balance: number };
  /**
   * The first day the balance is expected below what the account may go to:
   * zero — or, with a Dispositionsrahmen, below it. Null when it never is.
   */
  breach: { date: string; balance: number; line: 'zero' | 'limit' } | null;
};

const cents = (v: number) => Math.round(Number(v) * 100);
const euros = (c: number) => c / 100;
const pad2 = (n: number) => String(n).padStart(2, '0');

/** The last day of the month `day` lies in. */
export function monthEnd(day: string): string {
  const [y, m] = day.split('-').map(Number);
  return `${y}-${pad2(m)}-${pad2(new Date(y, m, 0).getDate())}`;
}

/**
 * The days a regular payment is expected on from `from` (today) to `to`: its
 * next expected day, and for a weekly one every week after it (lib/recurring.ts
 * expectedDates). Slower rhythms come at most once in a month.
 *
 * A payment whose day has passed without it is late, not gone: until the
 * series is overdue (LATE_DAYS) it is expected any day now, so it counts as
 * due today. `late: false` where the Umsätze do not reach today — whether it
 * was booked since is not known.
 */
export function seriesDates(
  s: Parameters<typeof expectedDates>[0], from: string, to: string, late = true,
): string[] {
  if (s.ended || s.overdue || !s.nextDate) return [];
  const dates = expectedDates(s, from, to);
  const isLate = late && s.nextDate < from && from <= to && dayNumber(from) - dayNumber(s.nextDate) <= LATE_DAYS;
  return isLate ? [from, ...dates] : dates;
}

/**
 * Whether a detected series is the bank's own order: the same IBAN and,
 * within a cent per euro, the same amount in the same currency. Then the
 * order speaks for it — its days are the bank's, the series' only a guess.
 */
function isOrder(s: RecurringSeries, o: SerializedBankOrder): boolean {
  const iban = compactIban(s.iban);
  if (!iban || s.amount >= 0 || s.currency !== o.currency) return false;
  return compactIban(o.iban) === iban && Math.abs(Math.abs(s.amount) - o.amount) <= Math.max(0.01, o.amount * 0.01);
}

/** Every day the bank runs an order on from `from` to `to`; none where its answer did not say when. */
function orderDates(o: SerializedBankOrder, from: string, to: string): string[] {
  const s = o.schedule;
  if (!s) return [];
  if (s.kind === 'dated') return s.date >= from && s.date <= to ? [s.date] : [];
  // Every turn in these days: a weekly Dauerauftrag runs four or five times a month.
  const out: string[] = [];
  for (let day = nextExecution(s, from), i = 0; day && day <= to && i < 40; day = nextExecution(s, addDaysKey(day, 1)), i++) out.push(day);
  return out;
}

/** An expected payment and what it was worked out from. */
type Expected = { event: ForecastEvent; series?: RecurringSeries; order?: SerializedBankOrder };

/** A payment facilitator's shop a series is one shop's bookings of (as lib/payment-alerts.ts reads it). */
const shopOf = (s: RecurringSeries) => (s.transactions[0] ? seriesIdentity(s.transactions[0]).shop : null);

/**
 * The expected payment a Vorgemerkte already is, or undefined: counted twice
 * otherwise, once as vorgemerkt and once as expected.
 *
 * The bank's own order by its payee's IBAN and its amount to the cent. A
 * regular payment the way Verträge & Abos files a booking (seriesIdentity):
 * the same payer and, through a payment service, the same shop — of several
 * prices under one mandate the nearest, and never a charge of half the price
 * or twice it, which is another charge (lib/payment-alerts.ts dearerCharge).
 * Only a payment that is about due: within a week, three days for a weekly
 * one. Days before that, the Vorgemerkte is something else from the same payer.
 */
function announced(tx: SerializedTransaction, expected: readonly Expected[], today: string): Expected | undefined {
  const paid = cents(tx.amount);
  const due = (x: Expected, weekly: boolean) => dayNumber(x.event.date) - dayNumber(today) <= (weekly ? 3 : 7);
  const iban = compactIban(tx.remoteIban);
  const order = paid < 0 && iban
    ? expected.find((x) => {
        const o = x.order;
        if (!o || cents(o.amount) !== -paid || compactIban(o.iban) !== iban) return false;
        return due(x, o.schedule?.kind === 'standing' && o.schedule.unit === 'W' && o.schedule.interval === 1);
      })
    : undefined;
  if (order) return order;

  const { key, shop } = seriesIdentity(tx);
  if (!key) return undefined;
  let best: Expected | undefined;
  const seen = new Set<RecurringSeries>();
  for (const x of expected) {
    const s = x.series;
    // Each series by its first payment still expected (they are in date order).
    if (!s || seen.has(s)) continue;
    seen.add(s);
    if (seriesBase(s.key) !== key || !due(x, s.cadence === 'weekly')) continue;
    const own = shopOf(s);
    if (own && own !== shop) continue;
    if (!best || Math.abs(cents(s.amount) - paid) < Math.abs(cents(best.event.amount) - paid)) best = x;
  }
  if (!best) return undefined;
  const usual = Math.abs(cents(best.event.amount));
  return Math.abs(paid) * 2 > usual && Math.abs(paid) < usual * 2 ? best : undefined;
}

/**
 * What the account spends per day besides its regular payments, over the
 * whole calendar months before this one that the loaded days cover — at
 * most the last three. Every booking that belongs to no series counts,
 * Umbuchungen included: they move this account's money as much as a
 * purchase does. Net inflows (a month of refunds) count as nothing — a
 * forecast does not bank on windfalls.
 */
export function usualSpending(opts: {
  txs: readonly SerializedTransaction[];
  inSeries: ReadonlySet<SerializedTransaction>;
  loaded: { from: string; to: string } | null;
  today: string;
  currency: string;
}): { perDay: number; months: number } | null {
  if (!opts.loaded) return null;
  const [y, m] = opts.today.split('-').map(Number);
  const months: { from: string; to: string; days: number }[] = [];
  for (let back = 1; back <= 3; back++) {
    const first = new Date(y, m - 1 - back, 1);
    const from = `${first.getFullYear()}-${pad2(first.getMonth() + 1)}-01`;
    const to = monthEnd(from);
    if (dayKey(opts.loaded.from) > from || dayKey(opts.loaded.to) < to) break;
    months.push({ from, to, days: Number(to.slice(8, 10)) });
  }
  if (!months.length) return null;
  const from = months[months.length - 1].from;
  const to = months[0].to;
  let net = 0;
  for (const tx of opts.txs) {
    if (opts.inSeries.has(tx) || (tx.currency || 'EUR') !== opts.currency) continue;
    const day = bookingDay(tx);
    if (day >= from && day <= to) net += cents(tx.amount);
  }
  const days = months.reduce((n, mo) => n + mo.days, 0);
  return { perDay: Math.min(0, net) / 100 / days, months: months.length };
}

/**
 * The month's remaining days for one account. `series` are the live series
 * of this account (lib/recurring.ts), `orders` the bank's Daueraufträge and
 * Terminüberweisungen as last read (may be empty), `pending` the Vorgemerkten.
 * `creditLimit` is the Dispositionsrahmen (positive) where the bank reports
 * one; a credit card's balance is negative by nature, so it is never said to
 * fall below zero (`card`). `bookings` are the account's loaded Umsätze: an
 * order due today that they already hold is in the balance, not ahead of it.
 * `loadedTo` is the last day they cover (default: today).
 */
export function forecast(opts: {
  today: string;
  balance: number;
  currency: string;
  series: readonly RecurringSeries[];
  orders: readonly SerializedBankOrder[];
  pending: readonly SerializedTransaction[];
  bookings?: readonly SerializedTransaction[];
  loadedTo?: string;
  usual: { perDay: number; months: number } | null;
  creditLimit?: number | null;
  card?: boolean;
}): Forecast {
  const today = dayKey(opts.today);
  const until = monthEnd(today);
  // What is still expected, each with where it comes from: a Vorgemerkte
  // that is one of them takes its place further down.
  const expected: Expected[] = [];
  // A late payment is only known to be outstanding where the Umsätze reach today.
  const complete = !opts.loadedTo || dayKey(opts.loadedTo) >= today;

  // The bank's orders that run in these days, each with its days.
  const due = opts.orders
    .filter((o) => o.currency === opts.currency)
    .map((o) => ({ o, dates: orderDates(o, today, until) }))
    .filter((d) => d.dates.length > 0);

  for (const s of opts.series) {
    // Such an order speaks for its series. One the bank gave no days for, one
    // that has run out or whose turn comes after the month leaves it to the series.
    if (s.currency !== opts.currency || due.some((d) => isOrder(s, d.o))) continue;
    for (const date of seriesDates(s, today, until, complete)) {
      expected.push({ event: { date, amount: s.amount, kind: 'series', name: seriesTitle(s), approximate: s.variable }, series: s });
    }
  }
  // Today's execution of an order may have run already: the statement holds
  // it (the payee's IBAN, the amount to the cent — each booking answers for one
  // order), or the order's own series was last booked today.
  const bookedToday = (opts.bookings ?? []).filter((tx) => bookingDay(tx) === today && (tx.currency || 'EUR') === opts.currency);
  const answered = new Set<SerializedTransaction>();
  const ranToday = (o: SerializedBankOrder): boolean => {
    const iban = compactIban(o.iban);
    const tx = iban
      ? bookedToday.find((t) => !answered.has(t) && cents(t.amount) === -cents(o.amount) && compactIban(t.remoteIban) === iban)
      : undefined;
    if (tx) answered.add(tx);
    return !!tx || opts.series.some((s) => s.lastDate === today && isOrder(s, o));
  };
  for (const { o, dates } of due) {
    for (const date of dates) {
      if (date === today && ranToday(o)) continue;
      expected.push({ event: { date, amount: -o.amount, kind: 'order', name: o.name, approximate: false }, order: o });
    }
  }

  const events: ForecastEvent[] = [];
  for (const tx of opts.pending) {
    if ((tx.currency || 'EUR') !== opts.currency) continue;
    events.push({ date: today, amount: tx.amount, kind: 'pending', name: '', approximate: false });
    // Vorgemerkt and expected are one payment: the Vorgemerkte is the bank's word, so it stays.
    const same = announced(tx, expected, today);
    if (same) expected.splice(expected.indexOf(same), 1);
  }
  events.push(...expected.map((x) => x.event));
  events.sort((a, b) =>
    (a.kind === 'pending' ? -1 : 0) - (b.kind === 'pending' ? -1 : 0) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const start = cents(opts.balance);
  const usual = opts.usual ? cents(opts.usual.perDay) : 0;
  const limit = cents(Math.max(0, opts.creditLimit ?? 0));
  let running = start;
  let low = { date: today, balance: start };
  let belowZero: { date: string; balance: number } | null = null;
  let pastLimit: { date: string; balance: number } | null = null;
  // Day by day. Today's usual spending is already in the balance as far as it
  // happened, so the estimate starts tomorrow.
  for (let day = today, i = 0; day <= until && i < 40; day = addDaysKey(day, 1), i++) {
    if (day > today) running += usual;
    for (const e of events) if (e.date === day) running += cents(e.amount);
    if (running < low.balance) low = { date: day, balance: running };
    if (!belowZero && running < 0) belowZero = { date: day, balance: running };
    if (!pastLimit && limit > 0 && running < -limit) pastLimit = { date: day, balance: running };
  }
  // A card is negative by nature: nothing to warn about. Past the Dispo is
  // the harder line; below zero alone costs Sollzinsen and is said too.
  const breach: Forecast['breach'] = opts.card
    ? null
    : pastLimit
      ? { date: pastLimit.date, balance: euros(pastLimit.balance), line: 'limit' }
      : belowZero
        ? { date: belowZero.date, balance: euros(belowZero.balance), line: 'zero' }
        : null;

  return {
    today,
    until,
    start: euros(start),
    usualPerDay: opts.usual ? opts.usual.perDay : null,
    usualMonths: opts.usual?.months ?? 0,
    events,
    end: euros(running),
    low: { date: low.date, balance: euros(low.balance) },
    breach,
  };
}

/** Bookings of the account's series, so the usual spending leaves them out. */
export function seriesBookings(series: readonly RecurringSeries[]): Set<SerializedTransaction> {
  return new Set(series.flatMap((s) => s.transactions));
}
