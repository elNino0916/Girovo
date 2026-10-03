'use client';

// "Umsatzanalyse" — where the money went, read from the bookings that are
// already loaded. Nothing on this tab asks the bank for anything except the
// one explicit "Mehr Verlauf laden" button, which goes through the same
// applyRange path (and the same TAN gate) as the Umsätze period control.
//
// Every figure states its basis: which account(s), which days, how many
// bookings, and that Umbuchungen between the user's own accounts were left
// out. Figures that are averages say over how many complete months.

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useFints } from './FintsProvider';
import { Money, usePrivacy } from './Money';
import { Button, DotList, EmptyState, ErrorState, Segmented, Spinner } from './ui';
import type { Counterparty } from '@/lib/analytics';
import type { CategoryId } from '@/lib/categories';
import { categoryDef, categoryLabel } from '@/lib/categories';
import type { SerializedTransaction } from '@/lib/fints-types';
import { fmtAmountInput, fmtRange, prettyBookingText } from '@/lib/format';
import {
  WHOLE_RANGE, averageExpense, loadedPeers, useMonths, usePeriodFigures, useScopeData,
  type AnalysisPeriod, type AnalysisScope,
} from './insights/analysis-model';
import {
  AnalysisSkeleton, CategoryBreakdown, Kpi, LargestExpenses, MonthlyComparison, PeriodPicker, TopPayees,
  periodLabel,
} from './insights/AnalysisParts';
import { LoadHistoryButton, YEAR_SPAN, spanDays, useShowInList } from './insights/shared';

/** "103 Umsätze" — joined by a no-break space, so a count never wraps away from its noun. */
const plural = (n: number, one: string, many: string) => `${n.toLocaleString('de-DE')}\u00a0${n === 1 ? one : many}`;

/**
 * "aus 12 Umsätzen" — the bookings a headline figure is made of. Not
 * "Eingänge"/"Ausgänge": a refund netted into the Ausgaben is one of their
 * bookings, but it is no money going out.
 */
const fromBookings = (n: number) => (n === 0 ? 'keine Umsätze' : `aus ${plural(n, 'Umsatz', 'Umsätzen')}`);

export function Analysis() {
  const {
    activeAccount, accounts, transactions, txByAccount, statementInfo, categoryOf, loadingAccount, txError,
    busy, accountLabel, showTransactions, refreshAccount,
  } = useFints();
  const headingId = useId();
  const privacy = usePrivacy();

  const [scope, setScope] = useState<AnalysisScope>('account');
  const [period, setPeriod] = useState<AnalysisPeriod>(WHOLE_RANGE);

  const data = useScopeData({ scope, activeAccount, accounts, transactions, txByAccount, statementInfo });
  const months = useMonths(data, categoryOf);
  const figures = usePeriodFigures(data, months, period, categoryOf);
  const average = useMemo(() => averageExpense(months), [months]);

  // A period that no longer exists (another account, a new range) falls back
  // to the whole range instead of showing an empty month.
  useEffect(() => {
    if (period !== WHOLE_RANGE && !months.some((m) => m.month === period)) setPeriod(WHOLE_RANGE);
  }, [months, period]);

  const peers = useMemo(
    () => loadedPeers(activeAccount, accounts, txByAccount, statementInfo).peers,
    [activeAccount, accounts, txByAccount, statementInfo],
  );

  const categoryName = useCallback((tx: SerializedTransaction) => categoryLabel(categoryOf(tx).id), [categoryOf]);

  const openOn = useShowInList();

  const showCategory = useCallback((id: CategoryId) => {
    // A category that can go either way (fees, "Sonstiges") is shown from its
    // spending side, the side this tile counted.
    showTransactions(categoryDef(id).direction === 'both' ? { category: id, dir: 'out' } : { category: id });
  }, [showTransactions]);

  // The payee's debits — and, when the row's figure has refunds netted into
  // it, those too, so the list holds exactly the bookings the row counted.
  const showPayee = useCallback((p: Counterparty) => {
    openOn(p.sample, p.offsets > 0 ? { query: p.iban ?? p.name } : { query: p.iban ?? p.name, dir: 'out' });
  }, [openOn]);

  // One booking, found again in the list by its counterparty and its exact
  // signed amount — the search box then says plainly what it is showing.
  // With "Beträge ausblenden" on, the amount stays out of that visible box:
  // the counterparty (by IBAN where there is one) and the direction narrow
  // the list instead, and its amounts stay masked.
  const showBooking = useCallback((tx: SerializedTransaction) => {
    const who = (tx.remoteName || '').trim() || prettyBookingText(tx.bookingText);
    if (privacy) {
      const iban = (tx.remoteIban || '').trim();
      openOn(tx, { query: iban || who, dir: tx.amount < 0 ? 'out' : 'in' });
      return;
    }
    const amount = `${tx.amount < 0 ? '-' : ''}${fmtAmountInput(Math.abs(tx.amount))}`;
    openOn(tx, { query: [who, amount].filter(Boolean).join(' ') });
  }, [openOn, privacy]);

  // ---- states before there is anything to analyse ------------------------
  if (!activeAccount) {
    return (
      <section className="panel" aria-label="Umsatzanalyse">
        <EmptyState illustration="chart" title="Kein Konto ausgewählt">
          Wähle in der Übersicht ein Konto, dessen Umsätze du auswerten möchtest.
        </EmptyState>
      </section>
    );
  }
  const loading = loadingAccount === activeAccount.accountNumber;
  if (!transactions) {
    if (txError && !loading) {
      return (
        <section className="panel" aria-label="Umsatzanalyse">
          <ErrorState title="Umsätze konnten nicht geladen werden" onRetry={() => refreshAccount(activeAccount)} busy={busy}>
            {txError}
          </ErrorState>
        </section>
      );
    }
    if (!activeAccount.canStatements) {
      return (
        <section className="panel" aria-label="Umsatzanalyse">
          <EmptyState illustration="chart" title="Keine Umsätze für dieses Konto">
            Für {accountLabel(activeAccount)} stellt deine Bank über diesen Zugang keine Umsätze bereit. Wähle ein
            anderes Konto, um es auszuwerten.
          </EmptyState>
        </section>
      );
    }
    if (!loading) {
      // Not loaded and not on its way — loading is the user's call, since it
      // may need a TAN.
      return (
        <section className="panel" aria-label="Umsatzanalyse">
          <EmptyState
            illustration="chart"
            title="Umsätze noch nicht geladen"
            action={<Button variant="primary" size="sm" disabled={busy} onClick={() => refreshAccount(activeAccount)}>Umsätze laden</Button>}
          >
            Die Analyse wertet die Umsätze von {accountLabel(activeAccount)} aus. Das Laden kann eine Freigabe erfordern.
          </EmptyState>
        </section>
      );
    }
    return (
      <div role="status" aria-label="Umsätze werden geladen">
        <AnalysisSkeleton />
      </div>
    );
  }
  if (!data || !figures) return null;

  const { totals } = figures;
  const rangeText = fmtRange(data.from, data.to);
  const pLabel = periodLabel(period, months, rangeText);
  const selectedMonth = period === WHOLE_RANGE ? null : months.find((m) => m.month === period) ?? null;
  const loadedSpan = spanDays(data.from, data.to);
  const ownInfo = statementInfo[activeAccount.accountNumber];
  const showHistoryButton = !ownInfo || spanDays(ownInfo.from, ownInfo.to) < YEAR_SPAN;
  const empty = data.txs.length === 0;

  // How this month compares with the average of the complete months — only
  // when both sides are whole months, so a half October is never "40 % below".
  let versusAverage: string | null = null;
  if (selectedMonth?.complete && average && average.value > 0) {
    const diff = (selectedMonth.expense - average.value) / average.value;
    const pct = Math.round(Math.abs(diff) * 100);
    versusAverage = pct === 0 ? 'genau im Durchschnitt' : `${pct}\u00a0% ${diff > 0 ? 'über' : 'unter'} dem Durchschnitt`;
  }

  const scopeName = data.scope === 'all' ? `${data.accounts.length} Konten` : accountLabel(activeAccount);

  return (
    <div className="min-w-0 space-y-4 sm:space-y-6">
      {/* ---- Toolbar, basis and the headline figures --------------------- */}
      <section className="panel overflow-hidden" aria-labelledby={headingId}>
        <h2 id={headingId} className="sr-only">Überblick</h2>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 pt-4 sm:px-6 sm:pt-5">
          <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
            {peers.length > 0 && (
              <Segmented
                aria-label="Welche Konten"
                size="sm"
                value={scope}
                onChange={setScope}
                options={[
                  { value: 'account', label: 'Dieses Konto' },
                  { value: 'all', label: `Alle geladenen Konten (${peers.length + 1})` },
                ]}
              />
            )}
            <PeriodPicker
              period={period}
              months={months}
              rangeText={rangeText}
              onChange={setPeriod}
              disabled={empty}
            />
          </div>
          {loading && (
            <span role="status" className="inline-flex items-center gap-2 text-[13px] text-ink-2">
              <Spinner size={14} /> Umsätze werden geladen …
            </span>
          )}
        </div>

        {/* The range never splits at its dash, and no dot is left hanging at
            a line's end where the facts wrap. */}
        <p className="tnum px-4 pt-3 text-[13px] leading-relaxed text-ink-3 sm:px-6">
          <DotList
            items={[
              `Basis: ${scopeName}`,
              <span className="whitespace-nowrap">{rangeText}</span>,
              <>
                {plural(totals.count, 'Umsatz', 'Umsätze')}
                {period !== WHOLE_RANGE && <> in {pLabel}</>}
              </>,
              totals.excluded > 0
                ? `${plural(totals.excluded, 'Umbuchung', 'Umbuchungen')} ausgeklammert`
                : 'Umbuchungen ausgeklammert',
              data.clipped && 'Zeitraum, den alle Konten abdecken',
              data.otherCurrencyAccounts > 0 &&
                `${plural(data.otherCurrencyAccounts, 'Konto', 'Konten')} in anderer Währung nicht enthalten`,
              totals.otherCurrency > 0 && `${plural(totals.otherCurrency, 'Umsatz', 'Umsätze')} in Fremdwährung nicht enthalten`,
            ]}
          />
        </p>

        {/* Nothing booked means nothing to sum — a row of 0,00 € would read
            as a finding. The empty tile below says what is going on instead. */}
        {empty ? (
          <div className="h-4 sm:h-5" />
        ) : (
          <>
            <dl
              className="mt-4 grid grid-cols-2 gap-px border-t border-line bg-line transition-opacity duration-200 desk:grid-cols-4"
              style={{ opacity: loading ? 0.55 : 1 }}
            >
              <Kpi
                label="Einnahmen"
                sub={fromBookings(figures.credits)}
              >
                <Money value={totals.income} currency={data.currency} tone="plain" />
              </Kpi>
              <Kpi
                label="Ausgaben"
                sub={versusAverage ?? fromBookings(figures.debits)}
              >
                <Money value={totals.expense} currency={data.currency} tone="plain" />
              </Kpi>
              <Kpi
                label="Differenz"
                sub={
                  Math.round(totals.net * 100) === 0
                    ? 'Einnahmen und Ausgaben gleich hoch'
                    : totals.net > 0 ? 'mehr eingenommen als ausgegeben' : 'mehr ausgegeben als eingenommen'
                }
              >
                <Money value={totals.net} currency={data.currency} signed tone="credit" />
              </Kpi>
              <Kpi
                label={
                  <>
                    <span className="sm:hidden">Ø Monatsausgaben</span>
                    <span className="hidden sm:inline">Ø Ausgaben pro Monat</span>
                  </>
                }
                sub={
                  average
                    ? `aus ${plural(average.months.length, 'vollem Monat', 'vollen Monaten')}`
                    : 'Braucht mindestens zwei volle Monate'
                }
              >
                {average ? <Money value={average.value} currency={data.currency} tone="plain" /> : <span className="text-[16px] font-semibold text-ink-3">zu wenig Daten</span>}
              </Kpi>
            </dl>
            {showHistoryButton && (
              <div className="border-t border-line px-4 py-3 sm:px-6">
                <LoadHistoryButton variant="tertiary" flush />
              </div>
            )}
          </>
        )}
      </section>

      {empty ? (
        <section className="panel" aria-label="Keine Umsätze">
          <EmptyState
            illustration="chart"
            title="Keine Umsätze im geladenen Zeitraum"
            action={showHistoryButton ? <LoadHistoryButton layout="stacked" className="items-center text-center" /> : undefined}
          >
            Für {rangeText} ({plural(loadedSpan, 'Tag', 'Tage')}) liegen keine Buchungen vor.
            {showHistoryButton && ' Mit einem längeren Verlauf gibt es vielleicht etwas auszuwerten.'}
          </EmptyState>
        </section>
      ) : (
        // Two independent columns on wide screens, so a long category list
        // doesn't leave a hole under the month chart; one column on phones in
        // reading order (display: contents lets the order classes reach the tiles).
        <div
          className="flex flex-col gap-4 transition-opacity duration-200 sm:gap-6 desk:grid desk:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)] desk:items-start"
          style={{ opacity: loading ? 0.55 : 1 }}
          aria-busy={loading || undefined}
        >
          <div className="contents desk:flex desk:flex-col desk:gap-6">
            <div className="order-1">
              <CategoryBreakdown
                rows={totals.byCategory}
                total={totals.expense}
                currency={data.currency}
                subtitle={pLabel}
                onShow={showCategory}
              />
            </div>
            <div className="order-4">
              <LargestExpenses
                items={figures.biggest}
                subtitle={pLabel}
                categoryName={categoryName}
                onShow={showBooking}
              />
            </div>
          </div>
          <div className="contents desk:flex desk:flex-col desk:gap-6">
            <div className="order-2">
              <MonthlyComparison months={months} currency={data.currency} selected={period} onSelect={setPeriod} />
            </div>
            <div className="order-3">
              <TopPayees
                payees={figures.payees}
                expense={totals.expense}
                currency={data.currency}
                subtitle={`nach Ausgaben · ${pLabel}`}
                categoryName={categoryName}
                onShow={showPayee}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

