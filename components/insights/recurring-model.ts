'use client';

// The recurring payments (contracts, subscriptions, salary) found in every
// account's loaded bookings — shared by the Verträge tab and the "Demnächst
// fällig" tile so both always tell the same story.
//
// Detection runs once per change of the bookings, the categories or the
// own-account list; the user's "Nicht als Vertrag zählen" list only
// re-partitions the result, so dismissing a series never re-runs the
// detection.
//
// Every account is accounted for: the ones whose bookings are in, each with
// its own period; the ones that are not (never fetched, failed, or without
// Umsätze over FinTS). Totals are held back while an account in scope
// failed — a sum without it would look complete and is not.

import { useMemo } from 'react';
import { useFints } from '../FintsProvider';
import type { SerializedAccount, SerializedTransaction } from '@/lib/fints-types';
import { bookingDay } from '@/lib/analytics';
import {
  detectRecurring, recurringGroups, recurringTotals, unseenCadences, upcoming, type Cadence, type RecurringGroup,
  type RecurringSeries,
} from '@/lib/recurring';
import { dayKey } from '@/lib/format';
import { spanDays } from './shared';

/** One account and what the detection could see of it. */
export type AccountBasis = {
  account: SerializedAccount;
  /**
   * included — its bookings are in the detection
   * loading — on its way
   * failed — the last attempt to fetch it did not land
   * missing — not fetched in this session (Umsätze abrufen)
   * unsupported — the bank offers no Umsätze for it over FinTS
   */
  status: 'included' | 'loading' | 'failed' | 'missing' | 'unsupported';
  /** included: the period fetched, and the days of history it really holds. */
  from?: string;
  to?: string;
  /** Days from the first booking (or the period's start, when bookings begin within a month of it) to the end. */
  span?: number;
  bookings?: number;
  /** failed: the bank's or the app's reason. */
  error?: string;
};

export type RecurringModel = {
  /** Live series, income first, then by monthly weight. */
  income: RecurringSeries[];
  expense: RecurringSeries[];
  /** The live expense series grouped for reading: Wohnen & Energie, Abos & Medien, … */
  groups: RecurringGroup[];
  /** Two expected bookings missed — most likely cancelled. Not in any total. */
  ended: RecurringSeries[];
  /** Series the user marked "Nicht als Vertrag zählen", still detected in the data. */
  dismissed: RecurringSeries[];
  totals: ReturnType<typeof recurringTotals>;
  /** Live series in another currency than the totals — listed, never added. */
  otherCurrency: number;
  /** Every account of the session, and whether (and how much of) it is in. */
  accounts: AccountBasis[];
  /** What the detection could see. Null while no account's bookings are in. */
  basis: {
    from: string; to: string; accounts: number; bookings: number;
    /** The longest and the shortest history among the included accounts, in days. */
    longestSpan: number; shortestSpan: number;
  } | null;
  /** The slower rhythms the shortest included history cannot be relied on to show. */
  unseen: Cadence[];
  /** An account in scope failed to load: every total would be short. */
  incomplete: boolean;
  /** The account a series' newest booking was booked on. */
  accountOf: (s: RecurringSeries) => string | null;
  /** Nothing loaded yet, and something is on its way (a statement or the vault). */
  loading: boolean;
};

/**
 * Which accounts failed to load, with the reason — the provider's
 * per-account statement errors (`txErrors`), so a failure stays with the
 * account it happened to, whichever account is open. Only an account without
 * any loaded bookings counts as failed: a refresh that did not land leaves the
 * earlier bookings, which still hold. A failed balance enquiry
 * (`balanceErrors`) says nothing about the bookings and does not count.
 */
function useLoadFailures(): Record<string, string> {
  const { txErrors, statementInfo } = useFints();
  return useMemo(() => {
    const out: Record<string, string> = {};
    for (const [acct, e] of Object.entries(txErrors)) if (!statementInfo[acct]) out[acct] = e.message;
    return out;
  }, [txErrors, statementInfo]);
}

/**
 * Days of history an account's bookings hold: from the period's start —
 * unless the first booking comes more than a month after it, when the bank
 * delivered less than was asked for (or the account is newer).
 */
function historySpan(from: string, to: string, txs: readonly SerializedTransaction[]): number {
  let first = '';
  for (const tx of txs) {
    const d = bookingDay(tx);
    if (d && d >= from && (!first || d < first)) first = d;
  }
  const start = first && spanDays(from, first) > 31 ? first : from;
  return spanDays(start, to);
}

export function useRecurringModel(): RecurringModel {
  const {
    accounts, txByAccount, statementInfo, ownIbans, categoryOf, vault, vaultStatus, loadingAccount, activeAccount,
  } = useFints();
  const failures = useLoadFailures();

  const loaded = useMemo(() => {
    const accts = Object.keys(txByAccount).filter((a) => statementInfo[a]);
    const txs: SerializedTransaction[] = [];
    const owner = new Map<SerializedTransaction, string>();
    let from = '';
    let to = '';
    let until = '';
    let longest = 0;
    let shortest = Infinity;
    const spans: Record<string, number> = {};
    for (const a of accts) {
      const info = statementInfo[a];
      for (const tx of txByAccount[a]) {
        txs.push(tx);
        owner.set(tx, a);
      }
      if (!from || info.from < from) from = info.from;
      if (!to || info.to > to) to = info.to;
      // A series is only late against data that could have shown it: the
      // earliest end among the loaded accounts.
      if (!until || info.to < until) until = info.to;
      const span = historySpan(info.from, info.to, txByAccount[a]);
      spans[a] = span;
      longest = Math.max(longest, span);
      shortest = Math.min(shortest, span);
    }
    return { accts, txs, owner, from, to, until, longest, shortest: Number.isFinite(shortest) ? shortest : 0, spans };
  }, [txByAccount, statementInfo]);

  const detected = useMemo(
    () => (loaded.txs.length
      ? detectRecurring(loaded.txs, { ownIbans, categoryOf, until: loaded.until || dayKey(new Date()) })
      : []),
    [loaded, ownIbans, categoryOf],
  );

  const dismissedIds = vault?.dismissedRecurring;
  const currency = activeAccount?.currency || 'EUR';

  return useMemo(() => {
    const hidden = new Set(dismissedIds ?? []);
    const income: RecurringSeries[] = [];
    const expense: RecurringSeries[] = [];
    const ended: RecurringSeries[] = [];
    const dismissed: RecurringSeries[] = [];
    for (const s of detected) {
      if (hidden.has(s.id)) dismissed.push(s);
      else if (s.ended) ended.push(s);
      else if (s.kind === 'income') income.push(s);
      else expense.push(s);
    }
    const live = [...income, ...expense];
    const totals = recurringTotals(live, currency);

    const bases: AccountBasis[] = accounts.map((account) => {
      const acct = account.accountNumber;
      const info = statementInfo[acct];
      if (info && txByAccount[acct]) {
        return { account, status: 'included', from: info.from, to: info.to, span: loaded.spans[acct], bookings: txByAccount[acct].length };
      }
      if (loadingAccount === acct) return { account, status: 'loading' };
      if (failures[acct]) return { account, status: 'failed', error: failures[acct] };
      return { account, status: account.canStatements ? 'missing' : 'unsupported' };
    });

    return {
      income,
      expense,
      groups: recurringGroups(expense, currency),
      ended,
      dismissed,
      totals,
      otherCurrency: live.filter((s) => s.currency !== currency).length,
      accounts: bases,
      basis: loaded.accts.length
        ? {
            from: loaded.from, to: loaded.to, accounts: loaded.accts.length, bookings: loaded.txs.length,
            longestSpan: loaded.longest, shortestSpan: loaded.shortest,
          }
        : null,
      unseen: loaded.accts.length ? unseenCadences(loaded.shortest) : [],
      incomplete: bases.some((b) => b.status === 'failed'),
      accountOf: (s) => (s.transactions[0] ? loaded.owner.get(s.transactions[0]) ?? null : null),
      // Before the vault answers, a dismissed series would flash back in; and
      // with nothing loaded yet, "nothing found" would be a false statement.
      loading: vaultStatus === 'loading' || (!loaded.accts.length && !!loadingAccount),
    };
  }, [detected, dismissedIds, currency, loaded, vaultStatus, loadingAccount, accounts, statementInfo, txByAccount, failures]);
}

/** The next expected bookings of the live series, soonest first — of one account, when given. */
export function useUpcoming(model: RecurringModel, days = 30, accountNumber?: string | null) {
  return useMemo(() => {
    const live = [...model.income, ...model.expense];
    const scoped = accountNumber === undefined ? live : live.filter((s) => model.accountOf(s) === accountNumber);
    return upcoming(scoped, { days });
  }, [model, days, accountNumber]);
}
