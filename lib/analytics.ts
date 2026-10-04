// Read-only arithmetic over bookings that are already loaded: totals, monthly
// comparison, who the money goes to, and the Umsätze search.
//
// The rules every figure here keeps:
//   - A booking belongs to its local Buchungstag (entryDate), the day the
//     statement shows it under — never a UTC slice of the wire string.
//   - Umbuchungen between the user's own accounts (neutral categories) are
//     neither income nor expense; counting them would inflate both sides.
//   - Currencies are never added together. A call sums one currency — the one
//     asked for, else that of the first booking — and counts what it skipped.
//   - Money is summed in whole cents, so a long list cannot drift by a cent.
//
// Income and expense are decided per category, not per sign: a refund from a
// shop reduces "Shopping" instead of posing as income, and a category whose
// refunds outweigh its spending in a period moves to the income side rather
// than showing a negative bar. Categories that can go either way (fees and
// interest, "Sonstiges") split by sign. Either way income − expense is exactly
// the sum of the bookings counted, so the figures reconcile with the account.
//
// Pure and node-test-safe: no path aliases, `.ts` on sibling imports.

import type { SerializedTransaction } from './fints-types';
import type { CategoryId, CategoryResult } from './categories';
import type { TxFilter } from './app-types';
import { categoryDef, categoryLabel, counterpartyKey, counterpartyName, intermediaryName } from './categories.ts';
import { foldText } from './categorize.ts';
import { dayKey, fmtMonth, fmtRange, parseAmount, prettyBookingText, toLocalDate } from './format.ts';
import { isFacilitatorName, merchantHint } from './merchant-match.ts';
import { parsePurpose } from './sepa-purpose.ts';

export type CategoryOf = (tx: SerializedTransaction) => CategoryResult;
type DayInput = string | Date | null | undefined;

const cents = (v: number) => Math.round(Number(v) * 100);
const euros = (c: number) => c / 100;

/** The local Buchungstag of a booking, as yyyy-mm-dd. */
export const bookingDay = (tx: Pick<SerializedTransaction, 'entryDate' | 'valueDate'>): string =>
  dayKey(tx.entryDate || tx.valueDate);

const txMillis = (tx: Pick<SerializedTransaction, 'entryDate' | 'valueDate'>) =>
  toLocalDate(tx.entryDate || tx.valueDate)?.getTime() ?? 0;

/** Bookings in one currency and an inclusive day range, plus how many were set aside. */
function scope(
  txs: readonly SerializedTransaction[],
  opts: { from?: DayInput; to?: DayInput; currency?: string },
): { list: SerializedTransaction[]; currency: string; otherCurrency: number } {
  const from = opts.from ? dayKey(opts.from) : '';
  const to = opts.to ? dayKey(opts.to) : '';
  const currency = opts.currency || txs.find((t) => t.currency)?.currency || 'EUR';
  const list: SerializedTransaction[] = [];
  let otherCurrency = 0;
  for (const tx of txs) {
    const day = bookingDay(tx);
    if ((from && day < from) || (to && day > to)) continue;
    if ((tx.currency || 'EUR') !== currency) {
      otherCurrency++;
      continue;
    }
    list.push(tx);
  }
  return { list, currency, otherCurrency };
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

export type CategoryAmount = {
  id: CategoryId;
  /** Positive, in the account currency. */
  amount: number;
  count: number;
};

export type PeriodTotals = {
  /** Positive. */
  income: number;
  /** Positive. */
  expense: number;
  /** income − expense: the change these bookings made to the balance. */
  net: number;
  /** Bookings counted (Umbuchungen and other currencies not included). */
  count: number;
  /** Expense per category, largest first — the "Ausgaben nach Kategorie" bars. Sums to `expense`. */
  byCategory: CategoryAmount[];
  /** Income per category, largest first. Sums to `income`. */
  incomeByCategory: CategoryAmount[];
  /** Umbuchungen in the period, left out of every figure above. */
  excluded: number;
  /** Bookings in the period in a currency other than `currency`, left out. */
  otherCurrency: number;
  currency: string;
};

type Acc = { net: number; credit: number; debit: number; count: number; credits: number; debits: number };

function totalsOf(list: readonly SerializedTransaction[], categoryOf: CategoryOf) {
  const byCat = new Map<CategoryId, Acc>();
  let excluded = 0;
  let count = 0;
  for (const tx of list) {
    const id = categoryOf(tx).id;
    if (categoryDef(id).neutral) {
      excluded++;
      continue;
    }
    count++;
    let acc = byCat.get(id);
    if (!acc) byCat.set(id, (acc = { net: 0, credit: 0, debit: 0, count: 0, credits: 0, debits: 0 }));
    const c = cents(tx.amount);
    acc.net += c;
    acc.count++;
    if (c >= 0) {
      acc.credit += c;
      acc.credits++;
    } else {
      acc.debit -= c;
      acc.debits++;
    }
  }

  let income = 0;
  let expense = 0;
  const out: CategoryAmount[] = [];
  const inc: CategoryAmount[] = [];
  for (const [id, a] of byCat) {
    if (categoryDef(id).direction === 'both') {
      if (a.debit) out.push({ id, amount: euros(a.debit), count: a.debits });
      if (a.credit) inc.push({ id, amount: euros(a.credit), count: a.credits });
      expense += a.debit;
      income += a.credit;
    } else if (a.net < 0) {
      out.push({ id, amount: euros(-a.net), count: a.count });
      expense -= a.net;
    } else if (a.net > 0) {
      inc.push({ id, amount: euros(a.net), count: a.count });
      income += a.net;
    }
  }
  const order = (x: CategoryAmount, y: CategoryAmount) => y.amount - x.amount || y.count - x.count;
  return {
    income: euros(income),
    expense: euros(expense),
    net: euros(income - expense),
    count,
    byCategory: out.sort(order),
    incomeByCategory: inc.sort(order),
    excluded,
  };
}

/** Income, expense and the breakdown by category for one period (inclusive days). */
export function periodTotals(
  txs: readonly SerializedTransaction[],
  opts: { categoryOf: CategoryOf; from?: DayInput; to?: DayInput; currency?: string },
): PeriodTotals {
  const { list, currency, otherCurrency } = scope(txs, opts);
  return { ...totalsOf(list, opts.categoryOf), otherCurrency, currency };
}

export type MonthBucket = {
  /** yyyy-mm */
  month: string;
  /** Short, for an axis: "Okt" */
  label: string;
  /** Long, for a tooltip or table: "Oktober 2026". */
  title: string;
  income: number;
  expense: number;
  net: number;
  count: number;
  /**
   * The whole month lies inside the range and is over. A month cut by the
   * range — or the current one — is partial and must be labelled as such
   * ("bis 03.10."), never compared as if it were complete.
   */
  complete: boolean;
  /** The part of the month the figures cover, yyyy-mm-dd. */
  from: string;
  to: string;
};

const lastDayOfMonth = (y: number, m: number) => new Date(y, m, 0).getDate();

// Axis labels, fixed rather than asked of Intl: the standalone short forms
// differ between ICU versions ("Sep" / "Sept."), and a chart axis wants one
// width that Node and the Electron renderer agree on.
const MONTH_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const MONTH_LONG = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];
const pad2 = (n: number) => String(n).padStart(2, '0');

/** "28.09." from a day key. */
const shortDayKey = (key: string) => `${key.slice(8, 10)}.${key.slice(5, 7)}.`;

/** One calendar month of a range, cut to it. */
export type CalendarMonth = {
  /** yyyy-mm */
  month: string;
  /** Short, for an axis: "Okt" */
  label: string;
  /** "Oktober 2026" */
  title: string;
  /** The part of the month inside the range, yyyy-mm-dd. */
  from: string;
  to: string;
  /** The whole month lies inside the range and is over. */
  complete: boolean;
};

/** Every calendar month from `from` to `to`, oldest first, each cut to the range. */
export function calendarMonths(fromIn: DayInput, toIn: DayInput, todayIn: Date = new Date()): CalendarMonth[] {
  const from = dayKey(fromIn);
  const to = dayKey(toIn);
  if (!from || !to || from > to) return [];
  const today = dayKey(todayIn);
  const out: CalendarMonth[] = [];
  let y = +from.slice(0, 4);
  let m = +from.slice(5, 7);
  const endY = +to.slice(0, 4);
  const endM = +to.slice(5, 7);
  while (y < endY || (y === endY && m <= endM)) {
    const month = `${y}-${pad2(m)}`;
    const first = `${month}-01`;
    const last = `${month}-${pad2(lastDayOfMonth(y, m))}`;
    out.push({
      month,
      label: MONTH_SHORT[m - 1],
      title: fmtMonth(month),
      from: from > first ? from : first,
      to: to < last ? to : last,
      complete: from <= first && to >= last && last < today,
    });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/**
 * Which part of a month a stretch inside it covers: "bis 03.10." for the
 * running month, "ab 05.07." for the one a range starts in, "05.–20.07." for
 * both, '' for the whole month.
 */
export function monthPartNote(from: string, to: string): string {
  const month = from.slice(0, 7);
  const last = `${month}-${pad2(lastDayOfMonth(+month.slice(0, 4), +month.slice(5, 7)))}`;
  const startsLate = from > `${month}-01`;
  const endsEarly = to < last;
  if (startsLate && endsEarly) return `${shortDayKey(from)}–${shortDayKey(to)}`;
  if (startsLate) return `ab ${shortDayKey(from)}`;
  if (endsEarly) return `bis ${shortDayKey(to)}`;
  return '';
}

/**
 * A stretch of days in words, the way the period controls name it:
 * "September 2026", "Oktober 2026 · bis 04.10.", "28.09.2026",
 * "06.07.–30.09.2026", "ab 01.09.2026".
 */
export function daysLabel(fromIn: string | null | undefined, toIn: string | null | undefined): string {
  const from = dayKey(fromIn);
  const to = dayKey(toIn);
  if (!from && !to) return '';
  if (!to) return `ab ${fmtRange(from, from)}`;
  if (!from) return `bis ${fmtRange(to, to)}`;
  if (from === to || from > to) return fmtRange(from, to);
  if (from.slice(0, 7) === to.slice(0, 7)) {
    const note = monthPartNote(from, to);
    return note ? `${fmtMonth(from)} · ${note}` : fmtMonth(from);
  }
  return fmtRange(from, to);
}

/** One bucket per calendar month from `from` to `to`, empty months included. */
export function monthlyBuckets(
  txs: readonly SerializedTransaction[],
  opts: { categoryOf: CategoryOf; from: DayInput; to: DayInput; today?: Date; currency?: string },
): MonthBucket[] {
  const months = calendarMonths(opts.from, opts.to, opts.today);
  if (!months.length) return [];
  const { list } = scope(txs, { from: opts.from, to: opts.to, currency: opts.currency });

  const byMonth = new Map<string, SerializedTransaction[]>();
  for (const tx of list) {
    const m = bookingDay(tx).slice(0, 7);
    let bucket = byMonth.get(m);
    if (!bucket) byMonth.set(m, (bucket = []));
    bucket.push(tx);
  }

  return months.map((cm) => {
    const t = totalsOf(byMonth.get(cm.month) ?? [], opts.categoryOf);
    return { ...cm, income: t.income, expense: t.expense, net: t.net, count: t.count };
  });
}

// ---------------------------------------------------------------------------
// Who and what
// ---------------------------------------------------------------------------

export type Counterparty = {
  /** counterpartyKey(), or a key from the booking text for nameless bookings. */
  key: string;
  /**
   * As the bank wrote it on the newest booking — except for cash, which is
   * "Bargeld" rather than the bank whose machine paid it out, and a purchase
   * through a payment service, which is the shop the purpose names.
   */
  name: string;
  /** Every cash withdrawal, as one: they share a category, not a payee. */
  cash?: boolean;
  /** The payment service the shop was paid through ("PayPal Europe …"), as the bank wrote it. */
  via?: string;
  /** Positive: what this counterparty adds to periodTotals' expense (`out`) or income (`in`), refunds netted. */
  amount: number;
  /** The bookings folded into `amount`, refunds included. */
  count: number;
  /** Of those, the ones booked the other way — a refund netted against a payment. */
  offsets: number;
  iban?: string;
  /** The newest booking — for the logo lookup and "Alle Umsätze mit …". */
  sample: SerializedTransaction;
};

const validIban = (s: string | null | undefined) => {
  const iban = String(s ?? '').replace(/\s+/g, '').toUpperCase();
  return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban) ? iban : '';
};

/**
 * The shop a payment service collected for, when the purpose names it: PayPal
 * books "Ihr Einkauf bei ZALANDO SE" under its own name and IBAN. Null for
 * anything that is not a payment service, or one whose purpose names no shop.
 * As written in the purpose (a domain keeps its own spelling).
 */
export function facilitatorShop(
  tx: Pick<SerializedTransaction, 'purpose' | 'remoteName'> & { ultimateName?: string },
): string | null {
  // Behind a card processor the shop is already the counterparty.
  if (intermediaryName(tx)) return null;
  const name = counterpartyName(tx);
  if (!name || !isFacilitatorName(name)) return null;
  const purpose = String(tx.purpose ?? '');
  const hint = merchantHint(purpose);
  if (!hint) return null;
  // merchantHint lower-cases a domain; the purpose has it as the shop wrote it.
  const at = purpose.toLowerCase().indexOf(hint.toLowerCase());
  return (at >= 0 ? purpose.slice(at, at + hint.length) : hint).trim() || null;
}

function directional(
  txs: readonly SerializedTransaction[],
  opts: { categoryOf: CategoryOf; dir: 'in' | 'out'; from?: DayInput; to?: DayInput; currency?: string },
): SerializedTransaction[] {
  return scope(txs, opts).list.filter(
    (tx) => (opts.dir === 'in' ? tx.amount > 0 : tx.amount < 0) && !categoryDef(opts.categoryOf(tx).id).neutral,
  );
}

/**
 * The bookings behind one side of totalsOf(), each with the cents it adds to
 * that side: a debit in a spending category adds to the expense, a refund in
 * it takes away; a category that can go either way gives each side only its
 * own direction; a category that ended up on the other side in this period
 * is not here at all. Summed, the entries are exactly periodTotals().expense
 * (`out`) or .income (`in`) — whatever is ranked from them shares its basis.
 */
function sideEntries(
  list: readonly SerializedTransaction[],
  categoryOf: CategoryOf,
  dir: 'in' | 'out',
): { tx: SerializedTransaction; cents: number }[] {
  const rows: { tx: SerializedTransaction; id: CategoryId; c: number; both: boolean }[] = [];
  const net = new Map<CategoryId, number>();
  for (const tx of list) {
    const id = categoryOf(tx).id;
    const def = categoryDef(id);
    if (def.neutral) continue;
    const c = cents(tx.amount);
    rows.push({ tx, id, c, both: def.direction === 'both' });
    net.set(id, (net.get(id) ?? 0) + c);
  }
  // Signed towards the side asked for: a debit is +, for `out`.
  const s = dir === 'out' ? -1 : 1;
  const out: { tx: SerializedTransaction; cents: number }[] = [];
  for (const r of rows) {
    if (r.both) {
      // Same split as totalsOf: a zero booking sits on the credit side.
      if (dir === 'out' ? r.c < 0 : r.c >= 0) out.push({ tx: r.tx, cents: s * r.c });
    } else if (s * net.get(r.id)! > 0) {
      out.push({ tx: r.tx, cents: s * r.c });
    }
  }
  return out;
}

/**
 * The counterparties most of a period's expense went to (`out`) or most of
 * its income came from (`in`), with how often — on the basis of
 * periodTotals(), so a payee's share of the Ausgaben is a share of the same
 * figure: a refund is netted against the payee it came from, an Umbuchung or
 * a category that landed on the other side does not count, and a payee whose
 * refunds outweigh its payments drops out. Grouped like the user's category
 * rules — creditor ID, then IBAN, then name — so "REWE SAGT DANKE 1234" and
 * "REWE SAGT DANKE 5678" are one.
 *
 * Two kinds of booking name the wrong party for this question. Cash names
 * the bank whose machine paid it out, which would rank the user's own bank
 * as a payee: every withdrawal (by category) is one "Bargeld" entry instead.
 * And a payment service (PayPal) collects for many shops under one name and
 * IBAN: where the purpose names the shop, the shop is the payee.
 */
export function topCounterparties(
  txs: readonly SerializedTransaction[],
  opts: { categoryOf: CategoryOf; dir: 'in' | 'out'; limit: number; from?: DayInput; to?: DayInput; currency?: string },
): Counterparty[] {
  const groups = new Map<string, {
    amount: number; count: number; offsets: number; newest: SerializedTransaction; time: number; iban: string; ibanTime: number;
    cash: boolean; shop: string | null;
  }>();
  for (const { tx, cents: c } of sideEntries(scope(txs, opts).list, opts.categoryOf, opts.dir)) {
    const cash = opts.categoryOf(tx).id === 'cash';
    const shop = cash ? null : facilitatorShop(tx);
    let key = cash ? 'cash' : shop ? `shop:${foldText(shop)}` : counterpartyKey(tx);
    // Nameless bookings (the bank's own Abschluss) would otherwise all land
    // in one "?" group; their booking text tells them apart.
    if (key === 'name:?') key = `text:${foldText(tx.bookingText) || '?'}`;
    const time = txMillis(tx);
    // An intermediary's IBAN would lead "show these bookings" to every shop
    // it serves — and so would a payment service's.
    const iban = cash || shop || intermediaryName(tx) ? '' : validIban(tx.remoteIban);
    const offset = c < 0 ? 1 : 0;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, {
        amount: c, count: 1, offsets: offset, newest: tx, time, iban, ibanTime: iban ? time : -Infinity, cash, shop,
      });
      continue;
    }
    g.amount += c;
    g.count++;
    g.offsets += offset;
    if (time > g.time) {
      g.time = time;
      g.newest = tx;
      if (shop) g.shop = shop;
    }
    if (iban && time > g.ibanTime) {
      g.iban = iban;
      g.ibanTime = time;
    }
  }
  return [...groups.entries()]
    .filter(([, g]) => g.amount > 0)
    .map(([key, g]): Counterparty => ({
      key,
      name: g.cash
        ? 'Bargeld'
        : g.shop ?? (counterpartyName(g.newest) || prettyBookingText(g.newest.bookingText) || 'Ohne Namen'),
      ...(g.cash ? { cash: true } : {}),
      ...(g.shop ? { via: counterpartyName(g.newest) } : {}),
      amount: euros(g.amount),
      count: g.count,
      offsets: g.offsets,
      ...(g.iban ? { iban: g.iban } : {}),
      sample: g.newest,
    }))
    .sort((a, b) => b.amount - a.amount || b.count - a.count || a.name.localeCompare(b.name, 'de'))
    .slice(0, Math.max(0, opts.limit));
}

/**
 * The largest single bookings in one direction, biggest first (newer first on
 * a tie). `skip` leaves bookings out — the Analyse keeps recognised contracts
 * and cash withdrawals out of its one-off spending.
 */
export function largest(
  txs: readonly SerializedTransaction[],
  opts: {
    categoryOf: CategoryOf; dir: 'in' | 'out'; limit: number; from?: DayInput; to?: DayInput; currency?: string;
    skip?: (tx: SerializedTransaction) => boolean;
  },
): SerializedTransaction[] {
  const skip = opts.skip;
  return (skip ? directional(txs, opts).filter((tx) => !skip(tx)) : directional(txs, opts))
    .map((tx) => ({ tx, abs: Math.abs(cents(tx.amount)), time: txMillis(tx) }))
    .sort((a, b) => b.abs - a.abs || b.time - a.time)
    .slice(0, Math.max(0, opts.limit))
    .map((x) => x.tx);
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

const AMOUNT_TOKEN = /^[+\-−–]?\d[\d.,]*$/;
const COMPARE_TOKEN = /^(<=|>=|<|>)(.+)$/;
const RANGE_TOKEN = /^(\d[\d.,]*)[-–](\d[\d.,]*)$/;
const DATE_TOKEN = /^(\d{1,2})\.(\d{1,2})\.?(\d{2}|\d{4})?$/;
// A month with its year: "09/2026", "9.2026", "2026-09".
const MONTH_YEAR_TOKEN = /^(\d{1,2})[./](\d{4})$/;
const ISO_MONTH_TOKEN = /^(\d{4})-(\d{1,2})$/;
// The year that may follow a month word: "August 2026".
const YEAR_TOKEN = /^(?:19|20)\d{2}$/;

const ignorable = (ref: string | null | undefined) => !ref || ref === 'NOTPROVIDED' || ref === 'NONREF';

/**
 * What the search reads besides the bank's own strings. Hand over the same
 * (memoised) object on every call: each booking's text is folded once per
 * context, not once per keystroke.
 */
export type SearchContext = {
  /** The category each booking is filed under — its label is searchable, as the row shows it. */
  categoryOf?: CategoryOf;
  /**
   * What the screen shows of a booking that its raw strings do not hold: the
   * tidied name, the second line ("Debitkarte · Köln"), the town and country
   * of a card terminal — with the letters the bank's character set dropped.
   * A word read on screen then finds its row.
   */
  shownText?: (tx: SerializedTransaction) => string;
};

const NO_CONTEXT: SearchContext = {};
const foldedText = new WeakMap<SearchContext, WeakMap<SerializedTransaction, string>>();

/** Everything a person might type to find a booking, folded once per context. */
function haystack(tx: SerializedTransaction, ctx: SearchContext): string {
  let cache = foldedText.get(ctx);
  if (!cache) foldedText.set(ctx, (cache = new WeakMap()));
  const hit = cache.get(tx);
  if (hit !== undefined) return hit;
  const prose = parsePurpose(tx.purpose).text;
  const text = foldText(
    [
      tx.ultimateName,
      tx.remoteName,
      prose,
      tx.purpose,
      tx.bookingText,
      tx.remoteIban,
      ignorable(tx.e2eReference) ? '' : tx.e2eReference,
      ignorable(tx.mandateReference) ? '' : tx.mandateReference,
      ctx.shownText?.(tx) ?? '',
      ctx.categoryOf ? categoryLabel(ctx.categoryOf(tx).id) : '',
    ].join(' '),
  );
  cache.set(tx, text);
  return text;
}

type Test = (tx: SerializedTransaction, text: () => string) => boolean;

const MONTH_WORDS = ['JANUAR', 'FEBRUAR', 'MAERZ', 'APRIL', 'MAI', 'JUNI', 'JULI', 'AUGUST', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DEZEMBER'];
// Spellings that are no start of the folded name: "Mrz", "Marz".
const MONTH_ALIASES: Record<string, number> = { MRZ: 3, MARZ: 3 };

/**
 * 1–12 for a German month word or its start — "August", "aug", "Sept.",
 * "März", "Mrz" — else null. Three letters at least, so "Ma" or "Ju" is
 * still just text.
 */
export function monthOfWord(word: string): number | null {
  const f = foldText(word).replace(/ /g, '');
  if (f.length < 3 || !/^[A-Z]+$/.test(f)) return null;
  if (MONTH_ALIASES[f]) return MONTH_ALIASES[f];
  const i = MONTH_WORDS.findIndex((m) => m.startsWith(f));
  return i < 0 ? null : i + 1;
}

/** Booked or value-dated in that month (and year, when given) — like a day, which matches either. */
function inMonth(tx: SerializedTransaction, month: number, year: number | null): boolean {
  const hit = (key: string) => !!key && +key.slice(5, 7) === month && (year == null || +key.slice(0, 4) === year);
  return hit(dayKey(tx.entryDate)) || hit(dayKey(tx.valueDate));
}

function tokenTest(token: string): Test | null {
  if (/^(€|EUR)$/i.test(token)) return null;
  const folded = foldText(token);
  // A stray "-" or "&" narrows nothing; it must not empty the list either.
  if (!folded) return null;
  // Substring, not whole word: "rew" already finds REWE while typing.
  const textHit: Test = (_tx, text) => !!folded && text().includes(folded);

  const cmp = COMPARE_TOKEN.exec(token);
  if (cmp) {
    const n = parseAmount(cmp[2]);
    if (n == null) return textHit;
    const limit = cents(Math.abs(n));
    return (tx) => {
      const a = Math.abs(cents(tx.amount));
      switch (cmp[1]) {
        case '<': return a < limit;
        case '<=': return a <= limit;
        case '>': return a > limit;
        default: return a >= limit;
      }
    };
  }

  const tests: Test[] = [textHit];

  // "50-100" is an amount range — but "2026-118" is an invoice number, and
  // "24-7" may be part of a shop's name. Only an ascending pair reads as a
  // range, and the word is still looked for in the text either way.
  const range = RANGE_TOKEN.exec(token);
  if (range) {
    const lo = parseAmount(range[1]);
    const hi = parseAmount(range[2]);
    if (lo != null && hi != null && lo < hi) {
      const [a, b] = [cents(lo), cents(hi)];
      tests.push((tx) => {
        const v = Math.abs(cents(tx.amount));
        return v >= a && v <= b;
      });
    }
  }

  const date = DATE_TOKEN.exec(token);
  if (date) {
    const d = +date[1];
    const m = +date[2];
    const y = date[3] ? (date[3].length === 2 ? 2000 + +date[3] : +date[3]) : null;
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
      const hit = (key: string) =>
        !!key && +key.slice(8, 10) === d && +key.slice(5, 7) === m && (y == null || +key.slice(0, 4) === y);
      tests.push((tx) => hit(dayKey(tx.entryDate)) || hit(dayKey(tx.valueDate)));
    }
  }

  if (AMOUNT_TOKEN.test(token)) {
    const n = parseAmount(token);
    if (n != null) {
      const signed = /^[+\-−–]/.test(token);
      const target = cents(n);
      if (/[.,]\d{1,2}$/.test(token)) {
        // "12,99" — that exact amount, either direction unless a sign says which.
        tests.push((tx) => (signed ? cents(tx.amount) === target : Math.abs(cents(tx.amount)) === Math.abs(target)));
      } else {
        // "12" — any amount in 12,00 … 12,99.
        const whole = Math.abs(target);
        tests.push((tx) => {
          const v = cents(tx.amount);
          if (signed && Math.sign(v) !== Math.sign(target)) return false;
          const a = Math.abs(v);
          return a >= whole && a < whole + 100;
        });
      }
    }
  }
  return (tx, text) => tests.some((t) => t(tx, text));
}

/** One word of a query (two, for a month and its year) and how it is tested. */
type Term = {
  /** As typed — what a report quotes back. */
  text: string;
  test: Test;
  /** The month the term also names, in words: "August", "August 2026". */
  month: string | null;
};

/** A month reading, OR'd with the words' plain reading: "Mai" finds May's bookings and still "Maier". */
function monthTerm(text: string, month: number, year: number | null, plain: Test | null): Term {
  return {
    text,
    month: `${MONTH_LONG[month - 1]}${year != null ? ` ${year}` : ''}`,
    test: (tx, t) => inMonth(tx, month, year) || (!!plain && plain(tx, t)),
  };
}

function parseTerms(q: string): Term[] {
  const words = q.split(/\s+/).filter(Boolean);
  const terms: Term[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const plain = tokenTest(w);
    const named = monthOfWord(w);
    if (named) {
      const next = words[i + 1];
      if (next && YEAR_TOKEN.test(next)) {
        // "August 2026": one term. Read as text, both words must occur.
        const yearText = tokenTest(next);
        i++;
        const both: Test = (tx, t) => !!plain && plain(tx, t) && (!yearText || yearText(tx, t));
        terms.push(monthTerm(`${w} ${next}`, named, +next, both));
      } else {
        terms.push(monthTerm(w, named, null, plain));
      }
      continue;
    }
    const my = MONTH_YEAR_TOKEN.exec(w);
    const iso = ISO_MONTH_TOKEN.exec(w);
    const [m, y] = my ? [+my[1], +my[2]] : iso ? [+iso[2], +iso[1]] : [0, 0];
    if (m >= 1 && m <= 12) {
      terms.push(monthTerm(w, m, y, plain));
      continue;
    }
    if (plain) terms.push({ text: w, test: plain, month: null });
  }
  return terms;
}

function parseQuery(query: string) {
  const q = String(query ?? '').trim();
  const compact = q.replace(/\s+/g, '').toUpperCase();
  const ibanLike = compact.length >= 5 && /^[A-Z]{2}\d{2}[A-Z0-9]*$/.test(compact);
  return { q, compact, ibanLike, terms: q ? parseTerms(q) : [] };
}

const ibanHit = (tx: SerializedTransaction, compact: string) =>
  String(tx.remoteIban ?? '').replace(/\s+/g, '').toUpperCase().includes(compact);

/**
 * A predicate for the Umsätze search box.
 *
 * Every word must match (AND), each against the name, the remittance text,
 * the booking text, the IBAN and the references — umlauts either way, so
 * "müller" finds "MUELLER" — and, with a context, against what the screen
 * shows: the tidied name and second line, a card terminal's town and
 * country, the category. Words that look like amounts also match amounts:
 * "12,99" that amount, "-49,90" that debit, "12" anything from 12,00 to 12,99,
 * ">100" and "<=20" compare the absolute amount, and so does "50-100" — a
 * range only when the first number is the smaller, and the text is searched
 * for it as well, so "Rechnung 2026-118" still finds that invoice. "28.09."
 * matches the Buchungs- or Wertstellungstag, "August", "aug 2026" or
 * "09/2026" the month — each as well as the text, so "Mai" still finds
 * "Maier". An IBAN may be typed with or without its spaces.
 */
export function txMatcher(query: string, ctx: SearchContext = NO_CONTEXT): (tx: SerializedTransaction) => boolean {
  const { q, compact, ibanLike, terms } = parseQuery(query);
  if (!q) return () => true;
  return (tx) => {
    if (ibanLike && ibanHit(tx, compact)) return true;
    const text = () => haystack(tx, ctx);
    return terms.every((t) => t.test(tx, text));
  };
}

export type SearchTermReport = {
  /** The word as typed (a month word with its year: "august 2026"). */
  text: string;
  /** How many of the bookings this word alone matches. */
  matches: number;
  /** The month the word was also read as: "August", "August 2026". */
  month: string | null;
};

/**
 * How each word of a query fares on its own among `txs`. An empty result can
 * then say which word found nothing instead of implying the booking does not
 * exist, and a word that was also read as a month can say so.
 */
export function searchReport(
  txs: readonly SerializedTransaction[],
  query: string,
  ctx: SearchContext = NO_CONTEXT,
): SearchTermReport[] {
  const { q, ibanLike, terms } = parseQuery(query);
  if (!q) return [];
  if (ibanLike) return [{ text: q, matches: txs.filter(txMatcher(q, ctx)).length, month: null }];
  return terms.map((t) => {
    let matches = 0;
    for (const tx of txs) if (t.test(tx, () => haystack(tx, ctx))) matches++;
    return { text: t.text, matches, month: t.month };
  });
}

/** Whether a booking's local Buchungstag lies inside the filter's days. */
export function inFilterDays(tx: SerializedTransaction, filter: Pick<TxFilter, 'from' | 'to'>): boolean {
  if (!filter.from && !filter.to) return true;
  const day = bookingDay(tx);
  if (filter.from && day < dayKey(filter.from)) return false;
  if (filter.to && day > dayKey(filter.to)) return false;
  return true;
}

/**
 * The Umsätze list after its direction chips, category menu, days and search.
 * Order is kept. `opts` doubles as the search context — keep it memoised.
 */
export function filterTransactions(
  txs: readonly SerializedTransaction[],
  filter: TxFilter,
  opts: SearchContext & { categoryOf: CategoryOf },
): SerializedTransaction[] {
  const match = txMatcher(filter.query, opts);
  return txs.filter((tx) => {
    if (filter.dir === 'in' && !(tx.amount > 0)) return false;
    if (filter.dir === 'out' && !(tx.amount < 0)) return false;
    if (!inFilterDays(tx, filter)) return false;
    if (filter.category && opts.categoryOf(tx).id !== filter.category) return false;
    return match(tx);
  });
}
