'use client';

// The numbers behind the Umsatzanalyse, derived from bookings that are already
// loaded. Nothing here talks to the bank.
//
// Two decisions shape every figure:
// - Scope. "Dieses Konto" is the active account over the range it was loaded
//   for. "Alle geladenen Konten" adds the other accounts the session has
//   loaded — but only those in the same currency (amounts in different
//   currencies are never added), and only over the stretch of days that every
//   one of them covers. Accounts loaded for different periods would otherwise
//   make a month look expensive just because one account reaches further back.
// - Period. The whole scope range, or one calendar month of it. A month the
//   range cuts — or the current one — is partial and labelled as such. A
//   month before the first booking is not a month without spending: the bank
//   may simply have delivered less history, or the account is newer. It is
//   kept out of every comparison and called what it is ("keine Umsätze").

import { useMemo } from 'react';
import type { CategoryOf, Counterparty, MonthBucket, PeriodTotals } from '@/lib/analytics';
import { bookingDay, largest, monthlyBuckets, periodTotals, topCounterparties } from '@/lib/analytics';
import { counterpartyKey } from '@/lib/categories';
import type { SerializedAccount, SerializedTransaction } from '@/lib/fints-types';
import type { AnalysisPeriod, AnalysisScope, StatementInfo } from '@/lib/app-types';
import { dayKey } from '@/lib/format';

export type { AnalysisPeriod, AnalysisScope };
export const WHOLE_RANGE: AnalysisPeriod = 'all';

/** A month of the analysis: its figures, and whether it lies before the first booking in scope. */
export type AnalysisMonth = MonthBucket & {
  /** Wholly before the first booking: no data, not a month without spending. Never complete. */
  noData: boolean;
};

export type ScopeData = {
  scope: AnalysisScope;
  txs: SerializedTransaction[];
  from: string;
  to: string;
  currency: string;
  /** The accounts whose bookings are in `txs`. */
  accounts: SerializedAccount[];
  /** Loaded accounts left out because they keep another currency. */
  otherCurrencyAccounts: number;
  /** True when the loaded accounts cover different periods and `from`/`to` is their overlap. */
  clipped: boolean;
};

type Inputs = {
  scope: AnalysisScope;
  activeAccount: SerializedAccount | null;
  accounts: SerializedAccount[];
  transactions: SerializedTransaction[] | null;
  txByAccount: Record<string, SerializedTransaction[]>;
  statementInfo: Record<string, StatementInfo>;
};

/** Accounts besides the active one that have bookings loaded, in the active account's currency. */
export function loadedPeers(
  activeAccount: SerializedAccount | null,
  accounts: SerializedAccount[],
  txByAccount: Record<string, SerializedTransaction[]>,
  statementInfo: Record<string, StatementInfo>,
): { peers: SerializedAccount[]; otherCurrency: number } {
  if (!activeAccount) return { peers: [], otherCurrency: 0 };
  const cur = activeAccount.currency || 'EUR';
  let otherCurrency = 0;
  const peers: SerializedAccount[] = [];
  for (const a of accounts) {
    if (a.accountNumber === activeAccount.accountNumber) continue;
    if (!txByAccount[a.accountNumber] || !statementInfo[a.accountNumber]) continue;
    if ((a.currency || 'EUR') !== cur) {
      otherCurrency++;
      continue;
    }
    peers.push(a);
  }
  return { peers, otherCurrency };
}

/** The bookings and the range one analysis scope covers. Null while the active account has nothing loaded. */
export function useScopeData({
  scope, activeAccount, accounts, transactions, txByAccount, statementInfo,
}: Inputs): ScopeData | null {
  return useMemo(() => {
    if (!activeAccount || !transactions) return null;
    const acct = activeAccount.accountNumber;
    const currency = activeAccount.currency || 'EUR';
    const info = statementInfo[acct];
    // The applied range is what was asked for; the bookings may start later
    // (a new account) — the range still is the honest basis, so it wins.
    const ownFrom = info?.from ?? earliest(transactions);
    const ownTo = info?.to ?? dayKey(new Date());

    const { peers, otherCurrency } = loadedPeers(activeAccount, accounts, txByAccount, statementInfo);
    if (scope === 'account' || peers.length === 0) {
      return {
        scope: 'account', txs: transactions, from: ownFrom, to: ownTo, currency,
        accounts: [activeAccount], otherCurrencyAccounts: 0, clipped: false,
      };
    }

    let from = ownFrom;
    let to = ownTo;
    for (const p of peers) {
      const pi = statementInfo[p.accountNumber];
      if (pi.from > from) from = pi.from;
      if (pi.to < to) to = pi.to;
    }
    // Disjoint periods have no common stretch to compare; fall back to the
    // active account rather than invent one.
    if (from > to) {
      return {
        scope: 'account', txs: transactions, from: ownFrom, to: ownTo, currency,
        accounts: [activeAccount], otherCurrencyAccounts: 0, clipped: false,
      };
    }
    const txs = [...transactions];
    for (const p of peers) {
      txs.push(...txByAccount[p.accountNumber]);
    }
    const clipped = from !== ownFrom || to !== ownTo
      || peers.some((p) => statementInfo[p.accountNumber].from !== from || statementInfo[p.accountNumber].to !== to);
    return {
      scope: 'all', txs, from, to, currency, accounts: [activeAccount, ...peers],
      otherCurrencyAccounts: otherCurrency, clipped,
    };
  }, [scope, activeAccount, accounts, transactions, txByAccount, statementInfo]);
}

function earliest(txs: readonly SerializedTransaction[]): string {
  let min = '';
  for (const tx of txs) {
    const d = dayKey(tx.entryDate || tx.valueDate);
    if (d && (!min || d < min)) min = d;
  }
  return min || dayKey(new Date());
}

export type PeriodFigures = {
  from: string;
  to: string;
  totals: PeriodTotals;
  /**
   * The bookings behind `totals.income` and `totals.expense` — per category,
   * like the sums, so a refund inside a spending category counts with the
   * Ausgaben (Umbuchungen and other currencies left out).
   */
  credits: number;
  debits: number;
  payees: Counterparty[];
  biggest: BigExpense[];
};

/** One of the largest bookings, with how many identical ones (same payee, same amount) the period holds. */
export type BigExpense = { tx: SerializedTransaction; repeats: number };

/**
 * The largest single bookings, each payee-and-amount pair once. Over a year,
 * "Größte Ausgaben" would otherwise be the rent twelve times — true, and
 * useless. The newest booking stands for the group, with its count beside it.
 */
function biggestDistinct(sortedDebits: SerializedTransaction[], limit: number): BigExpense[] {
  const groups = new Map<string, BigExpense>();
  for (const tx of sortedDebits) {
    const key = `${counterpartyKey(tx)}|${Math.round(Math.abs(tx.amount) * 100)}`;
    const g = groups.get(key);
    if (g) g.repeats++;
    else groups.set(key, { tx, repeats: 1 });
  }
  // Map keeps insertion order, which is the size order largest() returned.
  return [...groups.values()].slice(0, limit);
}

/** The first Buchungstag among the scope's bookings, or '' for none. */
export function firstBookingDay(data: ScopeData | null): string {
  let first = '';
  for (const tx of data?.txs ?? []) {
    const d = bookingDay(tx);
    if (d && d >= (data?.from ?? '') && (!first || d < first)) first = d;
  }
  return first;
}

/** Monthly buckets over the whole scope range — the period menu and the Monatsvergleich. */
export function useMonths(data: ScopeData | null, categoryOf: CategoryOf): AnalysisMonth[] {
  return useMemo(() => {
    if (!data) return [];
    const first = firstBookingDay(data);
    return monthlyBuckets(data.txs, { categoryOf, from: data.from, to: data.to, currency: data.currency }).map((m) => {
      const noData = !first || m.to < first;
      return { ...m, noData, complete: m.complete && !noData };
    });
  }, [data, categoryOf]);
}

/** Where the analysis opens: the last complete month — households think in months — else the whole range. */
export function defaultPeriod(months: readonly AnalysisMonth[]): AnalysisPeriod {
  for (let i = months.length - 1; i >= 0; i--) if (months[i].complete) return months[i].month;
  return WHOLE_RANGE;
}

/**
 * The figures of one period. `notOneOff` keeps bookings out of "Größte
 * Einzelausgaben" — the recognised contracts and cash withdrawals, which
 * Verträge and Top-Empfänger already show.
 */
export function usePeriodFigures(
  data: ScopeData | null,
  months: readonly MonthBucket[],
  period: AnalysisPeriod,
  categoryOf: CategoryOf,
  notOneOff?: (tx: SerializedTransaction) => boolean,
): PeriodFigures | null {
  return useMemo(() => {
    if (!data) return null;
    const month = period === WHOLE_RANGE ? null : months.find((m) => m.month === period) ?? null;
    const from = month?.from ?? data.from;
    const to = month?.to ?? data.to;
    const opts = { categoryOf, from, to, currency: data.currency };
    const totals = periodTotals(data.txs, opts);
    // The bookings each figure is made of, decided per category exactly as the
    // figures are: a refund netted into "Shopping" counts with the Ausgaben, a
    // category refunded down to nothing on neither side.
    const counted = (rows: PeriodTotals['byCategory']) => rows.reduce((s, c) => s + c.count, 0);

    return {
      from,
      to,
      totals,
      credits: counted(totals.incomeByCategory),
      debits: counted(totals.byCategory),
      payees: topCounterparties(data.txs, { ...opts, dir: 'out', limit: 8 }),
      biggest: biggestDistinct(largest(data.txs, { ...opts, dir: 'out', limit: Number.MAX_SAFE_INTEGER, skip: notOneOff }), 8),
    };
  }, [data, months, period, categoryOf, notOneOff]);
}

/**
 * Average monthly spending over the complete months, leaving out `except` —
 * a month is not compared with an average it is part of. Null below `min`
 * months.
 */
export function averageExpense<M extends MonthBucket>(
  months: readonly M[],
  opts: { except?: string; min?: number } = {},
): { value: number; months: M[] } | null {
  const complete = months.filter((m) => m.complete && m.month !== opts.except);
  if (complete.length < (opts.min ?? 2)) return null;
  const cents = complete.reduce((s, m) => s + Math.round(m.expense * 100), 0);
  return { value: Math.round(cents / complete.length) / 100, months: complete };
}
