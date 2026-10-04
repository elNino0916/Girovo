'use client';

// "Umsatzanalyse" — where the money went, read from the bookings that are
// already loaded. Nothing on this tab asks the bank for anything except the
// one explicit "Umsätze für 12 Monate abrufen" button, which goes through the
// same applyRange path (and the same TAN gate) as the Umsätze period control.
//
// Every figure states its basis: which account(s), which days, how many
// bookings, that Umbuchungen between the user's own accounts were left out,
// and that it was worked out on this machine. Figures that are averages say
// over how many complete months. Every "show me those bookings" opens the
// Umsätze list on exactly the days the figure counted.
//
// The period and the accounts live in the provider, not here: a look at the
// Umsätze and back finds the analysis where it was left.

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useFints } from './FintsProvider';
import { Money, usePrivacy } from './Money';
import { Button, DotList, EmptyState, ErrorState, Segmented, Spinner } from './ui';
import type { Counterparty } from '@/lib/analytics';
import type { TxFilter } from '@/lib/app-types';
import type { CategoryId } from '@/lib/categories';
import { categoryDef, categoryLabel, counterpartyName, intermediaryName } from '@/lib/categories';
import type { SerializedTransaction } from '@/lib/fints-types';
import { fmtAmountInput, fmtIban, fmtRange, prettyBookingText } from '@/lib/format';
import {
  WHOLE_RANGE, averageExpense, defaultPeriod, firstBookingDay, loadedPeers, useMonths, usePeriodFigures, useScopeData,
} from './insights/analysis-model';
import {
  AnalysisSkeleton, CategoryBreakdown, Kpi, LargestExpenses, MonthlyComparison, PeriodPicker, TopPayees,
  periodLabel,
} from './insights/AnalysisParts';
import { useRecurringModel } from './insights/recurring-model';
import { LoadHistoryButton, YEAR_SPAN, fmtDayKey, spanDays, useShowInList } from './insights/shared';

/** "103 Umsätze" — joined by a no-break space, so a count never wraps away from its noun. */
const plural = (n: number, one: string, many: string) => `${n.toLocaleString('de-DE')} ${n === 1 ? one : many}`;

/**
 * "aus 12 Umsätzen" — the bookings a headline figure is made of. Not
 * "Eingänge"/"Ausgänge": a refund netted into the Ausgaben is one of their
 * bookings, but it is no money going out.
 */
const fromBookings = (n: number) => (n === 0 ? 'keine Umsätze' : `aus ${plural(n, 'Umsatz', 'Umsätzen')}`);

/** "GiroKomfort und Visa Classic", "A, B und C". */
const joinNames = (names: string[]) =>
  names.length > 1 ? `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}` : names[0] ?? '';

export function Analysis() {
  const {
    activeAccount, accounts, transactions, txByAccount, statementInfo, categoryOf, loadingAccount, txError,
    busy, accountLabel, showTransactions, refreshAccount,
    analysisPeriod, setAnalysisPeriod, analysisScope, setAnalysisScope,
  } = useFints();
  const headingId = useId();
  const privacy = usePrivacy();

  const data = useScopeData({ scope: analysisScope, activeAccount, accounts, transactions, txByAccount, statementInfo });
  const months = useMonths(data, categoryOf);
  // Until the user picks one, the last complete month: the question is
  // "where did the money go this month", and households think in months.
  const period = analysisPeriod ?? defaultPeriod(months);

  // Recognised contracts and cash withdrawals are shown elsewhere (Verträge,
  // Top-Empfänger); "Größte Einzelausgaben" is for the one-off ones.
  const recurring = useRecurringModel();
  const contractTxs = useMemo(() => {
    const set = new Set<SerializedTransaction>();
    for (const s of [...recurring.income, ...recurring.expense, ...recurring.ended]) for (const tx of s.transactions) set.add(tx);
    return set;
  }, [recurring.income, recurring.expense, recurring.ended]);
  const notOneOff = useCallback(
    (tx: SerializedTransaction) => contractTxs.has(tx) || categoryOf(tx).id === 'cash',
    [contractTxs, categoryOf],
  );

  const figures = usePeriodFigures(data, months, period, categoryOf, notOneOff);
  const average = useMemo(() => averageExpense(months), [months]);

  // A period that no longer exists (another account, a new range) falls back
  // to the default instead of showing an empty month.
  useEffect(() => {
    if (analysisPeriod && analysisPeriod !== WHOLE_RANGE && months.length && !months.some((m) => m.month === analysisPeriod)) {
      setAnalysisPeriod(null);
    }
  }, [months, analysisPeriod, setAnalysisPeriod]);

  // Said once the figures above have changed — a month picked in the chart
  // below the fold re-scopes tiles the eye may not see.
  const [announced, setAnnounced] = useState('');
  const choosePeriod = useCallback((p: string) => {
    setAnalysisPeriod(p);
    const m = months.find((x) => x.month === p);
    setAnnounced(`Analyse zeigt jetzt ${m ? m.title : 'den gesamten Zeitraum'}.`);
  }, [setAnalysisPeriod, months]);

  const peers = useMemo(
    () => loadedPeers(activeAccount, accounts, txByAccount, statementInfo).peers,
    [activeAccount, accounts, txByAccount, statementInfo],
  );

  const categoryName = useCallback((tx: SerializedTransaction) => categoryLabel(categoryOf(tx).id), [categoryOf]);

  const openOn = useShowInList();

  // The days every drill-down carries: the list then holds exactly the
  // bookings the figure counted. Left out when they are the whole loaded
  // range of the account the list shows.
  const ownInfo = activeAccount ? statementInfo[activeAccount.accountNumber] : undefined;
  const drill = useMemo((): Partial<TxFilter> => {
    if (!figures || !data) return {};
    const whole = !!ownInfo && figures.from === ownInfo.from && figures.to === ownInfo.to;
    return {
      ...(whole ? {} : { from: figures.from, to: figures.to }),
      ...(data.scope === 'all' ? { acrossAccounts: true } : {}),
    };
  }, [figures, data, ownInfo]);

  const showCategory = useCallback((id: CategoryId) => {
    // A category that can go either way (fees, "Sonstiges") is shown from its
    // spending side, the side this tile counted.
    showTransactions(categoryDef(id).direction === 'both' ? { ...drill, category: id, dir: 'out' } : { ...drill, category: id });
  }, [showTransactions, drill]);

  // The payee's debits — and, when the row's figure has refunds netted into
  // it, those too, so the list holds exactly the bookings the row counted.
  // Cash is a category, not a payee; a shop paid through PayPal is found by
  // its name in the purpose, not by PayPal's IBAN.
  const showPayee = useCallback((p: Counterparty) => {
    const dir = p.offsets > 0 ? {} : { dir: 'out' as const };
    if (p.cash) {
      openOn(p.sample, { ...drill, category: 'cash', dir: 'out' });
      return;
    }
    openOn(p.sample, { ...drill, ...dir, query: p.iban ? fmtIban(p.iban) : p.name });
  }, [openOn, drill]);

  // One booking, found again in the list by its counterparty and its exact
  // signed amount — the search box then says plainly what it is showing.
  // With "Beträge ausblenden" on, the amount stays out of that visible box:
  // the counterparty (by IBAN where there is one) and the direction narrow
  // the list instead, and its amounts stay masked.
  const showBooking = useCallback((tx: SerializedTransaction) => {
    const who = counterpartyName(tx) || prettyBookingText(tx.bookingText);
    if (privacy) {
      // An intermediary's IBAN would find every shop it serves; the shop's name finds this one.
      const iban = intermediaryName(tx) ? '' : (tx.remoteIban || '').trim();
      openOn(tx, { ...drill, query: iban ? fmtIban(iban) : who, dir: tx.amount < 0 ? 'out' : 'in' });
      return;
    }
    const amount = `${tx.amount < 0 ? '-' : ''}${fmtAmountInput(Math.abs(tx.amount))}`;
    openOn(tx, { ...drill, query: [who, amount].filter(Boolean).join(' ') });
  }, [openOn, privacy, drill]);

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
            title="Umsätze noch nicht abgerufen"
            action={<Button variant="primary" size="sm" disabled={busy} onClick={() => refreshAccount(activeAccount)}>Umsätze abrufen</Button>}
          >
            Die Analyse wertet die Umsätze von {accountLabel(activeAccount)} aus. Das Abrufen kann eine Freigabe erfordern.
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
  const showHistoryButton = !ownInfo || spanDays(ownInfo.from, ownInfo.to) < YEAR_SPAN;
  const empty = data.txs.length === 0;
  const first = firstBookingDay(data);
  const lateStart = months.some((m) => m.noData) && !!first;

  // How this month compares with the other complete months — never with an
  // average it is part of, and only when both sides are whole months, so a
  // half October is never "40 % below".
  let versusAverage: string | null = null;
  const others = selectedMonth?.complete ? averageExpense(months, { except: selectedMonth.month, min: 1 }) : null;
  if (selectedMonth && others && others.value > 0) {
    const diff = (selectedMonth.expense - others.value) / others.value;
    const pct = Math.round(Math.abs(diff) * 100);
    const basis = others.months.length === 1
      ? `im ${others.months[0].title.split(' ')[0]}`
      : `im Schnitt der ${others.months.length} anderen vollen Monate`;
    versusAverage = pct === 0
      ? `so viel wie ${basis}`
      : `${pct} % ${diff > 0 ? 'mehr' : 'weniger'} als ${basis}`;
  }

  const scopeNames = data.accounts.map((acc) => accountLabel(acc));
  const peerNames = peers.map((acc) => accountLabel(acc));

  return (
    <div className="min-w-0 space-y-4 sm:space-y-6">
      {/* ---- Toolbar, basis and the headline figures --------------------- */}
      <section className="panel overflow-hidden" aria-labelledby={headingId}>
        <h2 id={headingId} className="sr-only">Überblick</h2>
        <p className="sr-only" aria-live="polite">{announced}</p>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 pt-4 sm:px-6 sm:pt-5">
          <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
            {peers.length > 0 && (
              <Segmented
                aria-label="Welche Konten"
                size="sm"
                value={data.scope}
                onChange={setAnalysisScope}
                options={[
                  { value: 'account', label: 'Dieses Konto' },
                  { value: 'all', label: 'Alle Konten mit Umsätzen' },
                ]}
              />
            )}
            <PeriodPicker
              period={period}
              months={months}
              rangeText={rangeText}
              onChange={choosePeriod}
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
              `Basis: ${joinNames(scopeNames)}`,
              <span className="whitespace-nowrap">{rangeText}</span>,
              <>
                {plural(totals.count, 'Umsatz', 'Umsätze')}
                {period !== WHOLE_RANGE && <> im {pLabel}</>}
              </>,
              // The other accounts are one switch away — and a card's purchases
              // are there, not here, when this account pays the card's bill
              // as an Umbuchung.
              data.scope === 'account' && peers.length > 0 && `ohne ${joinNames(peerNames)}`,
              totals.excluded > 0 && `${plural(totals.excluded, 'Umbuchung', 'Umbuchungen')} ausgeklammert`,
              lateStart && <span className="whitespace-nowrap">erste Buchung am {fmtDayKey(first)}</span>,
              data.clipped && 'Zeitraum, den alle Konten abdecken',
              data.otherCurrencyAccounts > 0 &&
                `${plural(data.otherCurrencyAccounts, 'Konto', 'Konten')} in anderer Währung nicht enthalten`,
              totals.otherCurrency > 0 && `${plural(totals.otherCurrency, 'Umsatz', 'Umsätze')} in Fremdwährung nicht enthalten`,
              'berechnet auf diesem Rechner',
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
                    <span aria-hidden className="sm:hidden">Ø Monatsausgaben</span>
                    <span aria-hidden className="hidden sm:inline">Ø Ausgaben pro Monat</span>
                    <span className="sr-only">Durchschnittliche Ausgaben pro Monat</span>
                  </>
                }
                sub={
                  average
                    ? `aus ${plural(average.months.length, 'vollem Monat', 'vollen Monaten')}`
                    : 'Braucht mindestens zwei volle Monate'
                }
              >
                {average ? <Money value={average.value} currency={data.currency} tone="plain" /> : <span className="text-[16px] font-semibold text-ink-3">Noch zu wenig Verlauf</span>}
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
            action={showHistoryButton ? <LoadHistoryButton layout="centered" /> : undefined}
          >
            Für {rangeText} ({plural(loadedSpan, 'Tag', 'Tage')}) liegen keine Buchungen vor.
            {showHistoryButton && ' Mit einem längeren Verlauf gibt es vielleicht etwas auszuwerten.'}
          </EmptyState>
        </section>
      ) : (
        // Two independent columns on wide screens, so a long category list
        // doesn't leave a hole under the month chart. Narrower, the columns
        // stack one after the other — the order of the markup, which is also
        // the order Tab and a screen reader take at every width.
        <div
          className="flex flex-col gap-4 transition-opacity duration-200 sm:gap-6 desk:grid desk:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)] desk:items-start"
          style={{ opacity: loading ? 0.55 : 1 }}
          aria-busy={loading || undefined}
        >
          <div className="flex min-w-0 flex-col gap-4 sm:gap-6">
            <CategoryBreakdown
              rows={totals.byCategory}
              total={totals.expense}
              currency={data.currency}
              subtitle={pLabel}
              onShow={showCategory}
            />
            <LargestExpenses
              items={figures.biggest}
              subtitle={`ohne Verträge, Abos und Bargeld · ${pLabel}`}
              categoryName={categoryName}
              onShow={showBooking}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-4 sm:gap-6">
            <MonthlyComparison months={months} currency={data.currency} selected={period} onSelect={choosePeriod} />
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
      )}
    </div>
  );
}
