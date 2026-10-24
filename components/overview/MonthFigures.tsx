'use client';

// The quiet line under the balance on a wide window (DESIGN.md, the
// Übersicht, "Suche oben", owner 2026-10-24): what came in and what went out
// this month so far, and what the next 30 days are expected to take — three
// figures, no tile. Where each is told in full is elsewhere: the month in
// Analyse, what is due in Zahlungen. A phone leaves the line out, so its
// bookings start on the first screen (the Phone's Page Rule).
//
// Like the Monatsbilanz in Analyse, the month runs only as far as the
// loaded Umsätze and today reach, and its label says so ("1.–24. Oktober"):
// a figure for October on the 24th that does not say so reads as a verdict
// on the whole month. Umbuchungen between the user's own accounts are
// neither income nor spending (lib/analytics.ts periodTotals). What is due
// counts this account's expected payments in its own currency.

import { useMemo } from 'react';
import { periodTotals } from '@/lib/analytics';
import { isoDate } from '@/lib/format';
import { intlLocale } from '@/lib/i18n';
import { useT } from '@/lib/i18n/react';
import { useFints } from '../FintsProvider';
import { Money } from '../Money';
import { useRecurringModel, useUpcoming } from '../insights/recurring-model';

/** "1.–24. Oktober" ("1–24 October"): the days of the month the figures cover. */
function daySpan(from: string, to: string): string {
  const fmt = new Intl.DateTimeFormat(intlLocale(), { day: 'numeric', month: 'long' });
  const a = new Date(`${from}T12:00:00`);
  const b = new Date(`${to}T12:00:00`);
  return from === to ? fmt.format(a) : fmt.formatRange(a, b);
}

export function MonthFigures() {
  const { activeAccount: a, statementInfo, txByAccount, categoryOf } = useFints();
  const t = useT();
  const words = t.insights.monthFigures;
  const acct = a?.accountNumber ?? null;
  const info = acct ? statementInfo[acct] : undefined;
  const txs = acct ? txByAccount[acct] : undefined;
  const currency = a?.currency || 'EUR';

  // Read once per render; the next statement load re-renders it after midnight.
  const today = new Date();
  const todayKey = isoDate(today);
  const monthStart = isoDate(new Date(today.getFullYear(), today.getMonth(), 1));

  const month = useMemo(() => {
    if (!info || !txs) return null;
    const from = info.from > monthStart ? info.from : monthStart;
    // A Buchungstag after today is "noch nicht gebucht" everywhere else: not this month's money yet.
    const to = info.to < todayKey ? info.to : todayKey;
    if (from > to) return null;
    const totals = periodTotals(txs, { categoryOf, from, to, currency });
    return totals.count > 0 ? { span: daySpan(from, to), totals } : null;
  }, [info, txs, categoryOf, currency, monthStart, todayKey]);

  const model = useRecurringModel();
  const upcoming = useUpcoming(model, 30, acct);
  const due = useMemo(() => {
    let cents = 0;
    for (const { series: s } of upcoming) {
      if (s.currency === currency && s.amount < 0) cents += Math.round(s.amount * 100);
    }
    return cents / 100;
  }, [upcoming, currency]);

  if (!month && (model.loading || due === 0)) return null;

  return (
    <dl className="flex flex-wrap gap-x-14 gap-y-3">
      {month && (
        <>
          <Figure label={words.income(month.span)}>
            <Money value={month.totals.income} currency={currency} signed tone="credit" />
          </Figure>
          <Figure label={words.spending(month.span)}>
            <Money value={-month.totals.expense} currency={currency} signed tone="plain" />
          </Figure>
        </>
      )}
      {!model.loading && due !== 0 && (
        <Figure label={words.due}>
          <Money value={due} currency={currency} signed tone="plain" />
        </Figure>
      )}
    </dl>
  );
}

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="tnum text-[14px] leading-5 text-ink-2">{label}</dt>
      <dd className="mt-0.5 text-[16px] leading-6 font-medium text-ink">{children}</dd>
    </div>
  );
}
