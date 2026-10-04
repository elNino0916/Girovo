'use client';

import { useId, useMemo } from 'react';
import { periodTotals } from '@/lib/analytics';
import type { PeriodTotals } from '@/lib/analytics';
import { fmtMonth, fmtRange, isoDate, presetRange, toLocalDate } from '@/lib/format';
import { comparisonSpan, type ComparisonSpan } from '@/lib/month-summary';
import { useFints } from '../FintsProvider';
import { Money, usePrivacy } from '../Money';
import { ChevronIcon } from '../icons';
import { Button, DotList, EmptyState, Skeleton, TileHeader } from '../ui';

const NBSP = '\u00a0';
const pad2 = (n: number) => String(n).padStart(2, '0');
/** "03.10." */
const dayMonth = (key: string) => {
  const d = toLocalDate(key);
  return d ? `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.` : '';
};
const monthName = (key: string) => fmtMonth(key).split(' ')[0];

/** "Im September", "Im September bis 04.09.", "Im September, 03.09.–04.09." */
function comparisonLabel(span: ComparisonSpan): string {
  const month = `Im ${monthName(span.from)}`;
  if (span.wholeMonth) return month;
  if (span.from.endsWith('-01')) return `${month} bis ${dayMonth(span.to)}`;
  return `${month}, ${dayMonth(span.from)}–${dayMonth(span.to)}`;
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
    accountLabel, setTab, setAnalysisPeriod,
  } = useFints();
  const titleId = useId();

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
        ? `bis ${dayMonth(data.coverage.to)}`
        : `${dayMonth(data.coverage.from)}–${dayMonth(data.coverage.to)}`
    : null;

  return (
    <section className="panel min-w-0 overflow-clip" aria-labelledby={titleId} aria-busy={loading || undefined}>
      <TileHeader
        title="Monatsbilanz"
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
          <span className="sr-only">Umsätze werden geladen</span>
        </div>
      ) : !a.canStatements ? (
        <EmptyState compact title="Keine Umsätze für dieses Konto" className="pt-1">
          Deine Bank bietet für dieses Konto keine Umsatzabfrage über FinTS an.
        </EmptyState>
      ) : !info && txErrors[acct] ? (
        // The reason, and the way to try again, stand with the Kontostand and
        // the Umsätze; said a third time here it would only be louder.
        <EmptyState compact title="Abruf fehlgeschlagen" className="pt-1">
          Sobald die Umsätze dieses Kontos abgerufen sind, steht hier die Bilanz des Monats.
        </EmptyState>
      ) : !info || !data ? (
        <EmptyState compact title="Keine Umsätze geladen" className="pt-1">
          Sobald die Umsätze dieses Kontos abgerufen sind, steht hier die Bilanz des Monats.
        </EmptyState>
      ) : !data.coverage || !data.totals ? (
        <EmptyState
          compact
          title={`${name} ist nicht geladen`}
          className="pt-1"
          action={
            <>
              {/* The default window: this month and the one before, and the
                  span most banks serve without an extra approval. */}
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => applyRange(presetRange('90d'))}>
                Bis heute laden
              </Button>
              <p className="w-full text-[13px] leading-snug text-ink-3">Lädt die letzten 90 Tage. Kann eine Freigabe erfordern.</p>
            </>
          }
        >
          Geladen ist der Zeitraum <span className="tnum whitespace-nowrap">{fmtRange(info.from, info.to)}</span>.
        </EmptyState>
      ) : data.totals.count === 0 ? (
        <EmptyState compact title={`Noch keine Umsätze im ${name}`} className="pt-1">
          {data.totals.excluded > 0
            ? `Bisher nur ${data.totals.excluded === 1 ? 'eine Umbuchung' : `${data.totals.excluded} Umbuchungen`} zwischen deinen eigenen Konten – die zählen hier nicht mit.`
            : 'Sobald etwas gebucht ist, siehst du hier, was rein- und rausging.'}
        </EmptyState>
      ) : (
        <Body
          totals={data.totals}
          prevTotals={data.prev?.totals ?? null}
          prevLabel={data.prev ? comparisonLabel(data.prev.span) : ''}
          accountName={accounts.length > 1 ? accountLabel(a) : null}
        />
      )}

      {/* The way on, as a full-width row at the foot of the tile — the same
          shape the other side tiles use, and it leaves the header to the
          month and how far it goes. */}
      <button
        type="button"
        // The month this tile shows — the Analyse would otherwise open on the
        // last complete one (yyyy-mm; a month without bookings falls back there).
        onClick={() => { setAnalysisPeriod(month.start.slice(0, 7)); setTab('analysis'); }}
        className="row-focus flex w-full items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-left text-[13.5px] font-semibold text-accent hover:bg-accent-soft sm:px-5"
      >
        Zur Analyse
        <ChevronIcon dir="right" size={15} />
      </button>
    </section>
  );
}

function Body({
  totals, prevTotals, prevLabel, accountName,
}: { totals: PeriodTotals; prevTotals: PeriodTotals | null; prevLabel: string; accountName: string | null }) {
  const { income, expense, net, currency } = totals;
  const privacy = usePrivacy();

  const facts = [
    totals.count === 1 ? '1 Umsatz' : `${totals.count} Umsätze`,
    totals.excluded > 0 && `ohne ${totals.excluded === 1 ? '1 Umbuchung' : `${totals.excluded} Umbuchungen`}`,
    totals.otherCurrency > 0 && `ohne ${totals.otherCurrency} in Fremdwährung`,
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
            Einnahmen
          </dt>
          <dd className="text-[15px] font-semibold text-ink">
            <Money value={income} currency={currency} tone="plain" />
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="flex items-center gap-2 text-[14px] text-ink-2">
            <span aria-hidden className="size-2.5 shrink-0 rounded-[3px] bg-chart-out" />
            Ausgaben
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
        <span className="text-[14px] font-semibold text-ink">Differenz</span>
        <Money value={net} currency={currency} signed tone="credit" className="text-[18px] font-bold" />
      </div>

      {prevTotals && prevTotals.count > 0 && (
        <p className="mt-1 flex items-baseline justify-between gap-3 text-[13px] text-ink-3">
          <span className="tnum">{prevLabel}</span>
          <Money value={prevTotals.net} currency={prevTotals.currency} signed tone="plain" className="text-ink-2" />
        </p>
      )}

      {/* Wrapping between whole facts, with no dot left hanging at a line's end. */}
      <p className="tnum mt-3 text-[12.5px] leading-snug text-ink-3">
        <DotList items={basis.map((part, i) => (i === 0 ? `Basis: ${part}` : part))} />
      </p>
    </div>
  );
}
