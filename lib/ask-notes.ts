// Girovo AI's notes without asking (Girovo Next): at most three short things
// that stand out, said under the month recap and at the head of a fresh
// conversation (components/insights/ask/Notes.tsx).
//
//   spike        a payee or a category clearly above its usual in a month:
//                at least twice and at least 30 € more than its average over
//                the whole months before (at least three of them, at most
//                twelve), more than in any of those months, and only one
//                that was paid in at least half of
//                those months, so a one-off (a flight, a sofa) is no "usual".
//                On the Analyse's basis (lib/analytics.ts periodTotals and
//                topCounterparties: refunds netted, Umbuchungen left out).
//   newContract  a live contract or subscription whose first booking is at
//                most 45 days old (lib/recurring.ts detectRecurring).
//   double       the same amount to the same payee twice within three days,
//                neither booking part of a known series, no refund of it
//                since, and no round sum (50,00 € at a filling station or to
//                a friend is a habit, not a mistake).
//   budget       a Monatsbudget over in the month, or, in the running month
//                before the 20th, at least 90 % used up (lib/ask-budgets.ts
//                budgetToNote): the most used up one, never more than one.
//                Spent as the Analyse's budget tile counts it, every booking
//                of the category included.
//
// Bookings of a recognised series (a contract, the rent, a yearly insurance)
// count in none of these: a contract's price rise is already said by its
// notice (lib/contract-watch.ts), and a yearly bill is no spike.
//
// Calm by design: no notes is the normal case. Every figure is computed here
// from the bookings; nothing is guessed. Pure and node-test-safe: no path
// aliases, `.ts` on sibling imports.

import type { SerializedTransaction } from './fints-types';
import type { CategoryId } from './categories';
import type { RecurringSeries } from './recurring';
import { bookingDay, facilitatorShop, periodTotals, topCounterparties, type CategoryOf } from './analytics.ts';
import { categoryDef, counterpartyKey, counterpartyName, intermediaryName, txKey } from './categories.ts';
import { foldText } from './categorize.ts';
import { addDaysKey, dayNumber } from './format.ts';
import { budgetsToNote, monthBudgets } from './ask-budgets.ts';
import type { Budgets } from './budgets.ts';

/** Never more notes than this. */
export const NOTES_MAX = 3;
/** A spike: at least this many times the usual … */
export const SPIKE_TIMES = 2;
/** … and at least this much more, in cents. */
export const SPIKE_MIN_CENTS = 3000;
/** Whole months of history a spike needs, and the most it looks back. */
export const HISTORY_MIN = 3;
export const HISTORY_MAX = 12;
/** A contract is new while its first booking is at most this many days old. */
export const NEW_DAYS = 45;
/** Two equal debits at most this many days apart look like one charged twice. */
export const DOUBLE_DAYS = 3;
/** The smallest amount worth a word about a double debit, in cents. */
export const DOUBLE_MIN_CENTS = 2000;

export type SpikeNote = {
  kind: 'spike';
  key: string;
  /** yyyy-mm: the month it is about. */
  month: string;
  /**
   * A payee: its name as the bank wrote it (or the shop a payment service
   * collected for), its IBAN where that leads to its bookings only, and
   * whether a refund was netted in (then the list shows both ways).
   */
  payee: { name: string; iban?: string; refunds: boolean } | null;
  /** A category, when it is no payee. */
  category: CategoryId | null;
  /** The month's amount and the usual one (the average of the months before), positive cents. */
  cents: number;
  usualCents: number;
  /** The multiple, where it is a whole 2 or 3; else null ("deutlich mehr als sonst"). */
  times: 2 | 3 | null;
  /** The days the month's amount covers. */
  from: string;
  to: string;
};

export type NewContractNote = {
  kind: 'newContract';
  key: string;
  series: RecurringSeries;
  /** Its price, positive cents. */
  cents: number;
};

export type DoubleNote = {
  kind: 'double';
  key: string;
  /** As the bank wrote it (or the shop behind a payment service). */
  name: string;
  /** Where it leads to this payee's bookings only. */
  iban?: string;
  /** Each of the two, positive cents. */
  cents: number;
  /** The two days, the earlier first. */
  days: [string, string];
  /** The later of the two. */
  tx: SerializedTransaction;
};

export type BudgetNote = {
  kind: 'budget';
  key: string;
  /** yyyy-mm: the month it is about. */
  month: string;
  category: CategoryId;
  /** The budget and what the month spent, whole cents. */
  budget: number;
  spent: number;
  /** Over the budget (by `rest`), else nearly used up (`rest` left). */
  over: boolean;
  rest: number;
  /** The days the month's spending covers. */
  from: string;
  to: string;
};

export type AskNote = SpikeNote | NewContractNote | DoubleNote | BudgetNote;

export type NotesInput = {
  /** Every loaded booking the notes may read. */
  txs: readonly SerializedTransaction[];
  categoryOf: CategoryOf;
  currency: string;
  /** The first and last day the loaded bookings cover. */
  from: string;
  to: string;
  /** yyyy-mm: the month spikes and double debits are about. */
  month: string;
  today: string;
  /** Every series the detection found: live, ended and hidden alike. */
  series: readonly RecurringSeries[];
  /** The live contracts and subscriptions (Verträge & Abos' list): where a new one comes from. */
  live: readonly RecurringSeries[];
  /** Series a price notice already speaks about. */
  noticed?: readonly string[];
  /** Notes the user closed, by key. */
  dismissed?: { has(key: string): boolean };
  /** The Monatsbudgets (vault budgets), whole cents per category. */
  budgets?: Budgets;
};

const pad2 = (n: number) => String(n).padStart(2, '0');
const cents = (v: number) => Math.round(Number(v) * 100);
const monthStart = (month: string) => `${month}-01`;
function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${pad2(new Date(y, m, 0).getDate())}`;
}
function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
const validIban = (s: string | null | undefined) => {
  const iban = String(s ?? '').replace(/\s+/g, '').toUpperCase();
  return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban) ? iban : '';
};

/** "Doppelt" or "dreimal" only where the multiple is that, give or take a little. */
function wholeTimes(ratio: number): 2 | 3 | null {
  if (Math.abs(ratio - 2) < 0.05) return 2;
  if (Math.abs(ratio - 3) < 0.05) return 3;
  return null;
}

/**
 * The notes for `month`, the most pressing first: a double debit, then a
 * budget over or running out, then a new contract, then spikes by how far
 * they are above the usual. At most NOTES_MAX, none the user closed.
 */
export function askNotes(input: NotesInput): AskNote[] {
  const inSeries = new Set(input.series.flatMap((s) => s.transactions.map((tx) => txKey(tx))));
  const free = input.txs.filter((tx) => (tx.currency || 'EUR') === input.currency && !inSeries.has(txKey(tx)));
  const budget = budgetNote(input);
  // A budget's note already says its category is up.
  const spiked = spikes(input, free).filter((n) => !budget || n.category !== budget.category);
  const notes: AskNote[] = [...doubleDebits(input, free), ...(budget ? [budget] : []), ...newContracts(input), ...spiked];
  return notes.filter((n) => !input.dismissed?.has(n.key)).slice(0, NOTES_MAX);
}

/** The one budget note for the month, or null: the most used up budget worth one the user has not closed. */
function budgetNote(input: NotesInput): BudgetNote | null {
  if (!input.budgets || !Object.keys(input.budgets).length) return null;
  const m = monthBudgets(input.budgets, input.txs, {
    categoryOf: input.categoryOf, currency: input.currency, from: input.from, to: input.to, today: input.today, month: input.month,
  });
  for (const l of budgetsToNote(m, input.today)) {
    const over = l.state === 'over';
    const key = `budget|${m.month}|${l.id}|${over ? 'over' : 'near'}`;
    if (input.dismissed?.has(key)) continue;
    return { kind: 'budget', key, month: m.month, category: l.id, budget: l.budget, spent: l.spent, over, rest: l.rest, from: m.from, to: m.to };
  }
  return null;
}

/** The whole months before `month` the loaded bookings cover, the nearest first. */
export function historyMonths(month: string, from: string, to: string): string[] {
  const out: string[] = [];
  for (let i = 1; i <= HISTORY_MAX; i++) {
    const m = shiftMonth(month, -i);
    if (!from || monthStart(m) < from || monthEnd(m) > to) break;
    out.push(m);
  }
  return out;
}

function spikes(input: NotesInput, free: readonly SerializedTransaction[]): SpikeNote[] {
  const { month, categoryOf, currency, today } = input;
  const start = monthStart(month);
  if (!input.from || start < input.from) return [];
  const end = [monthEnd(month), input.to, today].sort()[0];
  if (end < start) return [];
  const history = historyMonths(month, input.from, input.to);
  if (history.length < HISTORY_MIN) return [];
  // Paid in at least half of the months before: only then is there a "usual".
  const regular = Math.max(HISTORY_MIN, Math.ceil(history.length / 2));
  const span = (from: string, to: string) => ({ categoryOf, currency, from, to });
  const payeesOf = (from: string, to: string) =>
    topCounterparties(free, { ...span(from, to), dir: 'out', limit: Number.POSITIVE_INFINITY });

  const judge = (now: number, before: readonly number[]) => {
    if (before.filter((c) => c > 0).length < regular) return null;
    const usual = Math.round(before.reduce((s, c) => s + c, 0) / history.length);
    if (usual <= 0 || now < SPIKE_TIMES * usual || now - usual < SPIKE_MIN_CENTS) return null;
    // A month like one before is no news: it has to be more than any of them.
    if (before.some((c) => c >= now)) return null;
    return { usual, times: wholeTimes(now / usual) };
  };

  const pastPayees = history.map((m) => new Map(payeesOf(monthStart(m), monthEnd(m)).map((p) => [p.key, cents(p.amount)])));
  const out: (SpikeNote & { excess: number })[] = [];
  // What the payees above their usual explain of each category's rise.
  const explained = new Map<CategoryId, number>();
  for (const p of payeesOf(start, end)) {
    // Cash is a category, not a payee; a nameless booking is the bank's own.
    if (p.cash || p.key.startsWith('text:') || p.key === 'name:?') continue;
    // The raw name, not the getter's translated "Ohne Namen": the note is said where it is shown.
    const name = facilitatorShop(p.sample) ?? counterpartyName(p.sample);
    if (!name) continue;
    const now = cents(p.amount);
    const hit = judge(now, pastPayees.map((m) => m.get(p.key) ?? 0));
    if (!hit) continue;
    const category = categoryOf(p.sample).id;
    explained.set(category, (explained.get(category) ?? 0) + now - hit.usual);
    out.push({
      kind: 'spike', key: `spike|${month}|p|${p.key}`, month,
      payee: { name, ...(p.iban ? { iban: p.iban } : {}), refunds: p.offsets > 0 }, category: null,
      cents: now, usualCents: hit.usual, times: hit.times, from: start, to: end, excess: now - hit.usual,
    });
  }

  const pastCategories = history.map((m) => {
    const t = periodTotals(free, span(monthStart(m), monthEnd(m)));
    return new Map(t.byCategory.map((c) => [c.id, cents(c.amount)]));
  });
  for (const c of periodTotals(free, span(start, end)).byCategory) {
    // "Sonstiges" says nothing about where the money went.
    if (c.id === 'other') continue;
    const now = cents(c.amount);
    const hit = judge(now, pastCategories.map((m) => m.get(c.id) ?? 0));
    if (!hit) continue;
    // A payee already said it: Lieferando three times as much is why Essen & Trinken is up.
    if ((explained.get(c.id) ?? 0) * 2 >= now - hit.usual) continue;
    out.push({
      kind: 'spike', key: `spike|${month}|c|${c.id}`, month, payee: null, category: c.id,
      cents: now, usualCents: hit.usual, times: hit.times, from: start, to: end, excess: now - hit.usual,
    });
  }
  return out.sort((a, b) => b.excess - a.excess).map(({ excess: _, ...note }) => note);
}

function newContracts(input: NotesInput): NewContractNote[] {
  const since = addDaysKey(input.today, -NEW_DAYS);
  const noticed = new Set(input.noticed ?? []);
  // New only where the loaded bookings reach one step of its rhythm before its first booking:
  // in a short window every old contract would look new.
  const seenBefore = (s: RecurringSeries) => addDaysKey(s.firstDate, -Math.max(1, Math.round(s.everyDays ?? s.intervalDays))) >= input.from;
  return input.live
    .filter((s) => s.kind === 'expense' && !s.ended && !s.manual && !noticed.has(s.id)
      && s.firstDate >= since && s.firstDate <= input.today && seenBefore(s))
    .sort((a, b) => (a.firstDate < b.firstDate ? 1 : a.firstDate > b.firstDate ? -1 : 0))
    .map((s) => ({ kind: 'newContract', key: `new|${s.id}`, series: s, cents: Math.abs(cents(s.amount)) }));
}

/** Who a booking is paid to, as topCounterparties groups it; null for cash and the bank's own. */
function payeeKey(tx: SerializedTransaction): { key: string; name: string; iban: string } | null {
  const shop = facilitatorShop(tx);
  const key = shop ? `shop:${foldText(shop)}` : counterpartyKey(tx);
  if (key === 'name:?') return null;
  // A payment service's or a card processor's IBAN would lead to every shop it serves.
  const iban = shop || intermediaryName(tx) ? '' : validIban(tx.remoteIban);
  return { key, name: shop ?? counterpartyName(tx), iban };
}

function doubleDebits(input: NotesInput, free: readonly SerializedTransaction[]): DoubleNote[] {
  const start = monthStart(input.month);
  const end = monthEnd(input.month);
  const groups = new Map<string, { name: string; iban: string; rows: { tx: SerializedTransaction; day: string; c: number }[] }>();
  for (const tx of free) {
    const id = input.categoryOf(tx).id;
    if (categoryDef(id).neutral || id === 'cash') continue;
    const who = payeeKey(tx);
    const day = bookingDay(tx);
    if (!who || !day) continue;
    let g = groups.get(who.key);
    if (!g) groups.set(who.key, (g = { name: who.name, iban: who.iban, rows: [] }));
    g.rows.push({ tx, day, c: cents(tx.amount) });
  }
  const out: DoubleNote[] = [];
  for (const [key, g] of groups) {
    const rows = [...g.rows].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    const found = new Map<number, DoubleNote>();
    for (let j = 0; j < rows.length; j++) {
      const b = rows[j];
      if (b.c >= 0 || -b.c < DOUBLE_MIN_CENTS || -b.c % 500 === 0 || b.day < start || b.day > end) continue;
      for (let i = j - 1; i >= 0; i--) {
        const a = rows[i];
        if (dayNumber(b.day) - dayNumber(a.day) > DOUBLE_DAYS) break;
        // The same key is one booking read twice, not two.
        if (a.c !== b.c || txKey(a.tx) === txKey(b.tx)) continue;
        // Refunded since: already put right.
        if (rows.some((r) => r.c === -b.c && r.day >= a.day)) break;
        found.set(-b.c, {
          kind: 'double', key: `double|${key}|${-b.c}|${a.day}|${b.day}`, name: g.name, ...(g.iban ? { iban: g.iban } : {}),
          cents: -b.c, days: [a.day, b.day], tx: b.tx,
        });
        break;
      }
    }
    out.push(...found.values());
  }
  return out.sort((a, b) => (a.days[1] < b.days[1] ? 1 : a.days[1] > b.days[1] ? -1 : 0));
}
