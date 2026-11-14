// Girovo API, phase 1: the read methods (docs/girovo-api.md, Methods). Each
// takes a snapshot of what the page has loaded (ApiData, gathered by
// components/api/ApiHost.tsx from the provider's own selectors) and answers
// in the app's own terms: amounts in whole cents with their currency, days
// as yyyy-mm-dd, categories by id and name.
//
// No internal key leaves: an account and a booking are named by an opaque
// id (a hash of the app's own key, the same for the same booking as long as
// the bank sends it the same way), never by the vault's keys or the
// session's account numbers.
//
// Pure and node-test-safe.

import type { SerializedAccount, SerializedBalance, SerializedTransaction } from '../fints-types';
import type { CategoryId, CustomCategory } from '../categories';
import type { ContractReminder } from '../contract-watch';
import type { RecurringSeries } from '../recurring';
import type { Budgets } from '../budgets';
import type { SavingsGoal } from '../savings-goal';
import { periodTotals, txMatcher, type CategoryOf } from '../analytics.ts';
import { budgetLines, monthCoverage, type MonthCoverage } from '../budgets.ts';
import { counterpartyName, txKey } from '../categories.ts';
import { bankDay, dayKey } from '../format.ts';
import { goalProgress } from '../savings-goal.ts';
import type { ApiErrorCode } from './types.ts';

export type Money = { cents: number; currency: string };

/** One account of the view, as the page knows it. */
export type ApiAccountInput = {
  /** The session's key for it (accountNumber); never sent. */
  key: string;
  account: SerializedAccount;
  /** What the app calls it: the user's name for it, else the bank's product or type. */
  label: string;
  /** The bank's name. */
  bank: string;
  balance: SerializedBalance | null;
};

/** Everything the read methods answer from. */
export type ApiData = {
  accounts: readonly ApiAccountInput[];
  /** Loaded bookings per account key. */
  txByAccount: Readonly<Record<string, readonly SerializedTransaction[]>>;
  categoryOf: CategoryOf;
  categoryName: (id: CategoryId) => string;
  noteOf: (tx: SerializedTransaction) => string | null | undefined;
  /** The Analyse's bookings across the loaded accounts (card bills left out), or null while none are loaded. */
  scope: { txs: readonly SerializedTransaction[]; from: string; to: string; currency: string } | null;
  /** Verträge & Abos: the live series (income and expense), not the ended or hidden ones. */
  contracts: readonly RecurringSeries[];
  budgets: Budgets;
  goals: readonly SavingsGoal[];
  /** yyyy-mm-dd */
  today: string;
  /** Phase 2 (lib/api/writes.ts): the user's own categories, for checking a category id. */
  customCategories?: readonly CustomCategory[];
  /** Verträge & Abos' cancellation reminders, by the series' own id. */
  reminders?: Readonly<Record<string, ContractReminder>>;
};

/**
 * A method's answer, or why it can't answer: `invalid` names the parameter
 * (the router answers `invalid` with `data.param` and any `data` beside it);
 * `fail` is any other refusal (`not_permitted` with a reason, `bank_error`,
 * `refused_by_user`, …).
 */
export type MethodOutcome =
  | { result: unknown }
  | { invalid: string; data?: Record<string, unknown> }
  | { fail: ApiErrorCode; data?: unknown; message?: string };

// ---------------------------------------------------------------------------
// Opaque ids
// ---------------------------------------------------------------------------

/** cyrb53: a fast 53-bit string hash. Not a secret, only a name that does not spell out the key. */
function hash53(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export const accountId = (key: string): string => `a_${hash53(`acct|${key}`)}`;
export const seriesId = (id: string): string => `c_${hash53(`series|${id}`)}`;

const cents = (v: number) => Math.round(Number(v) * 100);
const money = (amount: number, currency: string): Money => ({ cents: cents(amount), currency: currency || 'EUR' });

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const isDay = (v: unknown): v is string => typeof v === 'string' && DAY.test(v) && Number.isFinite(Date.parse(v));
const isMonth = (v: unknown): v is string => typeof v === 'string' && MONTH.test(v) && +v.slice(5) >= 1 && +v.slice(5) <= 12;
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Params as an object: absent is {}, anything but an object is wrong. */
function paramsOf(params: unknown): Record<string, unknown> | null {
  if (params === undefined || params === null) return {};
  return isRecord(params) ? params : null;
}

const lastDayOf = (month: string) => {
  const d = new Date(+month.slice(0, 4), +month.slice(5, 7), 0);
  return `${month}-${String(d.getDate()).padStart(2, '0')}`;
};

// ---------------------------------------------------------------------------
// accounts.list
// ---------------------------------------------------------------------------

export function accountsList(data: ApiData): MethodOutcome {
  const totals = new Map<string, number>();
  const accounts = data.accounts.map((a) => {
    const currency = a.balance?.currency || a.account.currency || 'EUR';
    if (a.balance) totals.set(currency, (totals.get(currency) ?? 0) + cents(a.balance.balance));
    return {
      id: accountId(a.key),
      name: a.label,
      type: a.account.accountType,
      ...(a.account.product?.trim() ? { product: a.account.product.trim() } : {}),
      iban: a.account.iban || null,
      currency: a.account.currency || 'EUR',
      bank: a.bank,
      balance: a.balance ? { ...money(a.balance.balance, currency), day: dayKey(a.balance.date) } : null,
      available: a.balance && a.balance.availableAmount != null ? money(a.balance.availableAmount, currency) : null,
    };
  });
  // The Gesamtsaldo: the balances read so far, one sum per currency (currencies are never added together).
  const total = [...totals].map(([currency, c]) => ({ cents: c, currency }));
  return { result: { accounts, total } };
}

// ---------------------------------------------------------------------------
// transactions.list
// ---------------------------------------------------------------------------

export const TX_LIMIT = { default: 100, max: 500 } as const;

type Row = { key: string; tx: SerializedTransaction; id: string; day: string };

/** Every loaded booking, newest first, each with its opaque id (a second identical booking gets "-2"). */
function allRows(data: ApiData): Row[] {
  const rows: Row[] = [];
  for (const a of data.accounts) {
    const seen = new Map<string, number>();
    for (const tx of data.txByAccount[a.key] ?? []) {
      const base = `t_${hash53(`${a.key}|${txKey(tx)}`)}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      rows.push({ key: a.key, tx, id: n > 1 ? `${base}-${n}` : base, day: bankDay(tx) });
    }
  }
  return rows.sort((x, y) => (x.day < y.day ? 1 : x.day > y.day ? -1 : 0) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

/** The loaded booking an opaque id names, with its account's key; null when none does (any more). */
export function findBooking(data: ApiData, id: unknown): { key: string; tx: SerializedTransaction } | null {
  if (typeof id !== 'string' || !/^t_[0-9a-z]{1,14}(?:-\d{1,4})?$/.test(id)) return null;
  const row = allRows(data).find((r) => r.id === id);
  return row ? { key: row.key, tx: row.tx } : null;
}

/** The account an opaque id names, or null. */
export function findAccount(data: ApiData, id: unknown): ApiAccountInput | null {
  if (typeof id !== 'string' || id.length > 20) return null;
  return data.accounts.find((a) => accountId(a.key) === id) ?? null;
}

/** The live contract an opaque id names (Verträge & Abos), or null. */
export function findSeries(data: ApiData, id: unknown): RecurringSeries | null {
  if (typeof id !== 'string' || id.length > 20) return null;
  return data.contracts.find((s) => seriesId(s.id) === id) ?? null;
}

/** A booking as the read methods answer it (transactions.list), for the events. */
export function bookingById(data: ApiData, id: string) {
  const row = allRows(data).find((r) => r.id === id);
  return row ? bookingOf(data, row) : null;
}

/** Every loaded booking's opaque id, per account key: what the events compare. */
export function bookingIds(data: ApiData): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const r of allRows(data)) {
    const set = out.get(r.key);
    if (set) set.add(r.id);
    else out.set(r.key, new Set([r.id]));
  }
  return out;
}

function bookingOf(data: ApiData, row: Row) {
  const { tx } = row;
  const currency = tx.currency || 'EUR';
  const cat = data.categoryOf(tx);
  const note = data.noteOf(tx);
  const name = counterpartyName(tx);
  return {
    id: row.id,
    account: accountId(row.key),
    day: row.day,
    valueDay: dayKey(tx.valueDate) || row.day,
    amount: money(tx.amount, currency),
    counterparty: { name, ...(tx.remoteIban ? { iban: tx.remoteIban } : {}) },
    purpose: tx.purpose || '',
    bookingText: tx.bookingText || '',
    category: { id: cat.id, name: data.categoryName(cat.id) },
    ...(cat.parts?.length
      ? { split: cat.parts.map((p) => ({ category: { id: p.id, name: data.categoryName(p.id) }, amount: money(p.amount, currency) })) }
      : {}),
    ...(note ? { note } : {}),
  };
}

/**
 * `{ account?, from?, to?, query?, category?, limit?, cursor? }` → the
 * bookings newest first, at most `limit` (1 to 500, default 100), and
 * `next`, the cursor for the ones after, while there are more. A category
 * matches a booking filed under it or with a share of it.
 */
export function transactionsList(data: ApiData, params: unknown): MethodOutcome {
  const p = paramsOf(params);
  if (!p) return { invalid: 'params' };
  if (p.account !== undefined && typeof p.account !== 'string') return { invalid: 'account' };
  if (p.from !== undefined && !isDay(p.from)) return { invalid: 'from' };
  if (p.to !== undefined && !isDay(p.to)) return { invalid: 'to' };
  if (p.query !== undefined && (typeof p.query !== 'string' || p.query.length > 200)) return { invalid: 'query' };
  if (p.category !== undefined && (typeof p.category !== 'string' || p.category.length > 40)) return { invalid: 'category' };
  const limit = p.limit === undefined ? TX_LIMIT.default : p.limit;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > TX_LIMIT.max) return { invalid: 'limit' };
  let offset = 0;
  if (p.cursor !== undefined) {
    if (typeof p.cursor !== 'string' || !/^o[0-9a-z]{1,8}$/.test(p.cursor)) return { invalid: 'cursor' };
    offset = parseInt(p.cursor.slice(1), 36);
  }
  const account = p.account as string | undefined;
  if (account && !data.accounts.some((a) => accountId(a.key) === account)) return { invalid: 'account' };
  const from = p.from as string | undefined;
  const to = p.to as string | undefined;
  const category = p.category as string | undefined;
  const matches = p.query ? txMatcher(p.query as string, { categoryOf: data.categoryOf, noteOf: data.noteOf }) : null;
  const rows = allRows(data).filter((r) => {
    if (account && accountId(r.key) !== account) return false;
    if (from && r.day < from) return false;
    if (to && r.day > to) return false;
    if (category) {
      const c = data.categoryOf(r.tx);
      if (c.id !== category && !c.parts?.some((part) => part.id === category)) return false;
    }
    return !matches || matches(r.tx);
  });
  const page = rows.slice(offset, offset + limit);
  const end = offset + page.length;
  return {
    result: {
      transactions: page.map((r) => bookingOf(data, r)),
      ...(end < rows.length ? { next: `o${end.toString(36)}` } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// contracts.list
// ---------------------------------------------------------------------------

export function contractsList(data: ApiData): MethodOutcome {
  const contracts = data.contracts.map((s) => ({
    id: seriesId(s.id),
    name: s.customName ?? s.name,
    kind: s.kind,
    cadence: s.cadence,
    amount: money(s.amount, s.currency),
    perMonth: money(s.monthlyAmount, s.currency),
    perYear: money(s.yearlyAmount, s.currency),
    category: { id: s.category, name: data.categoryName(s.category) },
    directDebit: s.directDebit,
    lastDay: s.lastDate,
    nextDay: s.nextDate,
    ...(s.overdue ? { overdue: true } : {}),
    ...(s.priceChange ? { priceChange: { since: s.priceChange.since, previous: money(s.priceChange.previous, s.currency) } } : {}),
  }));
  return { result: { contracts } };
}

// ---------------------------------------------------------------------------
// insights.month, budgets.list
// ---------------------------------------------------------------------------

/** One month as the Analyse sees it: the part of it that is loaded, and how much that is. */
function monthStretch(data: ApiData, month: string): { from: string; to: string; coverage: MonthCoverage } {
  const first = `${month}-01`;
  const last = lastDayOf(month);
  const s = data.scope;
  if (!s || s.to < first || s.from > last) return { from: first, to: last, coverage: 'none' };
  const from = s.from > first ? s.from : first;
  const to = s.to < last ? s.to : last;
  return { from, to, coverage: monthCoverage({ month, from, to }, data.today) };
}

/** `{ month: "yyyy-mm" }` → the Analyse's figures of that month over the loaded accounts. */
export function insightsMonth(data: ApiData, params: unknown): MethodOutcome {
  const p = paramsOf(params);
  if (!p) return { invalid: 'params' };
  const month = p.month === undefined ? data.today.slice(0, 7) : p.month;
  if (!isMonth(month)) return { invalid: 'month' };
  const stretch = monthStretch(data, month);
  const currency = data.scope?.currency ?? 'EUR';
  const t = data.scope && stretch.coverage !== 'none'
    ? periodTotals(data.scope.txs, { categoryOf: data.categoryOf, from: stretch.from, to: stretch.to, currency })
    : null;
  const rows = (list: NonNullable<typeof t>['byCategory']) =>
    list.map((c) => ({ category: { id: c.id, name: data.categoryName(c.id) }, amount: money(c.amount, currency), count: c.count }));
  return {
    result: {
      month,
      from: stretch.from,
      to: stretch.to,
      /** complete, running (this month), partial (not all of it loaded), none. */
      coverage: stretch.coverage,
      currency,
      income: money(t?.income ?? 0, currency),
      expense: money(t?.expense ?? 0, currency),
      net: money(t?.net ?? 0, currency),
      count: t?.count ?? 0,
      expenseByCategory: t ? rows(t.byCategory) : [],
      incomeByCategory: t ? rows(t.incomeByCategory) : [],
      /** Umbuchungen between own accounts, left out of every figure. */
      transfersLeftOut: t?.excluded ?? 0,
    },
  };
}

/** `{ month? }` (default this month) → each Monatsbudget against that month's spending. */
export function budgetsList(data: ApiData, params: unknown): MethodOutcome {
  const p = paramsOf(params);
  if (!p) return { invalid: 'params' };
  const month = p.month === undefined ? data.today.slice(0, 7) : p.month;
  if (!isMonth(month)) return { invalid: 'month' };
  const stretch = monthStretch(data, month);
  const currency = data.scope?.currency ?? 'EUR';
  const spending = data.scope && stretch.coverage !== 'none'
    ? periodTotals(data.scope.txs, { categoryOf: data.categoryOf, from: stretch.from, to: stretch.to, currency }).byCategory
    : [];
  const budgets = budgetLines(data.budgets, spending, stretch.coverage).map((l) => ({
    category: { id: l.id, name: data.categoryName(l.id) },
    budget: { cents: l.budget, currency },
    spent: { cents: l.spent, currency },
    /** left, exact, over, or unknown (under it so far, but the month is not all loaded). */
    state: l.state,
    rest: { cents: l.rest, currency },
  }));
  return { result: { month, coverage: stretch.coverage, budgets } };
}

// ---------------------------------------------------------------------------
// goals.list
// ---------------------------------------------------------------------------

export function goalsList(data: ApiData): MethodOutcome {
  const today = new Date(`${data.today}T12:00:00`);
  const goals = data.goals.map((g) => {
    const a = data.accounts.find((x) => x.key === g.accountNumber);
    const currency = a?.balance?.currency || a?.account.currency || 'EUR';
    const progress = a?.balance ? goalProgress(g, cents(a.balance.balance), today) : null;
    return {
      account: accountId(g.accountNumber),
      name: g.name,
      target: { cents: g.target, currency },
      ...(g.by ? { by: g.by } : {}),
      // Progress is the account's balance as the bank reported it: none while it is not read.
      ...(progress && a?.balance
        ? {
          balance: money(a.balance.balance, currency),
          reached: progress.reached,
          missing: { cents: progress.missing, currency },
          ...(progress.perMonth != null ? { perMonth: { cents: progress.perMonth, currency } } : {}),
        }
        : {}),
    };
  });
  return { result: { goals } };
}
