// Monthly budgets: how much the user means to spend in a month in one
// spending category, and how a month of bookings stands against that.
//
// A budget is the user's own figure, kept in the vault as whole cents per
// CategoryId (no currency: it is read in the currency the Umsatzanalyse sums,
// the active account's). Only the spending side has one — income and the
// Umbuchungen between the user's own accounts are nothing to budget. The two
// categories that can go either way ("Bankentgelte & Zinsen", "Sonstiges")
// are measured on their spending side, as "Ausgaben nach Kategorie" is.
//
// What a month spent in a category is exactly that category's row in
// "Ausgaben nach Kategorie" for the month and the accounts the Analyse adds
// up (lib/analytics.ts periodTotals): booked Umsätze only, Umbuchungen left
// out, a shop's refund netted against its category, other currencies set
// aside. A Vormerkposten counts once it is booked, in the month of its
// Buchungstag.
//
// The data horizon decides what may be said. The app knows only the loaded
// days: a month they do not cover from its first day — or that they leave
// before its end without reaching today — is partial. Its spending is then a
// floor ("mindestens"), never a month's total, so nothing is "übrig" there;
// only being over the budget is certain. (A refund on one of the missing days
// would lower the month after all — rare enough that the floor is what is
// said, and the note says which days are loaded.) The running month is covered up to
// today, and what is left is what is left for its remaining days.
//
// Pure and node-test-safe: no path aliases, `.ts` on sibling imports.

import type { CategoryId } from './categories';
import { CATEGORIES, categoryDef } from './categories.ts';
import { parseAmount } from './format.ts';
import type { Locale } from './i18n/locale.ts';

/** CategoryId → the monthly budget in whole cents. */
export type Budgets = Partial<Record<CategoryId, number>>;

/** The largest budget a category can carry: 999.999,99 €. */
export const BUDGET_MAX_CENTS = 99_999_999;

/** Whether a category can carry a budget: the spending side, never income or an Umbuchung. */
export function isBudgetCategory(id: CategoryId): boolean {
  const def = categoryDef(id);
  return def.id === id && def.direction !== 'in' && !def.neutral;
}

/** The categories a budget can be set for, in the app's own order. */
export const BUDGET_CATEGORIES: readonly CategoryId[] = CATEGORIES.map((c) => c.id).filter(isBudgetCategory);

/** A budget as the vault may hold it: whole cents, above zero, at most BUDGET_MAX_CENTS. */
export function budgetCents(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= BUDGET_MAX_CENTS ? v : null;
}

/**
 * The budgets as this version understands them: spending categories only,
 * valid amounts only, in the app's category order. Anything else — an income
 * category, a fraction of a cent, a string, a prototype key — is dropped.
 */
export function sanitizeBudgets(v: unknown): Budgets {
  const out: Budgets = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  const rec = v as Record<string, unknown>;
  for (const id of BUDGET_CATEGORIES) {
    if (!Object.prototype.hasOwnProperty.call(rec, id)) continue;
    const cents = budgetCents(rec[id]);
    if (cents !== null) out[id] = cents;
  }
  return out;
}

/** What a typed budget reads as: cents, nothing (an empty field), or why it is no budget. */
export type BudgetInput =
  | { cents: number | null; error: null }
  | { cents: null; error: 'format' | 'notPositive' | 'tooLarge' };

/**
 * A budget as the user typed it, read the way the interface language writes
 * amounts (lib/format.ts parseAmount): "250", "250,50", "1.200" in German,
 * "250.50", "1,200" in English. Empty is no budget at all.
 */
export function parseBudgetInput(text: string, locale?: Locale): BudgetInput {
  if (!String(text ?? '').trim()) return { cents: null, error: null };
  const n = parseAmount(text, locale);
  if (n == null) return { cents: null, error: 'format' };
  const cents = Math.round(n * 100);
  if (cents <= 0) return { cents: null, error: 'notPositive' };
  if (cents > BUDGET_MAX_CENTS) return { cents: null, error: 'tooLarge' };
  return { cents, error: null };
}

// ---------------------------------------------------------------------------
// A month against its budgets
// ---------------------------------------------------------------------------

/**
 * How much of a calendar month the loaded days cover:
 *   complete — every day of it, and it is over
 *   running  — from its first day up to today, and it is not over yet
 *   partial  — the loaded days start after its first day, or end before its
 *              last without reaching today: its figures are a floor
 *   none     — nothing of it is loaded (or it lies before the first booking)
 */
export type MonthCoverage = 'complete' | 'running' | 'partial' | 'none';

const pad2 = (n: number) => String(n).padStart(2, '0');
const lastDayOf = (month: string) => {
  const y = +month.slice(0, 4);
  const m = +month.slice(5, 7);
  return `${month}-${pad2(new Date(y, m, 0).getDate())}`;
};

/**
 * The coverage of one month of the analysis. `stretch` is the part of the
 * month inside the loaded days, as the Analyse's month buckets carry it
 * (yyyy-mm and yyyy-mm-dd, both ends included); `today` is yyyy-mm-dd.
 * `noData`: the month lies wholly before the first booking in scope — the
 * bank may simply have delivered less, so it is not a month without spending.
 */
export function monthCoverage(
  stretch: { month: string; from: string; to: string; noData?: boolean },
  today: string,
): MonthCoverage {
  const { month, from, to } = stretch;
  if (stretch.noData || !/^\d{4}-\d{2}$/.test(month) || !from || !to || from > to) return 'none';
  const first = `${month}-01`;
  const last = lastDayOf(month);
  if (from > first) return 'partial';
  if (to >= last) return last < today ? 'complete' : 'running';
  return to >= today ? 'running' : 'partial';
}

/**
 * left    — under the budget; `rest` is what remains
 * exact   — spent to the cent
 * over    — above the budget; `rest` is by how much (with a partial month, at least that)
 * unknown — under the budget so far, but the month is not fully loaded: what
 *           is left cannot be said
 */
export type BudgetState = 'left' | 'exact' | 'over' | 'unknown';

export type BudgetLine = {
  id: CategoryId;
  /** The budget, whole cents. */
  budget: number;
  /** What the month spent in the category, whole cents (never below zero). A floor when the month is partial. */
  spent: number;
  /** The bookings behind `spent`. */
  count: number;
  state: BudgetState;
  /** Whole cents: what is left ('left'), how far over ('over'), else 0. */
  rest: number;
  /** spent ÷ budget, capped at 1 — the fill of a bar. */
  share: number;
};

/**
 * Every budget of `budgets` against one month's spending — `spending` is the
 * month's "Ausgaben nach Kategorie" (periodTotals().byCategory: positive
 * euros, refunds netted). A budgeted category the month spent nothing in is
 * listed with 0. In the app's category order.
 */
export function budgetLines(
  budgets: Budgets,
  spending: readonly { id: CategoryId; amount: number; count: number }[],
  coverage: MonthCoverage,
): BudgetLine[] {
  const byId = new Map(spending.map((s) => [s.id, s]));
  const known = coverage === 'complete' || coverage === 'running';
  const out: BudgetLine[] = [];
  for (const id of BUDGET_CATEGORIES) {
    const budget = budgetCents(budgets[id]);
    if (budget === null) continue;
    const row = byId.get(id);
    const spent = row ? Math.max(0, Math.round(row.amount * 100)) : 0;
    let state: BudgetState;
    let rest = 0;
    if (spent > budget) {
      state = 'over';
      rest = spent - budget;
    } else if (!known) {
      state = 'unknown';
    } else if (spent === budget) {
      state = 'exact';
    } else {
      state = 'left';
      rest = budget - spent;
    }
    out.push({ id, budget, spent, count: row?.count ?? 0, state, rest, share: Math.min(1, spent / budget) });
  }
  return out;
}

/**
 * Average monthly spending per category over whole months — a guide when a
 * budget is set. `months` holds each complete month's "Ausgaben nach
 * Kategorie"; a category a month spent nothing in counts as 0 for it. Whole
 * cents; empty without a month.
 */
export function averageByCategory(
  months: readonly (readonly { id: CategoryId; amount: number }[])[],
): Map<CategoryId, number> {
  const out = new Map<CategoryId, number>();
  if (!months.length) return out;
  const sums = new Map<CategoryId, number>();
  for (const month of months) {
    for (const row of month) sums.set(row.id, (sums.get(row.id) ?? 0) + Math.round(row.amount * 100));
  }
  for (const [id, cents] of sums) out.set(id, Math.round(cents / months.length));
  return out;
}
