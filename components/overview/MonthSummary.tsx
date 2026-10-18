'use client';

import { useId, useMemo } from 'react';
import { fmtDayShort, fmtDaySpan, periodTotals } from '@/lib/analytics';
import type { PeriodTotals } from '@/lib/analytics';
import { fmtMonth, fmtRange, isoDate, presetRange } from '@/lib/format';
import type { Messages } from '@/lib/i18n';
import { rich, useT } from '@/lib/i18n/react';
import { comparisonSpan, type ComparisonSpan } from '@/lib/month-summary';
import { useFints } from '../FintsProvider';
import { Money, usePrivacy } from '../Money';
import { Button, DotList, EmptyState, Skeleton, TileHeader } from '../ui';

const NBSP = '\u00a0';
/** "03.10." ("3 Oct"). */
const dayMonth = (key: string) => fmtDayShort(key);
const monthName = (key: string) => fmtMonth(key).split(' ')[0];

/** "Im September", "Im September bis 04.09.", "Im September, 03.09.–04.09." */
function comparisonLabel(span: ComparisonSpan, t: Messages): string {
  const words = t.insights.monthSummary;
  const month = monthName(span.from);
  if (span.wholeMonth) return words.inMonth(month);
  if (span.from.endsWith('-01')) return words.inMonthUntil(month, dayMonth(span.to));
  return words.inMonthSpan(month, fmtDaySpan(span.from, span.to));
}

/** First and last day of the month `today` is in. */
function monthBounds(today: Date): { start: string; end: string } {
  return {
    start: isoDate(new Date(today.getFullYear(), today.getMonth(), 1)),
    end: isoDate(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
  };
}

type Coverage = { from: string; to: string; complete: boolean };

/**
 * Monatsbilanz — what came in and what went out this calendar month, as far
 * as the loaded Umsätze reach.
 *
 * The month is nearly always unfinished, so the tile says up to which day the
 * figures go ("bis 03.10."); a figure for "Oktober" on the 3rd that does not
 * say so reads as a verdict on the whole month. For the same reason last
 * month is a yardstick only for the same days of it ("Im September bis
 * 04.09."), and in full only once this month is. Umbuchungen between your own accounts are left out
 * — moving money from Giro to Tagesgeld is neither income nor spending — and
 * the basis line says how many were.
 */
export function MonthSummary() {
  const {
    activeAccount: a, accounts, statementInfo, txByAccount, txErrors, categoryOf, loadingAccount, busy, applyRange,
    accountLabel,
  } = useFints();
  const titleId = useId();
  const t = useT();
  const words = t.insights.monthSummary;

  const acct = a?.accountNumber ?? '';
  const info = acct ? statementInfo[acct] : undefined;
  const txs = acct ? txByAccount[acct] : undefined;

  // The calendar is read once per render; the tile does not need to roll
  // over at midnight on its own — the next statement load re-renders it.
  const today = new Date();
  const todayKey = isoDate(today);
  const month = monthBounds(today);

  const data = useMemo(() => {
    if (!info || !txs) return null;
    const from = info.from > month.start ? info.from : month.start;
    // Up to today and no further. A booking can carry a Buchungstag after
    // today (a weekend transfer is dated Monday); everywhere else the app
    // calls that "noch nicht gebucht", so it is not counted as this month's
    // money yet — and "bis 03.10." stays true on the 3rd.
    let to = info.to < month.end ? info.to : month.end;
    if (to > todayKey) to = todayKey;
    if (from > to) return { coverage: null, totals: null, prev: null };
    const coverage: Coverage = { from, to, complete: from === month.start && to === month.end };
    const totals = periodTotals(txs, { categoryOf, from, to, currency: a?.currency });
    // Last month as a yardstick, like with like: the same days of it
    // (lib/month-summary.ts) — and only if those were loaded, so a half-loaded
    // September is never set against October as if it were all of it.
    const span = comparisonSpan(coverage);
    const prev = span && info.from <= span.from && info.to >= span.to
      ? { span, totals: periodTotals(txs, { categoryOf, from: span.from, to: span.to, currency: a?.currency }) }
      : null;
    return { coverage, totals, prev };
  }, [info, txs, categoryOf, a?.currency, month.start, month.end, todayKey]);

  const loading = !!a && loadingAccount === acct && !info;
  const name = monthName(month.start);

  const partialLabel = data?.coverage
    ? data.coverage.complete
      ? null
      : data.coverage.from === month.start
        ? t.insights.period.until(dayMonth(data.coverage.to))
        : fmtDaySpan(data.coverage.from, data.coverage.to)
    : null;

  return (
    <section className="panel min-w-0 overflow-clip" aria-labelledby={titleId} aria-busy={loading || undefined}>
      <TileHeader
        title={words.title}
        titleId={titleId}
        subtitle={
          <span className="tnum">
            {fmtMonth(month.start)}
            {partialLabel && <> · <span className="whitespace-nowrap">{partialLabel}</span></>}
          </span>
        }
      />

      {!a || loading ? (
        <div className="px-4 pb-5 sm:px-5">
          <div className="flex justify-between"><Skeleton className="h-3.5 w-24 rounded-[4px]" /><Skeleton className="h-3.5 w-20 rounded-[4px]" /></div>
          <div className="mt-3 flex justify-between"><Skeleton className="h-3.5 w-20 rounded-[4px]" /><Skeleton className="h-3.5 w-24 rounded-[4px]" /></div>
          <Skeleton className="mt-4 h-2.5 w-full rounded-full" />
          <div className="mt-5 flex justify-between"><Skeleton className="h-4 w-20 rounded-[4px]" /><Skeleton className="h-4 w-24 rounded-[4px]" /></div>
          <span className="sr-only">{t.insights.bookings.loading}</span>
        </div>
      ) : !a.canStatements ? (
        <EmptyState compact title={t.insights.bookings.noneForAccount} className="pt-1">
          {words.unsupported}
        </EmptyState>
      ) : !info && txErrors[acct] ? (
        // The reason, and the way to try again, stand with the Kontostand and
        // the Umsätze; said a third time here it would only be louder.
        <EmptyState compact title={t.transactions.list.loadFailed} className="pt-1">
          {words.pending}
        </EmptyState>
      ) : !info || !data ? (
        <EmptyState compact title={words.notLoaded} className="pt-1">
          {words.pending}
        </EmptyState>
      ) : !data.coverage || !data.totals ? (
        <EmptyState
          compact
          title={words.monthNotLoaded(name)}
          className="pt-1"
          action={
            <>
              {/* The default window — the Umsätze's "Letzte 90 Tage": this
                  month and the one before, and the span most banks serve
                  without an extra approval. */}
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => applyRange(presetRange('90d'))}>
                {words.loadLast90Days}
              </Button>
              <p className="w-full text-[13px] leading-snug text-ink-3">{t.common.mayNeedApproval}</p>
            </>
          }
        >
          {rich(words.loaded(<span className="tnum whitespace-nowrap">{fmtRange(info.from, info.to)}</span>))}
        </EmptyState>
      ) : data.totals.count === 0 ? (
        <EmptyState compact title={words.noneYet(name)} className="pt-1">
          {data.totals.excluded > 0
            ? words.onlyTransfers(data.totals.excluded)
            : words.empty}
        </EmptyState>
      ) : (
        <Body
          totals={data.totals}
          prevTotals={data.prev?.totals ?? null}
          prevLabel={data.prev ? comparisonLabel(data.prev.span, t) : ''}
          accountName={accounts.length > 1 ? accountLabel(a) : null}
        />
      )}
    </section>
  );
}

function Body({
  totals, prevTotals, prevLabel, accountName,
}: { totals: PeriodTotals; prevTotals: PeriodTotals | null; prevLabel: string; accountName: string | null }) {
  const { income, expense, net, currency } = totals;
  const privacy = usePrivacy();
  const t = useT();

  // On Android only what changes how the figures read: what was left out.
  const facts = [
    totals.excluded > 0 && t.insights.without(t.insights.count.transfers(totals.excluded)),
    totals.otherCurrency > 0 && t.insights.monthSummary.withoutForeign(totals.otherCurrency),
  ]
    .filter((part): part is string => !!part)
    // Each fact wraps as a whole — "ohne 1 / Umbuchung" across two lines
    // reads as two claims. (The account name may be long, so it can wrap.)
    .map((part) => part.replace(/ /g, NBSP));
  const basis = [accountName, ...facts].filter((part): part is string => !!part);

  return (
    <div className="px-4 pb-4 sm:px-5 sm:pb-5">
      <dl className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="flex items-center gap-2 text-[14px] text-ink-2">
            <span aria-hidden className="size-2.5 shrink-0 rounded-[3px] bg-chart-in" />
            {t.insights.income}
          </dt>
          <dd className="text-[15px] font-semibold text-ink">
            <Money value={income} currency={currency} tone="plain" />
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="flex items-center gap-2 text-[14px] text-ink-2">
            <span aria-hidden className="size-2.5 shrink-0 rounded-[3px] bg-chart-out" />
            {t.common.booking.spending}
          </dt>
          <dd className="text-[15px] font-semibold text-ink">
            <Money value={expense} currency={currency} tone="plain" />
          </dd>
        </div>
      </dl>

      {/* In and out side by side in one bar: how the month splits, at a
          glance. Decorative — the two figures above say it in numbers. Only
          when there is a split: one side alone would fill the bar and look
          like a verdict. With amounts hidden the ratio would still tell. */}
      {income > 0 && expense > 0 && !privacy && (
        <div aria-hidden className="mt-3.5 flex h-2.5 gap-[3px]">
          <span className="min-w-1.5 rounded-full bg-chart-in" style={{ flexGrow: income, flexBasis: 0 }} />
          <span className="min-w-1.5 rounded-full bg-chart-out" style={{ flexGrow: expense, flexBasis: 0 }} />
        </div>
      )}

      <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-line pt-3.5">
        <span className="text-[14px] font-semibold text-ink">{t.common.booking.difference}</span>
        <Money value={net} currency={currency} signed tone="credit" className="text-[20px] font-bold" />
      </div>

      {prevTotals && prevTotals.count > 0 && (
        <p className="mt-1 flex items-baseline justify-between gap-3 text-[13px] text-ink-3">
          <span className="tnum">{prevLabel}</span>
          <Money value={prevTotals.net} currency={prevTotals.currency} signed tone="plain" className="text-ink-2" />
        </p>
      )}

      {/* Wrapping between whole facts, with no dot left hanging at a line's end. */}
      {basis.length > 0 && (
        <p className="tnum mt-3 text-[12.5px] leading-snug text-ink-3">
          <DotList items={basis} />
        </p>
      )}
    </div>
  );
}
