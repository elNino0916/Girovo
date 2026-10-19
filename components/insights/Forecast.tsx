'use client';

// "Kontostand Ende Oktober": where the selected account's balance is heading
// by the month's end (lib/forecast.ts). Beside "Demnächst fällig" on a wide
// Übersicht; on a phone, where the Übersicht keeps to the balance and the
// bookings, at the head of Verträge.
//
// An estimate and said as one: whole euros after "ca.", the basis in words.
// Its warning is the reason it exists — the day the account may slip into
// the Dispo or past it — drawn as every warning is, on the inset with an
// orange glyph, never in red: nothing has gone wrong yet.

import { useMemo } from 'react';
import { isCardAccount } from '@/lib/balances';
import { dayKey } from '@/lib/format';
import { forecast, seriesBookings, usualSpending } from '@/lib/forecast';
import { intlLocale } from '@/lib/i18n';
import { rich, useT } from '@/lib/i18n/react';
import { useFints } from '../FintsProvider';
import { AlertTriangleIcon } from '../icons';
import { DotList, Tile, cx } from '../ui';
import { useRecurringModel } from './recurring-model';
import { RoundMoney, fmtDayKeyShort } from './shared';

export function ForecastTile({ className }: { className?: string }) {
  const { activeAccount, balances, pendingCache, bankOrders, txByAccount, statementInfo, accountLabel, accounts } = useFints();
  const model = useRecurringModel();
  const t = useT();
  const words = t.insights.forecast;
  const acct = activeAccount?.accountNumber ?? null;
  const balance = acct ? balances[acct] : null;
  const today = dayKey(new Date());
  const card = !!activeAccount && isCardAccount(activeAccount);

  const result = useMemo(() => {
    if (!activeAccount || !acct || !balance || model.loading) return null;
    // A balance from another day is no ground to stand on: the bookings since are unknown.
    if (dayKey(balance.date) < today) return 'stale' as const;
    const currency = balance.currency || activeAccount.currency || 'EUR';
    const series = [...model.income, ...model.expense].filter((s) => model.accountOf(s) === acct);
    const orders = [
      ...(bankOrders[acct]?.standing?.orders ?? []),
      ...(bankOrders[acct]?.dated?.orders ?? []),
    ];
    const info = statementInfo[acct];
    const usual = usualSpending({
      txs: txByAccount[acct] ?? [],
      inSeries: seriesBookings(series),
      loaded: info ? { from: info.from, to: info.to } : null,
      today,
      currency,
    });
    return {
      currency,
      series,
      orders,
      f: forecast({
        today,
        balance: balance.balance,
        currency,
        series,
        orders,
        pending: pendingCache[acct] ?? [],
        usual,
        creditLimit: balance.creditLimit ?? null,
        card,
      }),
    };
  }, [activeAccount, acct, balance, model, bankOrders, statementInfo, txByAccount, pendingCache, today, card]);

  // A Depot has no balance to project, a card's statement balance none worth it.
  if (!activeAccount || card || activeAccount.accountType === 'SecuritiesAccount' || !result) return null;

  const month = new Intl.DateTimeFormat(intlLocale(), { month: 'long' }).format(new Date());
  const name = accountLabel(activeAccount);

  if (result === 'stale') {
    return (
      <Tile className={cx('min-w-0', className)} title={words.title(month)} subtitle={words.estimate}>
        <p className="px-4 pb-4 text-[14px] leading-relaxed text-ink-2 sm:px-5 sm:pb-5">{words.notToday}</p>
      </Tile>
    );
  }

  const { f, currency } = result;
  const counts = {
    pending: f.events.filter((e) => e.kind === 'pending').length,
    regular: f.events.filter((e) => e.kind === 'series').length,
    orders: f.events.filter((e) => e.kind === 'order').length,
  };
  const money = (v: number) => <RoundMoney value={v} currency={currency} />;

  return (
    <Tile
      className={cx('min-w-0', className)}
      title={words.title(month)}
      subtitle={<DotList items={[accounts.length > 1 && name, words.estimate]} />}
    >
      <div className="px-4 pb-4 sm:px-5 sm:pb-5">
        <p className="flex items-baseline gap-1.5">
          <span className="text-[15px] text-ink-3">{words.approx}</span>
          <span className={cx('text-[24px] leading-tight font-bold', f.end < 0 && 'text-red')}>{money(f.end)}</span>
        </p>
        {f.low.date !== f.until && f.low.balance < f.end && (
          <p className="tnum mt-0.5 text-[13px] leading-snug text-ink-2">
            {rich(words.low(money(f.low.balance), fmtDayKeyShort(f.low.date)))}
          </p>
        )}

        {f.breach && (
          // A warning, not an error: the inset with an orange glyph.
          <p role="status" className="mt-3 flex items-start gap-2.5 rounded-[12px] bg-inset px-3.5 py-3 text-[14px] leading-snug text-ink">
            <AlertTriangleIcon size={18} className="mt-px shrink-0 text-emphasis" />
            <span>
              {rich((f.breach.line === 'limit' ? words.limit : words.zero)(fmtDayKeyShort(f.breach.date), money(f.breach.balance)))}
            </span>
          </p>
        )}

        <p className="mt-3 text-[12.5px] leading-snug text-ink-3">
          {`${words.basis}: `}
          {[
            words.balance,
            counts.pending > 0 ? words.pending(counts.pending) : '',
            counts.regular > 0 ? words.regular(counts.regular) : '',
            counts.orders > 0 ? words.orders(counts.orders) : '',
            f.usualPerDay != null ? words.usual(f.usualMonths) : words.noUsual,
          ].filter(Boolean).join(', ')}
        </p>
        <p className="mt-1 text-[12.5px] leading-snug text-ink-3">{words.hint}</p>
      </div>
    </Tile>
  );
}
