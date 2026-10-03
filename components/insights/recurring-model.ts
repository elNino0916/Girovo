'use client';

// The recurring payments (contracts, subscriptions, salary) found in every
// account's loaded bookings — shared by the Verträge tab and the "Demnächst
// fällig" tile so both always tell the same story.
//
// Detection runs once per change of the bookings, the categories or the
// own-account list; the user's "Kein Vertrag" list only re-partitions the
// result, so dismissing a series never re-runs the detection.

import { useMemo } from 'react';
import { useFints } from '../FintsProvider';
import type { SerializedTransaction } from '@/lib/fints-types';
import { detectRecurring, recurringTotals, upcoming, type RecurringSeries } from '@/lib/recurring';
import { dayKey } from '@/lib/format';
import { spanDays } from './shared';

export type RecurringModel = {
  /** Live series, income first, then by monthly weight. */
  income: RecurringSeries[];
  expense: RecurringSeries[];
  /** Two expected bookings missed — most likely cancelled. Not in any total. */
  ended: RecurringSeries[];
  /** Series the user marked "Kein Vertrag", still detected in the data. */
  dismissed: RecurringSeries[];
  totals: ReturnType<typeof recurringTotals>;
  /** Live series in another currency than the totals — listed, never added. */
  otherCurrency: number;
  /** What the detection could see. */
  basis: { from: string; to: string; accounts: number; bookings: number; longestSpan: number } | null;
  /** Nothing loaded yet, and something is on its way (a statement or the vault). */
  loading: boolean;
};

export function useRecurringModel(): RecurringModel {
  const {
    txByAccount, statementInfo, ownIbans, categoryOf, vault, vaultStatus, loadingAccount, activeAccount,
  } = useFints();

  const loaded = useMemo(() => {
    const accts = Object.keys(txByAccount).filter((a) => statementInfo[a]);
    const txs: SerializedTransaction[] = [];
    let from = '';
    let to = '';
    let until = '';
    let longest = 0;
    for (const a of accts) {
      const info = statementInfo[a];
      txs.push(...txByAccount[a]);
      if (!from || info.from < from) from = info.from;
      if (!to || info.to > to) to = info.to;
      // A series is only late against data that could have shown it: the
      // earliest end among the loaded accounts.
      if (!until || info.to < until) until = info.to;
      longest = Math.max(longest, spanDays(info.from, info.to));
    }
    return { accts, txs, from, to, until, longest };
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
    return {
      income,
      expense,
      ended,
      dismissed,
      totals,
      otherCurrency: live.filter((s) => s.currency !== currency).length,
      basis: loaded.accts.length
        ? { from: loaded.from, to: loaded.to, accounts: loaded.accts.length, bookings: loaded.txs.length, longestSpan: loaded.longest }
        : null,
      // Before the vault answers, a dismissed series would flash back in; and
      // with nothing loaded yet, "nothing found" would be a false statement.
      loading: vaultStatus === 'loading' || (!loaded.accts.length && !!loadingAccount),
    };
  }, [detected, dismissedIds, currency, loaded, vaultStatus, loadingAccount]);
}

/** The next expected bookings of the live series, soonest first. */
export function useUpcoming(model: RecurringModel, days = 30) {
  return useMemo(
    () => upcoming([...model.income, ...model.expense], { days }),
    [model.income, model.expense, days],
  );
}
