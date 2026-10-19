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

import type { RecurringSeries } from './recurring';
import type { SerializedBankOrder, SerializedTransaction } from './fints-types';
import { bookingDay } from './analytics.ts';
import { addDaysKey, dayKey } from './format.ts';
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
 * The days a regular payment is expected on from `from` to `to`: its next
 * expected day, and for a weekly one every week after it. Slower rhythms
 * come at most once in a month.
 */
export function seriesDates(s: Pick<RecurringSeries, 'nextDate' | 'cadence' | 'ended' | 'overdue'>, from: string, to: string): string[] {
  if (s.ended || s.overdue || !s.nextDate) return [];
  const out: string[] = [];
  let d = s.nextDate;
  for (let i = 0; d <= to && i < 10; i++) {
    if (d >= from) out.push(d);
    if (s.cadence !== 'weekly') break;
    d = addDaysKey(d, 7);
  }
  return out;
}

const normIban = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, '').toUpperCase();

/**
 * Whether a detected series is the bank's own order: the same IBAN and,
 * within a cent per euro, the same amount. Then the order speaks for it — its
 * days are the bank's, the series' only a guess.
 */
function sameAsOrder(s: RecurringSeries, orders: readonly SerializedBankOrder[]): boolean {
  const iban = normIban(s.iban);
  if (!iban || s.amount >= 0) return false;
  return orders.some((o) => normIban(o.iban) === iban && Math.abs(Math.abs(s.amount) - o.amount) <= Math.max(0.01, o.amount * 0.01));
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
 * fall below zero (`card`).
 */
export function forecast(opts: {
  today: string;
  balance: number;
  currency: string;
  series: readonly RecurringSeries[];
  orders: readonly SerializedBankOrder[];
  pending: readonly SerializedTransaction[];
  usual: { perDay: number; months: number } | null;
  creditLimit?: number | null;
  card?: boolean;
}): Forecast {
  const today = dayKey(opts.today);
  const until = monthEnd(today);
  const events: ForecastEvent[] = [];

  for (const tx of opts.pending) {
    if ((tx.currency || 'EUR') !== opts.currency) continue;
    events.push({ date: today, amount: tx.amount, kind: 'pending', name: '', approximate: false });
  }
  for (const s of opts.series) {
    if (s.currency !== opts.currency || sameAsOrder(s, opts.orders)) continue;
    for (const date of seriesDates(s, today, until)) {
      events.push({ date, amount: s.amount, kind: 'series', name: s.name, approximate: s.variable });
    }
  }
  for (const o of opts.orders) {
    if (o.currency !== opts.currency || !o.schedule) continue;
    const date = o.schedule.kind === 'dated' ? o.schedule.date : nextExecution(o.schedule, today);
    if (!date || date < today || date > until) continue;
    events.push({ date, amount: -o.amount, kind: 'order', name: o.name, approximate: false });
  }
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
