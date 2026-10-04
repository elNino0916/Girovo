// Recurring payments — contracts, subscriptions, salary — recognised in the
// bookings that are already loaded.
//
// Nothing here asks the bank anything. A series is a guess drawn from
// history, and everything it reports is presented as one: "monatlich",
// "voraussichtlich am 01.11.", "ca. 12,99 €".
//
// The method, in order:
//   1. Set aside what is never a contract: moving money between the user's
//      own accounts, cash, returned direct debits, and card payments at
//      grocery stores (a weekly shop is a habit, not a contract — unless it
//      is collected by direct debit, like a vegetable box).
//   2. Group bookings by who collects them, strongest identity first:
//      creditor ID + mandate reference, IBAN + mandate reference, IBAN alone,
//      creditor ID alone, then the counterparty's name. Money in and money
//      out are never one series.
//   3. Read the rhythm from the median gap between bookings and accept it
//      only if most gaps agree (a skipped month is tolerated).
//   4. Weigh the evidence. A creditor ID or a mandate reference proves a
//      standing arrangement with that creditor, and so does a standing order
//      the user set up: such a series needs three bookings for the weekly and
//      monthly rhythms but only two for the longer ones (and two for a monthly
//      SEPA direct debit), and its amounts may vary by a coefficient of
//      variation under 15 % — 25 % for salary — or be a fixed price that
//      changed now and then. Everything else is only a pattern in the
//      history, and a year of eating out is full of patterns: two dinners a
//      quarter apart that cost about the same are a coincidence. So without
//      an arrangement it takes three bookings for every rhythm and a steady
//      amount (identical, under 10 %, or a fixed price that changed), and a
//      card payment at a restaurant, a shop, a filling station or a ride
//      counts only at an identical price — a gym membership, not lunch.
//   5. If a group fails as a whole, try its amount clusters: a utility's one
//      mandate can carry the monthly instalment and the yearly settlement.
//      Payment facilitators (PayPal, Klarna, Amazon Payments …) are different
//      again: their one creditor ID and mandate collect for every shop the
//      user pays through them, so they prove nothing about any one of those
//      shops. Their bookings are split by the shop named in the purpose
//      ("Ihr Einkauf bei …") first, and each shop is judged like a series
//      without an arrangement — the Netflix subscription inside a PayPal
//      mandate is found, two purchases at different shops that happened to
//      cost about the same are not.
//
// The next booking is projected on the series' own calendar — the same day
// of the month, clamped to the month's end — and rolled to a TARGET2
// business day, which is when a bank actually books it: forward, as banks
// execute debits and standing orders, unless the series' history shows its
// payer paying early (salary due on a Saturday arrives on the Friday).
//
// Pure and node-test-safe: no path aliases, `.ts` on sibling imports.

import type { SerializedTransaction } from './fints-types';
import type { CategoryId, CategoryResult } from './categories';
import { facilitatorShop } from './analytics.ts';
import { categoryDef, counterpartyName, intermediaryName, txCreditorId as creditorIdOf } from './categories.ts';
import { bookingKind, foldText, guessCategory, isOwnAccount } from './categorize.ts';
import {
  addBusinessDays, addDaysKey, dayFromNumber, dayKey, dayNumber, isTargetBusinessDay, nextTargetBusinessDay, prettyBookingText,
} from './format.ts';
import { parsePurpose } from './sepa-purpose.ts';

export type Cadence = 'weekly' | 'monthly' | 'quarterly' | 'halfyearly' | 'yearly';

type CadenceDef = {
  id: Cadence;
  /** Nominal gap in days, and how far a gap may stray from it. */
  days: number;
  tol: number;
  /** Calendar months per step; 0 for the weekly rhythm, which counts days. */
  months: number;
  /** Fewest bookings that make a series. */
  min: number;
  perYear: number;
  label: string;
};

const CADENCES: readonly CadenceDef[] = [
  { id: 'weekly', days: 7, tol: 2, months: 0, min: 3, perYear: 52, label: 'wöchentlich' },
  { id: 'monthly', days: 30.4, tol: 4, months: 1, min: 3, perYear: 12, label: 'monatlich' },
  { id: 'quarterly', days: 91, tol: 8, months: 3, min: 2, perYear: 4, label: 'vierteljährlich' },
  { id: 'halfyearly', days: 182, tol: 12, months: 6, min: 2, perYear: 2, label: 'halbjährlich' },
  { id: 'yearly', days: 365, tol: 20, months: 12, min: 2, perYear: 1, label: 'jährlich' },
];

const CADENCE_BY_ID = new Map(CADENCES.map((c) => [c.id, c]));

/** "monatlich", "vierteljährlich", … */
export const cadenceLabel = (c: Cadence): string => CADENCE_BY_ID.get(c)?.label ?? '';

export type RecurringSeries = {
  /** Stable across reloads: a hash of the grouping key. What "Kein Vertrag" stores. */
  id: string;
  /** The grouping key itself, e.g. "out|cred:DE98ZZZ09999999999|mref:M-1". */
  key: string;
  kind: 'income' | 'expense';
  /** As the bank wrote it on the newest booking (raw — run it through displayName). */
  name: string;
  iban: string | null;
  creditorId: string | null;
  mandateReference: string | null;
  /** Collected by SEPA direct debit. */
  directDebit: boolean;
  /** The newest booking's category (the user's choice when categoryOf is given). */
  category: CategoryId;
  cadence: Cadence;
  cadenceLabel: string;
  /** Median gap between bookings, in days. */
  intervalDays: number;
  /** Typical signed amount — the current price after a price change. */
  amount: number;
  /** Signed. */
  lastAmount: number;
  previousAmount: number | null;
  /** The last amount differs from the one before by more than 1 % and 0,50. */
  changed: boolean;
  /** |last| − |previous| when `changed` (positive: it got bigger), else null. */
  change: number | null;
  /** The amount genuinely varies (salary, a phone bill) rather than being a fixed price. */
  variable: boolean;
  /** `amount` spread over a month / a year. Signed. */
  monthlyAmount: number;
  yearlyAmount: number;
  currency: string;
  count: number;
  /** yyyy-mm-dd, local Buchungstag. */
  firstDate: string;
  lastDate: string;
  /** The expected next booking, already rolled to a TARGET2 business day. */
  nextDate: string;
  /** The expected booking is more than five days late. */
  overdue: boolean;
  /** Two expected bookings have not come — most likely cancelled. Leave out of totals. */
  ended: boolean;
  /** Newest first. */
  transactions: SerializedTransaction[];
};

export type DetectOptions = {
  /** Default: now. */
  today?: Date;
  /**
   * The last day the loaded bookings cover (the applied range's `to`). A
   * series is only late relative to data that could have shown it; default
   * `today`.
   */
  until?: Date | string;
  ownIbans?: ReadonlySet<string> | readonly string[];
  /** Series ids the user dismissed with "Kein Vertrag". */
  dismissed?: readonly string[];
  /** The provider's categoryOf, so a series shows the category the user sees. */
  categoryOf?: (tx: SerializedTransaction) => CategoryResult;
};

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * A SEPA creditor identifier, from wherever the statement format put it — see
 * txCreditorId in lib/categories.ts, which this re-exports so the series key
 * and a user's category rule always name a creditor the same way.
 */
export function txCreditorId(tx: Pick<SerializedTransaction, 'purpose' | 'remoteBic' | 'creditorId'>): string | null {
  return creditorIdOf(tx);
}

/** The mandate reference, from its own field or, when the bank ran the tags together, the purpose. */
export function txMandate(tx: Pick<SerializedTransaction, 'purpose' | 'mandateReference'>): string | null {
  const own = String(tx.mandateReference ?? '').trim();
  if (own && !/^(NOTPROVIDED|NONREF)$/i.test(own)) return own.toUpperCase();
  const field = parsePurpose(tx.purpose).fields.find((f) => f.tag === 'MREF');
  return field?.value.trim().toUpperCase() || null;
}

const validIban = (s: string | null | undefined) => {
  const iban = String(s ?? '').replace(/\s+/g, '').toUpperCase();
  return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban) ? iban : null;
};

/**
 * cyrb53 (bryc, public domain): a fast 53-bit string hash. Ample for telling a
 * few hundred series apart, and stable across sessions and machines.
 */
function cyrb53(str: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** The id a series is stored under: "rec_" + base-36 hash of its key. */
export const seriesId = (key: string): string => `rec_${cyrb53(key).toString(36)}`;

// ---------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------

/** Whether two amounts (cents) differ by more than 1 % of the first and 0,50. */
const differs = (prev: number, next: number) => {
  const d = Math.abs(next - prev);
  return d * 100 > Math.abs(prev) && d > 50;
};

const median = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** Indices where an amount differs from the one before it. */
const changePoints = (abs: readonly number[]) => abs.flatMap((a, i) => (i > 0 && differs(abs[i - 1], a) ? [i] : []));

/**
 * A fixed price that changes now and then — the shape of a subscription:
 * most consecutive bookings are the same amount, and the first price was
 * seen at least twice. The opposite is a bill that differs every time.
 */
function priceSteps(abs: readonly number[]): boolean {
  const cps = changePoints(abs);
  return cps.length > 0 && cps.length * 2 <= abs.length - 1 && cps[0] >= 2;
}

/** The same amount every time, to the cent (one cent of rounding allowed). */
const identicalAmounts = (abs: readonly number[]) => Math.max(...abs) - Math.min(...abs) <= 1;

/** Coefficient of variation of the amounts; 0 for identical ones. */
function variation(abs: readonly number[]): number {
  const mean = abs.reduce((s, a) => s + a, 0) / abs.length;
  if (!(mean > 0)) return Infinity;
  const sd = Math.sqrt(abs.reduce((s, a) => s + (a - mean) ** 2, 0) / abs.length);
  return sd / mean;
}

function stableAmounts(abs: readonly number[], maxCv: number): boolean {
  return identicalAmounts(abs) || variation(abs) < maxCv || priceSteps(abs);
}

/**
 * The stricter reading for a series nothing but its history speaks for: a
 * fixed price that changed counts only as runs of exactly the same amount —
 * the 1 % / 0,50 slack of `priceSteps` would let a regular's lunch pass.
 */
function steadyAmounts(abs: readonly number[], maxCv: number): boolean {
  if (identicalAmounts(abs) || variation(abs) < maxCv) return true;
  const cps = abs.flatMap((a, i) => (i > 0 && Math.abs(a - abs[i - 1]) > 1 ? [i] : []));
  return cps.length > 0 && cps.length * 2 <= abs.length - 1 && cps[0] >= 2;
}

/**
 * The amount to expect next time (cents, unsigned). For a fixed price — even
 * one that has changed — the current price: the run of recent bookings at
 * the newest amount. For a genuinely varying amount (salary, a phone bill)
 * the median of the recent ones. With only two bookings there is no telling
 * the two apart, and the newer amount is the better guess.
 */
function typicalAmount(abs: readonly number[]): { typical: number; variable: boolean } {
  const last = abs[abs.length - 1];
  const fixed = abs.length <= 2 || changePoints(abs).length * 2 <= abs.length - 1;
  if (fixed) {
    let start = abs.length - 1;
    while (start > 0 && !differs(abs[start - 1], last) && !differs(last, abs[start - 1])) start--;
    return { typical: Math.round(median(abs.slice(start))), variable: false };
  }
  return { typical: Math.round(median(abs.slice(-6))), variable: true };
}

// ---------------------------------------------------------------------------
// Rhythm and the next date
// ---------------------------------------------------------------------------

type Occurrence = { tx: SerializedTransaction; day: string; n: number; abs: number };

function rhythmOf(occ: readonly Occurrence[]): { cadence: CadenceDef; interval: number } | null {
  if (occ.length < 2) return null;
  const gaps = occ.slice(1).map((o, i) => o.n - occ[i].n);
  const interval = median(gaps);
  const cadence = CADENCES.find((c) => Math.abs(interval - c.days) <= c.tol);
  if (!cadence) return null;
  // Most gaps must agree. One missed booking (a double gap) still agrees: a
  // subscription paused for a month is the same subscription.
  const fits = gaps.filter((g) => [1, 2].some((k) => Math.abs(g - k * cadence.days) <= k * cadence.tol)).length;
  if (fits < gaps.length * 0.75) return null;
  return { cadence, interval };
}

const lastDayOf = (y: number, m: number) => new Date(y, m, 0).getDate();
const pad2 = (n: number) => String(n).padStart(2, '0');

/** A day of the month in month `m` (1-based, may run past 12 or below 1), clamped to its end. */
function monthDay(y: number, m: number, anchor: number | 'end'): string {
  const yy = y + Math.floor((m - 1) / 12);
  const mm = ((((m - 1) % 12) + 12) % 12) + 1;
  const last = lastDayOf(yy, mm);
  return `${yy}-${pad2(mm)}-${pad2(anchor === 'end' ? last : Math.min(anchor, last))}`;
}

/**
 * The series' day of the month. Bookings that fell on a weekend were booked
 * a day or two late, so the day most bookings share wins; a salary paid on
 * "the last working day" shares no date at all and is anchored to the month's
 * end; failing both, the newest booking's day.
 */
function anchorDay(occ: readonly Occurrence[]): number | 'end' {
  const counts = new Map<number, number>();
  for (const o of occ) {
    const d = +o.day.slice(8, 10);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const strong = [...counts].filter(([, c]) => c * 2 >= occ.length).map(([d]) => d);
  if (strong.length) return Math.min(...strong);
  const nearEnd = occ.every((o) => lastDayOf(+o.day.slice(0, 4), +o.day.slice(5, 7)) - +o.day.slice(8, 10) <= 3);
  if (nearEnd) return 'end';
  return +occ[occ.length - 1].day.slice(8, 10);
}

/**
 * Which month's due date a booking settled, as a month number relative to the
 * booking's own year (may be 0 or 13): a booking on 2 March can be
 * February's 28th, rolled over the weekend.
 */
function nominalMonth(o: Occurrence, anchor: number | 'end'): number {
  const y = +o.day.slice(0, 4);
  const m = +o.day.slice(5, 7);
  let base = m;
  let bestGap = Infinity;
  for (const off of [-1, 0, 1]) {
    const gap = Math.abs(dayNumber(monthDay(y, m + off, anchor)) - o.n);
    if (gap < bestGap) {
      bestGap = gap;
      base = m + off;
    }
  }
  return base;
}

/**
 * Which way this payer moves a due date that is not a business day.
 *
 * Banks collect a direct debit or execute a standing order on the following
 * business day, and that is the default. Payroll does the opposite: salary
 * due on the 31st is paid on the Friday before. The series' own history
 * decides when it shows a weekend; without one, a month-end credit is taken
 * to be paid early.
 */
function rollsBackward(occ: readonly Occurrence[], anchor: number | 'end', income: boolean): boolean {
  let forward = 0;
  let backward = 0;
  for (const o of occ) {
    const nominal = monthDay(+o.day.slice(0, 4), nominalMonth(o, anchor), anchor);
    if (isTargetBusinessDay(nominal)) continue;
    const delta = o.n - dayNumber(nominal);
    if (delta > 0 && delta <= 4) forward++;
    else if (delta < 0 && delta >= -4) backward++;
  }
  if (forward !== backward) return backward > forward;
  return income && (anchor === 'end' || anchor >= 28);
}

function projectNext(occ: readonly Occurrence[], cadence: CadenceDef, income: boolean): string {
  const last = occ[occ.length - 1];
  const forward = (key: string) => dayKey(nextTargetBusinessDay(key));
  if (!cadence.months) return forward(addDaysKey(last.day, 7));

  const anchor = anchorDay(occ);
  const roll = rollsBackward(occ, anchor, income)
    ? (key: string) => dayKey(addBusinessDays(addDaysKey(key, 1), -1))
    : forward;
  const y = +last.day.slice(0, 4);
  const base = nominalMonth(last, anchor);
  let step = cadence.months;
  let next = roll(monthDay(y, base + step, anchor));
  while (next <= last.day) {
    step += cadence.months;
    next = roll(monthDay(y, base + step, anchor));
  }
  return next;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

type Group = {
  key: string;
  credit: boolean;
  occ: Occurrence[];
  cred: string | null;
  mref: string | null;
  salary: boolean;
  /** Collected by a payment facilitator for whichever shop was paid. */
  facilitator: boolean;
};

const nameKey = (raw: string | null | undefined) =>
  foldText(raw)
    .replace(/\b\d+\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Payment facilitators and marketplace collectors, on the folded name: "PAYPAL
 * EUROPE S A R L ET CIE S C A", "KLARNA BANK AB", "AMAZON PAYMENTS EUROPE S C A",
 * "GOOGLE PAYMENT IRELAND LTD". Their creditor ID is theirs, not the shop's.
 */
const FACILITATOR_NAME =
  /(^| )(PAYPAL|KLARNA|SOFORT|STRIPE|MOLLIE|ADYEN|SUMUP|UNZER|COMPUTOP|RATEPAY|RIVERTY|AFTERPAY|PAYONE|GIROPAY|PAYDIREKT|NOVALNET|SECUPAY|GOCARDLESS|WORLDLINE|SKRILL|PAYSAFE|TRUSTLY|PAYMENTS?)( |$)/;

const isFacilitator = (tx: SerializedTransaction) => FACILITATOR_NAME.test(foldText(tx.remoteName));

// How a facilitator introduces the shop it collected for: "Ihr Einkauf bei G2A.com".
const PURCHASE_LEAD =
  /(?:^|\s)(?:ihr\s+einkauf\s+bei|einkauf\s+bei|kauf\s+bei|bestellung\s+bei|zahlung\s+an|bezahlung\s+an|payment\s+to|purchase\s+at)\s+(.+)$/i;

/**
 * The shop behind a facilitator's booking, folded, or '' when the purpose
 * does not say. Order numbers and PayPal's own "PP.4711.PP" block are dropped,
 * so every purchase at one shop names it the same way.
 */
function innerMerchant(tx: SerializedTransaction): string {
  const text = parsePurpose(tx.purpose).text || String(tx.purpose ?? '');
  const lead = PURCHASE_LEAD.exec(text);
  const shop = lead ? lead[1] : text.replace(/\bPP\.[A-Z0-9.]+/gi, ' ').split(',')[0];
  return foldText(shop)
    .split(' ')
    .filter((w) => w && !/\d/.test(w) && w !== 'PP')
    .slice(0, 3)
    .join(' ');
}

/** Card payments here are habits — eating out, shopping, rides — unless the price never moves. */
const HABIT_CATEGORIES: ReadonlySet<CategoryId> = new Set<CategoryId>(['leisure', 'groceries', 'shopping', 'mobility']);

function groupKeyOf(tx: SerializedTransaction, credit: boolean, cred: string | null, mref: string | null): string | null {
  const dir = credit ? 'in' : 'out';
  // Behind a card processor every shop shares the processor's IBAN (and has
  // no mandate), so the IBAN would pour every Visa Debit payment into one
  // "series". The shop's own name is what separates them.
  if (intermediaryName(tx)) {
    const shop = nameKey(counterpartyName(tx));
    if (shop) return `${dir}|name:${shop}`;
  }
  const iban = validIban(tx.remoteIban);
  if (cred && mref) return `${dir}|cred:${cred}|mref:${mref}`;
  if (iban && mref) return `${dir}|iban:${iban}|mref:${mref}`;
  if (iban) return `${dir}|iban:${iban}`;
  if (cred) return `${dir}|cred:${cred}`;
  const name = nameKey(counterpartyName(tx));
  if (name) return `${dir}|name:${name}`;
  const text = foldText(tx.bookingText);
  return text ? `${dir}|text:${text}` : null;
}

/** Amount clusters of a group, each in date order: amounts within 2 % or 1,00 of their neighbour. */
function amountClusters(occ: readonly Occurrence[]): Occurrence[][] {
  const sorted = [...occ].sort((a, b) => a.abs - b.abs);
  const clusters: Occurrence[][] = [];
  for (const o of sorted) {
    const cur = clusters[clusters.length - 1];
    const prev = cur?.[cur.length - 1];
    if (prev && o.abs - prev.abs <= Math.max(100, prev.abs * 0.02)) cur.push(o);
    else clusters.push([o]);
  }
  return clusters.map((c) => c.sort((a, b) => a.n - b.n));
}

function buildSeries(
  key: string,
  group: Group,
  occ: readonly Occurrence[],
  ref: number,
  categoryOf: DetectOptions['categoryOf'],
  ownIbans: DetectOptions['ownIbans'],
): RecurringSeries | null {
  const newest = occ[occ.length - 1].tx;
  const kinds = occ.map((o) => bookingKind(o.tx));
  const directDebit = kinds[kinds.length - 1] === 'lastschrift';

  const rhythm = rhythmOf(occ);
  if (!rhythm) return null;
  const { cadence, interval } = rhythm;

  // A creditor ID or a mandate is a standing arrangement with that creditor —
  // unless the creditor is a facilitator collecting for every shop. A
  // standing order is one the user made. Anything else is only history.
  const arranged = (!group.facilitator && !!(group.cred || group.mref)) || kinds.every((k) => k === 'dauerauftrag');
  const min = !arranged
    ? Math.max(3, cadence.min)
    : cadence.id === 'monthly' && directDebit && group.cred ? 2 : cadence.min;
  if (occ.length < min) return null;

  const abs = occ.map((o) => o.abs);
  const category = categoryOf ? categoryOf(newest).id : guessCategory(newest, { ownIbans });
  if (arranged) {
    if (!stableAmounts(abs, group.salary ? 0.25 : 0.15)) return null;
  } else if (
    kinds.includes('karte')
    && (HABIT_CATEGORIES.has(category) || HABIT_CATEGORIES.has(guessCategory(newest, { ownIbans })))
  ) {
    if (!identicalAmounts(abs)) return null;
  } else if (!steadyAmounts(abs, group.salary ? 0.25 : 0.1)) {
    return null;
  }

  const sign = group.credit ? 1 : -1;
  const { typical, variable } = typicalAmount(abs);
  const lastAbs = abs[abs.length - 1];
  const prevAbs = abs.length > 1 ? abs[abs.length - 2] : null;
  const changed = prevAbs != null && differs(prevAbs, lastAbs);
  const nextDate = projectNext(occ, cadence, group.credit);
  const late = ref - 5 - dayNumber(nextDate);

  // Not the intermediary's IBAN, nor a payment service's: "Umsätze anzeigen"
  // would list every shop it serves.
  let iban: string | null = null;
  if (!intermediaryName(newest) && !group.facilitator) {
    for (let i = occ.length - 1; i >= 0 && !iban; i--) iban = validIban(occ[i].tx.remoteIban);
  }
  // A subscription paid through PayPal is the shop's ("Netflix"), as the
  // purpose names it — not "PayPal Europe S.à r.l. et Cie S.C.A".
  const shop = group.facilitator ? facilitatorShop(newest) : null;

  return {
    id: seriesId(key),
    key,
    kind: group.credit ? 'income' : 'expense',
    name: shop || counterpartyName(newest) || prettyBookingText(newest.bookingText) || 'Unbekannt',
    iban,
    creditorId: group.cred,
    mandateReference: group.mref,
    directDebit,
    category,
    cadence: cadence.id,
    cadenceLabel: cadence.label,
    intervalDays: interval,
    amount: (sign * typical) / 100,
    lastAmount: (sign * lastAbs) / 100,
    previousAmount: prevAbs == null ? null : (sign * prevAbs) / 100,
    changed,
    change: changed && prevAbs != null ? (lastAbs - prevAbs) / 100 : null,
    variable,
    monthlyAmount: Math.round((sign * typical * cadence.perYear) / 12) / 100,
    yearlyAmount: (sign * typical * cadence.perYear) / 100,
    currency: newest.currency || 'EUR',
    count: occ.length,
    firstDate: occ[0].day,
    lastDate: occ[occ.length - 1].day,
    nextDate,
    overdue: late > 0,
    ended: late > cadence.days,
    transactions: occ.map((o) => o.tx).reverse(),
  };
}

/**
 * The series inside one facilitator mandate. The whole mandate counts when
 * it only ever paid one shop (a PayPal account kept for Spotify); otherwise
 * each shop the purposes name is a group of its own, and within a shop a
 * steady price can still stand out from one-off orders. buildSeries judges
 * every candidate as having no arrangement behind it (`group.facilitator`):
 * three bookings, a steady amount.
 */
function facilitatorSeries(
  g: Group,
  build: (key: string, g: Group, occ: readonly Occurrence[]) => RecurringSeries | null,
  amountKey: (g: Group, occ: readonly Occurrence[]) => string,
): RecurringSeries[] {
  const byShop = new Map<string, Occurrence[]>();
  for (const o of g.occ) {
    const shop = innerMerchant(o.tx);
    const list = byShop.get(shop);
    if (list) list.push(o);
    else byShop.set(shop, [o]);
  }
  if (byShop.size === 1) {
    const whole = build(g.key, g, g.occ);
    if (whole) return [whole];
  }

  const out: RecurringSeries[] = [];
  const used = new Set<string>();
  const add = (shop: string, occ: readonly Occurrence[]) => {
    let key = amountKey(g, occ);
    // Two shops at the same price in euros: the shop tells them apart.
    if (used.has(key)) key = `${key}|shop:${shop}`;
    const s = used.has(key) ? null : build(key, g, occ);
    if (!s) return false;
    used.add(key);
    out.push(s);
    return true;
  };
  for (const [shop, occ] of byShop) {
    if (occ.length < 3) continue;
    if (byShop.size > 1 && add(shop, occ)) continue;
    for (const cluster of amountClusters(occ)) {
      if (cluster.length >= 3 && cluster.length < occ.length) add(shop, cluster);
    }
  }
  return out;
}

/** Every recurring series in the bookings, income first, then by monthly weight. */
export function detectRecurring(txs: readonly SerializedTransaction[], opts: DetectOptions = {}): RecurringSeries[] {
  const today = dayKey(opts.today ?? new Date());
  const until = opts.until ? dayKey(opts.until) : today;
  const ref = dayNumber(until && until < today ? until : today);
  const dismissed = new Set(opts.dismissed ?? []);
  const { ownIbans, categoryOf } = opts;

  const groups = new Map<string, Group>();
  for (const tx of txs) {
    const amount = Number(tx.amount);
    if (!amount || !Number.isFinite(amount)) continue;
    if (isOwnAccount(tx.remoteIban, ownIbans)) continue;
    const kind = bookingKind(tx);
    if (kind === 'bargeld' || kind === 'ruecklastschrift') continue;
    const guess = guessCategory(tx, { ownIbans });
    if (guess === 'transfer' || guess === 'cash') continue;
    if (guess === 'groceries' && kind !== 'lastschrift') continue;
    if (categoryOf && categoryDef(categoryOf(tx).id).neutral) continue;

    const day = dayKey(tx.entryDate || tx.valueDate);
    if (!day) continue;
    const credit = amount > 0;
    const cred = txCreditorId(tx);
    const mref = txMandate(tx);
    const identity = groupKeyOf(tx, credit, cred, mref);
    if (!identity) continue;
    // Amounts in different currencies are never one series. (EUR keys stay
    // bare so the ids users have dismissed do not change.)
    const currency = tx.currency || 'EUR';
    const key = currency === 'EUR' ? identity : `${identity}|${currency}`;

    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, credit, occ: [], cred, mref, salary: false, facilitator: false }));
    g.occ.push({ tx, day, n: dayNumber(day), abs: Math.abs(Math.round(amount * 100)) });
    if (credit && (kind === 'gehalt' || guess === 'income')) g.salary = true;
    if (isFacilitator(tx)) g.facilitator = true;
  }

  const out: RecurringSeries[] = [];
  const build = (key: string, g: Group, occ: readonly Occurrence[]) => buildSeries(key, g, occ, ref, categoryOf, ownIbans);
  /** "…|amt:13" — the euros a sub-series is filed under (keeps ids users dismissed stable). */
  const amountKey = (g: Group, occ: readonly Occurrence[]) => `${g.key}|amt:${Math.round(median(occ.map((o) => o.abs)) / 100)}`;

  for (const g of groups.values()) {
    g.occ.sort((a, b) => a.n - b.n);

    if (g.facilitator) {
      out.push(...facilitatorSeries(g, build, amountKey));
      continue;
    }

    const whole = build(g.key, g, g.occ);
    if (whole) {
      out.push(whole);
      continue;
    }
    if (g.occ.length < 3) continue;
    for (const cluster of amountClusters(g.occ)) {
      if (cluster.length < 2) continue;
      const s = build(amountKey(g, cluster), g, cluster);
      if (s) out.push(s);
    }
  }

  return out
    .filter((s) => !dismissed.has(s.id))
    .sort(
      (a, b) =>
        (a.kind === b.kind ? 0 : a.kind === 'income' ? -1 : 1) ||
        Math.abs(b.monthlyAmount) - Math.abs(a.monthlyAmount) ||
        a.name.localeCompare(b.name, 'de'),
    );
}

/**
 * The next expected booking of each live series within `days` days from
 * today (inclusive), soonest first — one entry per series.
 */
export function upcoming(
  series: readonly RecurringSeries[],
  opts: { today?: Date; days: number },
): { series: RecurringSeries; date: string }[] {
  const today = dayKey(opts.today ?? new Date());
  const horizon = dayFromNumber(dayNumber(today) + Math.max(0, opts.days));
  return series
    .filter((s) => !s.ended && !s.overdue && s.nextDate >= today && s.nextDate <= horizon)
    .map((s) => ({ series: s, date: s.nextDate }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : Math.abs(b.series.amount) - Math.abs(a.series.amount)));
}

/**
 * The slower rhythms a history of `days` days cannot be relied on to show:
 * a series needs two of its bookings inside the history, which only a
 * history of twice its rhythm guarantees. Ninety days can miss every
 * quarterly, half-yearly and yearly payment; a year still misses the yearly
 * ones (an insurance premium booked once in it is one booking, not a series).
 */
export function unseenCadences(days: number): Cadence[] {
  return CADENCES.filter((c) => c.months >= 3 && !(days >= 2 * c.days)).map((c) => c.id);
}

/** How the regular payments are grouped on the Verträge tab, in this order. */
export type RecurringFamily = 'housing' | 'media' | 'insurance' | 'other' | 'savings';

const FAMILY_OF: Partial<Record<CategoryId, RecurringFamily>> = {
  housing: 'housing',
  media: 'media',
  insurance: 'insurance',
  savings: 'savings',
};

export const RECURRING_FAMILY_LABEL: Record<RecurringFamily, string> = {
  housing: 'Wohnen & Energie',
  media: 'Abos & Medien',
  insurance: 'Versicherungen',
  other: 'Weitere Verträge',
  savings: 'Sparen & Anlegen',
};

const FAMILY_ORDER: readonly RecurringFamily[] = ['housing', 'media', 'insurance', 'other', 'savings'];

export type RecurringGroup = {
  id: RecurringFamily;
  label: string;
  /** Biggest monthly weight first. */
  series: RecurringSeries[];
  /** Positive, what the group's series in `currency` add up to. */
  monthly: number;
  yearly: number;
  currency: string;
};

/**
 * The regular payments out, grouped the way a household reads them: the
 * rent and its energy, subscriptions, insurance, everything else, and what is
 * put aside — each with its own monthly and yearly figure, so a Netflix is
 * not lost inside the rent. Ended series are not here; empty groups neither.
 */
export function recurringGroups(series: readonly RecurringSeries[], currency: string): RecurringGroup[] {
  const by = new Map<RecurringFamily, RecurringSeries[]>();
  for (const s of series) {
    if (s.kind !== 'expense' || s.ended) continue;
    const family = FAMILY_OF[s.category] ?? 'other';
    const list = by.get(family);
    if (list) list.push(s);
    else by.set(family, [s]);
  }
  return FAMILY_ORDER.filter((f) => by.has(f)).map((f) => {
    const list = by.get(f)!;
    const totals = recurringTotals(list, currency);
    return { id: f, label: RECURRING_FAMILY_LABEL[f], series: list, monthly: totals.monthlyExpense, yearly: totals.yearlyExpense, currency };
  });
}

/**
 * What the live series add up to per month — the "Fixkosten pro Monat ca."
 * figures. Ended series are left out. Positive numbers. Only series in
 * `currency` (default: the first one's) are added; currencies never mix.
 */
export function recurringTotals(
  series: readonly RecurringSeries[],
  currency: string = series[0]?.currency ?? 'EUR',
): { monthlyExpense: number; monthlyIncome: number; yearlyExpense: number; count: number; currency: string } {
  let expense = 0;
  let income = 0;
  let yearly = 0;
  let count = 0;
  for (const s of series) {
    if (s.ended || s.currency !== currency) continue;
    count++;
    const monthlyCents = Math.round(Math.abs(s.monthlyAmount) * 100);
    if (s.kind === 'expense') {
      expense += monthlyCents;
      yearly += Math.round(Math.abs(s.yearlyAmount) * 100);
    } else {
      income += monthlyCents;
    }
  }
  return { monthlyExpense: expense / 100, monthlyIncome: income / 100, yearlyExpense: yearly / 100, count, currency };
}
