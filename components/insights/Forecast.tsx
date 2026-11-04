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
import { dayKey, displayName } from '@/lib/format';
import { forecast, seriesBookings, usualSpending, type Forecast } from '@/lib/forecast';
import { intlLocale } from '@/lib/i18n';
import { rich, useT } from '@/lib/i18n/react';
import { useFints } from '../FintsProvider';
import { AlertTriangleIcon } from '../icons';
import { forecastAllowed } from '@/lib/plus';
import { PlusTeaser } from '../android/PlusTeaser';
import { DotList, Tile, cx } from '../ui';
import { Money } from '../Money';
import { useDesktopFrame } from '../shell/frame';
import { useRecurringModel } from './recurring-model';
import { RoundMoney, fmtDayKeyShort } from './shared';

export function ForecastTile({ className }: { className?: string }) {
  const { activeAccount, balances, pendingCache, bankOrders, txByAccount, statementInfo, accountLabel, accounts, plus } = useFints();
  const model = useRecurringModel();
  const frame = useDesktopFrame();
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

  // Girovo Plus in the Play build: the card keeps its place, the figure waits for Plus.
  if (!forecastAllowed(plus.state)) {
    return (
      <Tile className={cx('min-w-0', className)} title={words.title(month)}>
        <div className="px-4 pb-4 sm:px-5 sm:pb-5">
          <PlusTeaser text={t.plus.forecastTeaser} />
        </div>
      </Tile>
    );
  }

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

        {frame && <ForecastChart f={f} currency={currency} />}

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

/**
 * The desktop's frame: the forecast drawn as the Kontoverlauf is — a
 * staircase line over a flat 12% area (DESIGN.md), from today to the
 * month's end, the zero line dashed where the balance comes near it, the
 * lowest point marked in the marker orange — and under it what is due, by
 * day. The figures above stay the statement; the chart only shows the shape.
 */
function ForecastChart({ f, currency }: { f: Forecast; currency: string }) {
  const t = useT();
  const words = t.insights.forecast;
  const days = useMemo(() => {
    const out: { day: string; balance: number }[] = [];
    let cents = Math.round(f.start * 100);
    const usual = f.usualPerDay != null ? Math.round(f.usualPerDay * 100) : 0;
    const byDay = new Map<string, number>();
    for (const e of f.events) byDay.set(e.date, (byDay.get(e.date) ?? 0) + Math.round(e.amount * 100));
    for (let d = new Date(`${f.today}T12:00:00`), first = true; dayKey(d) <= f.until; d.setDate(d.getDate() + 1), first = false) {
      const key = dayKey(d);
      // usualPerDay is the day's usual spending, already negative.
      if (!first) cents += usual;
      cents += byDay.get(key) ?? 0;
      out.push({ day: key, balance: cents / 100 });
    }
    return out;
  }, [f]);
  if (days.length < 2) return null;

  const W = 520;
  const H = 120;
  const min = Math.min(0, ...days.map((d) => d.balance));
  const max = Math.max(...days.map((d) => d.balance));
  const span = max - min || 1;
  // Each day is a step of its own width, so the last day's change (the
  // salary on the 30th) is a step and not a stroke at the edge.
  const x = (i: number) => (i / days.length) * W;
  const y = (v: number) => 6 + (1 - (v - min) / span) * (H - 12);
  let line = `M0 ${y(days[0].balance).toFixed(1)}`;
  for (let i = 1; i < days.length; i++) line += `H${x(i).toFixed(1)}V${y(days[i].balance).toFixed(1)}`;
  line += `H${W}`;
  const area = `${line}V${H}H0Z`;
  const lowIndex = days.findIndex((d) => d.day === f.low.date);
  const due = f.events.filter((e) => e.kind !== 'pending' && e.date > f.today).slice(0, 6);

  return (
    <div className="mt-4">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={words.chartLabel} className="block h-[120px] w-full">
        {min < 0 && <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="var(--md-outline-variant)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />}
        <path d={area} fill="var(--accent)" fillOpacity="0.12" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      {lowIndex > 0 && (
        <span
          aria-hidden
          className="relative -mt-[120px] block h-[120px] w-full"
        >
          <span
            className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emphasis"
            style={{ left: `${((x(lowIndex) + x(lowIndex + 1)) / 2 / W) * 100}%`, top: `${y(days[lowIndex].balance)}px` }}
          />
        </span>
      )}
      <div className="tnum mt-1 flex justify-between text-[12px] leading-4 text-ink-2">
        <span>{fmtDayKeyShort(f.today)}</span>
        <span>{fmtDayKeyShort(f.until)}</span>
      </div>
      {due.length > 0 && (
        <>
          <h3 className="mt-5 text-[14px] leading-5 font-medium text-ink-2">{words.dueToMonthEnd}</h3>
          <ul className="mt-1">
            {due.map((e, i) => (
              <li key={`${e.date}-${i}`} className="grid min-h-10 grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-3 text-[14px] leading-5">
                <span className="tnum text-ink-2">{fmtDayKeyShort(e.date)}</span>
                <span className="min-w-0 truncate font-medium text-ink">{displayName(e.name) || words.pendingName}</span>
                <span className="text-right font-medium">
                  {e.approximate && <span className="mr-1 font-normal text-ink-2">{words.approx}</span>}
                  <Money value={e.amount} currency={currency} signed tone="credit" />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

