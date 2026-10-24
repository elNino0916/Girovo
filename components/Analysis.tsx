'use client';

// "Umsatzanalyse" — where the money went, read from the bookings that are
// already loaded. Nothing on this tab asks the bank for anything except the
// one explicit "Umsätze für 12 Monate abrufen" button, which goes through the
// same applyRange path (and the same TAN gate) as the Umsätze period control.
//
// Every figure states its basis: which account(s), which days, how many
// bookings, and that Umbuchungen between the user's own accounts were not
// counted. Figures that are averages say over how many complete months.
// The 12-month button is the tab's one control that asks the bank, so the
// approval note stands beside it. Every "show me those bookings" opens the
// Umsätze list on exactly the days the figure counted.
//
// On Android with Gemini Nano, "Frag deine Umsätze" (components/insights/Ask.tsx)
// heads the tab: a question read into a search, answered from these bookings.
//
// Two of the user's own things sit beside the figures: the Monatsbudgets
// (components/insights/Budgets.tsx), compared with the month on view, and
// the Kategorie-Check (components/insights/CategoryCheck.tsx), how the
// automatic categories fared with the bookings in view. Both are worked out
// here too, and neither leaves the machine.
//
// The period and the accounts live in the provider, not here: a look at the
// Umsätze and back finds the analysis where it was left.

import { GoalsSection } from './overview/SavingsGoal';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { CategoryProgress } from './android/CategoryProgress';
import { useFints } from './FintsProvider';
import { Money, usePrivacy } from './Money';
import { Button, DotList, EmptyState, ErrorState, Segmented, Spinner } from './ui';
import type { Counterparty } from '@/lib/analytics';
import { bookingDay, periodTotals } from '@/lib/analytics';
import type { TxFilter } from '@/lib/app-types';
import { namesList } from '@/lib/balances';
import { averageByCategory } from '@/lib/budgets';
import type { CategoryId } from '@/lib/categories';
import { categoryDef, categoryLabel, counterpartyName, intermediaryName } from '@/lib/categories';
import type { SerializedTransaction } from '@/lib/fints-types';
import { fmtAmountInput, fmtIban, fmtMonth, fmtRange, prettyBookingText } from '@/lib/format';
import { useT } from '@/lib/i18n/react';
import {
  WHOLE_RANGE, averageExpense, defaultPeriod, firstBookingDay, loadedPeers, useMonths, usePeriodFigures, useScopeData,
} from './insights/analysis-model';
import {
  AnalysisSkeleton, CategoryBreakdown, Kpi, LargestExpenses, MonthlyComparison, PeriodPicker, TopPayees,
  periodLabel,
} from './insights/AnalysisParts';
import { AskTile } from './insights/Ask';
import { BudgetDialog, BudgetTile } from './insights/Budgets';
import { TaxYearTile } from './insights/TaxYear';
import { CategoryCheckDrawer, CategoryCheckSummary, useCategoryCheck } from './insights/CategoryCheck';
import { useRecurringModel } from './insights/recurring-model';
import { LoadHistoryButton, YEAR_SPAN, fmtDayKey, spanDays, useShowInList } from './insights/shared';

/** One of the phone's summary figures after the lead: the label left, the value right, a note under the label. */
function SummaryRow({ label, sub, children }: { label: React.ReactNode; sub?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="min-w-0">
        <span className="block text-[14px] leading-5 text-ink-2">{label}</span>
        {sub && <span className="block text-[12.5px] leading-4 text-ink-3">{sub}</span>}
      </dt>
      <dd className="shrink-0 text-[16px] leading-[22px] font-medium text-ink">{children}</dd>
    </div>
  );
}

export function Analysis() {
  const {
    activeAccount, accounts, transactions, txByAccount, statementInfo, categoryOf, loadingAccount, txError,
    busy, accountLabel, showTransactions, refreshAccount,
    analysisPeriod, setAnalysisPeriod, analysisScope, setAnalysisScope,
    vault, vaultStatus, setBudgets,
  } = useFints();
  const headingId = useId();
  const privacy = usePrivacy();
  const t = useT();
  const words = t.insights.analysis;

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
  // below the fold re-scopes tiles the eye may not see. What was picked is
  // kept (a month, or null for the whole range), not the sentence: that is
  // said in the language on screen.
  const [announcedMonth, setAnnouncedMonth] = useState<{ month: string | null } | null>(null);
  const choosePeriod = useCallback((p: string) => {
    setAnalysisPeriod(p);
    const m = months.find((x) => x.month === p);
    setAnnouncedMonth((prev) => (prev && prev.month === (m?.month ?? null) ? prev : { month: m?.month ?? null }));
  }, [setAnalysisPeriod, months]);
  const announced = announcedMonth ? words.nowShowing(announcedMonth.month ? fmtMonth(announcedMonth.month) : null) : '';

  const peers = useMemo(
    () => loadedPeers(activeAccount, accounts, txByAccount, statementInfo).peers,
    [activeAccount, accounts, txByAccount, statementInfo],
  );

  const categoryName = useCallback((tx: SerializedTransaction) => categoryLabel(categoryOf(tx).id), [categoryOf]);

  const openOn = useShowInList();

  // ---- Monatsbudgets and the Kategorie-Check ------------------------------
  const budgets = vault?.budgets;
  const hasBudgets = !!budgets && Object.keys(budgets).length > 0;
  const [budgetsOpen, setBudgetsOpen] = useState(false);
  const [checkOpen, setCheckOpen] = useState(false);
  // What a category cost in an average complete month — a guide in the
  // budget dialog, worked out only while it is open.
  const averages = useMemo(() => {
    if (!budgetsOpen || !data) return new Map<CategoryId, number>();
    const opts = { categoryOf, currency: data.currency };
    const complete = months.filter((m) => m.complete);
    return averageByCategory(complete.map((m) => periodTotals(data.txs, { ...opts, from: m.from, to: m.to }).byCategory));
  }, [budgetsOpen, data, months, categoryOf]);
  // The check covers what the toolbar covers: the accounts in scope, the period picked.
  const checkTxs = useMemo(() => {
    if (!data || !figures) return [];
    return data.txs.filter((tx) => {
      const day = bookingDay(tx);
      return day >= figures.from && day <= figures.to;
    });
  }, [data, figures]);
  const check = useCategoryCheck(checkTxs);

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
      <section className="panel" aria-label={words.label}>
        <EmptyState illustration="chart" title={words.noAccount}>
          {words.noAccountHint}
        </EmptyState>
      </section>
    );
  }
  const loading = loadingAccount === activeAccount.accountNumber;
  if (!transactions) {
    if (txError && !loading) {
      return (
        <section className="panel" aria-label={words.label}>
          <ErrorState title={words.loadFailed} onRetry={() => refreshAccount(activeAccount)} busy={busy}>
            {txError}
          </ErrorState>
        </section>
      );
    }
    if (!activeAccount.canStatements) {
      return (
        <section className="panel" aria-label={words.label}>
          <EmptyState illustration="chart" title={t.insights.bookings.noneForAccount}>
            {words.unsupported(accountLabel(activeAccount))}
          </EmptyState>
        </section>
      );
    }
    if (!loading) {
      // Not loaded and not on its way — loading is the user's call, since it
      // may need a TAN.
      return (
        <section className="panel" aria-label={words.label}>
          <EmptyState
            illustration="chart"
            title={words.notLoaded}
            action={<Button variant="primary" size="sm" disabled={busy} onClick={() => refreshAccount(activeAccount)}>{t.insights.bookings.load}</Button>}
          >
            {words.notLoadedHint(accountLabel(activeAccount))}
          </EmptyState>
        </section>
      );
    }
    return (
      <div role="status" aria-label={t.insights.bookings.loading}>
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
  // It fetches the active account's year: with every account counted, it says whose.
  const yearLabel = data.scope === 'all' ? t.insights.loadYear.labelFor(accountLabel(activeAccount)) : undefined;
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
      ? words.versus.month(fmtMonth(others.months[0].month).split(' ')[0])
      : words.versus.average(others.months.length);
    versusAverage = pct === 0
      ? words.versus.same(basis)
      : diff > 0 ? words.versus.more(pct, basis) : words.versus.less(pct, basis);
  }

  const scopeNames = data.accounts.map((acc) => accountLabel(acc));
  const peerNames = peers.map((acc) => accountLabel(acc));
  // The month the budgets offer while the whole range is on view: the newest with bookings.
  const newestMonth = [...months].reverse().find((m) => !m.noData) ?? null;

  return (
    <div className="min-w-0 space-y-4 sm:space-y-6">
      {/* Android, where the phone has Gemini Nano: a question about these bookings. */}
      <AskTile data={data} />

      {/* ---- Toolbar, basis and the headline figures --------------------- */}
      <section className="panel overflow-hidden" aria-labelledby={headingId}>
        <h2 id={headingId} className="sr-only">{words.overview}</h2>
        <p className="sr-only" aria-live="polite">{announced}</p>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 pt-4 sm:px-6 sm:pt-5">
          <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
            {peers.length > 0 && (
              <Segmented
                aria-label={words.scope.label}
                size="sm"
                value={data.scope}
                onChange={setAnalysisScope}
                options={[
                  { value: 'account', label: words.scope.account },
                  { value: 'all', label: words.scope.all },
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
              <Spinner size={14} /> {t.insights.bookings.loadingDots}
            </span>
          )}
        </div>

        {/* The range never splits at its dash, and no dot is left hanging at
            a line's end where the facts wrap. */}
        <p className="tnum px-4 pt-3 text-[13px] leading-relaxed text-ink-3 sm:px-6">
          {/* The period is the picker's, the account the only one unless there
              are several, and where it was worked out goes without saying. */}
          <DotList
            items={[
              accounts.length > 1 && t.insights.basis(namesList(scopeNames)),
              t.insights.count.bookings(totals.count),
              // The other accounts are one switch away — and a card's purchases
              // are there, not here, when this account pays the card's bill
              // as an Umbuchung.
              data.scope === 'account' && peers.length > 0 && t.insights.without(namesList(peerNames)),
              totals.excluded > 0 && words.transfersLeftOut(totals.excluded),
              lateStart && <span className="whitespace-nowrap">{words.firstBooking(fmtDayKey(first))}</span>,
              data.clipped && words.commonPeriod,
              data.otherCurrencyAccounts > 0 && words.otherCurrencyAccounts(data.otherCurrencyAccounts),
              totals.otherCurrency > 0 && words.foreignBookings(totals.otherCurrency),
            ]}
          />
        </p>

        {/* Android: the sums move while Gemini Nano fills in categories. */}
        <CategoryProgress className="px-4 pt-3 sm:px-6" />

        {/* Nothing booked means nothing to sum — a row of 0,00 € would read
            as a finding. The empty tile below says what is going on instead. */}
        {empty ? (
          <div className="h-4 sm:h-5" />
        ) : (
          <>
            {/* A phone: the month's spending leads — the figure people open
                the Analyse for, with how it compares — and the other three
                follow as a label and a value each. */}
            <div className="px-4 pt-4 pb-2 transition-opacity duration-200 sm:hidden" style={{ opacity: loading ? 0.55 : 1 }}>
              <p className="text-[14px] leading-5 font-medium text-ink-2">{t.common.booking.spending}</p>
              <p data-figure className="leading-none">
                <Money value={totals.expense} currency={data.currency} tone="plain" split className="text-[36px] leading-[44px] font-medium" centsClassName="text-[0.58em]" />
              </p>
              {versusAverage && <p className="mt-1 text-[14px] leading-5 text-ink-2">{versusAverage}</p>}
              <dl className="mt-3">
                <SummaryRow label={t.insights.income}>
                  <Money value={totals.income} currency={data.currency} tone="plain" />
                </SummaryRow>
                <SummaryRow label={t.common.booking.difference}>
                  <Money value={totals.net} currency={data.currency} signed tone="credit" />
                </SummaryRow>
                <SummaryRow
                  label={<>{words.average.label}<span className="sr-only"> ({words.average.spoken})</span></>}
                  sub={average ? words.average.fromMonths(average.months.length) : words.average.needsTwo}
                >
                  {average ? <Money value={average.value} currency={data.currency} tone="plain" /> : <span className="text-ink-3">{words.average.tooShort}</span>}
                </SummaryRow>
              </dl>
            </div>
            <dl
              className="mt-4 grid grid-cols-2 gap-px border-t border-line bg-line transition-opacity duration-200 max-sm:hidden desk:grid-cols-4"
              style={{ opacity: loading ? 0.55 : 1 }}
            >
              <Kpi label={t.insights.income}>
                <Money value={totals.income} currency={data.currency} tone="plain" />
              </Kpi>
              <Kpi
                label={t.common.booking.spending}
                sub={versusAverage}
              >
                <Money value={totals.expense} currency={data.currency} tone="plain" />
              </Kpi>
              {/* The sign says it. */}
              <Kpi label={t.common.booking.difference}>
                <Money value={totals.net} currency={data.currency} signed tone="credit" />
              </Kpi>
              <Kpi
                label={
                  <>
                    <span aria-hidden className="sm:hidden">{words.average.short}</span>
                    <span aria-hidden className="hidden sm:inline">{words.average.label}</span>
                    <span className="sr-only">{words.average.spoken}</span>
                  </>
                }
                sub={average ? words.average.fromMonths(average.months.length) : words.average.needsTwo}
              >
                {average ? <Money value={average.value} currency={data.currency} tone="plain" /> : <span className="text-[15px] font-semibold text-ink-3">{words.average.tooShort}</span>}
              </Kpi>
            </dl>
            {showHistoryButton && (
              <div className="border-t border-line px-4 py-3 sm:px-6">
                <LoadHistoryButton variant="tertiary" flush note label={yearLabel} />
              </div>
            )}
          </>
        )}
      </section>

      {empty ? (
        <section className="panel" aria-label={t.insights.bookings.none}>
          <EmptyState
            illustration="chart"
            title={t.insights.bookings.noneInRange}
            action={showHistoryButton ? <LoadHistoryButton layout="centered" note label={yearLabel} /> : undefined}
          >
            {words.emptyRange(rangeText, loadedSpan)}
            {showHistoryButton && ` ${words.emptyRangeLonger}`}
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
              onShow={showCategory}
              // The way to budgets while there are none; once set, their tile carries it.
              actions={!hasBudgets && (
                <Button variant="tertiary" size="xs" className="max-sm:-ml-3" onClick={() => setBudgetsOpen(true)}>{t.budgets.budget.set}</Button>
              )}
              footer={check.total > 0 && <CategoryCheckSummary check={check} onOpen={() => setCheckOpen(true)} />}
            />
            {hasBudgets && (
              <BudgetTile
                budgets={budgets}
                month={selectedMonth}
                spending={totals.byCategory}
                currency={data.currency}
                newest={newestMonth}
                onShowMonth={choosePeriod}
                onShow={showCategory}
                onEdit={() => setBudgetsOpen(true)}
              />
            )}
            <LargestExpenses
              items={figures.biggest}
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
              categoryName={categoryName}
              onShow={showPayee}
            />
          </div>
        </div>
      )}

      {/* The year's bookings for the tax return, whatever the period on view. */}
      <TaxYearTile />

      {/* Overlays render in place (never portalled); this column is no stacking context. */}
      <BudgetDialog
        open={budgetsOpen}
        onClose={() => setBudgetsOpen(false)}
        budgets={budgets ?? {}}
        averages={averages}
        currency={data.currency}
        sessionOnly={vaultStatus !== 'ready'}
        onSave={setBudgets}
      />
      <CategoryCheckDrawer
        open={checkOpen}
        onClose={() => setCheckOpen(false)}
        check={check}
        basis={[
          t.insights.basis(namesList(scopeNames)),
          <span className="whitespace-nowrap">{pLabel}</span>,
        ]}
      />

      {/* Sparziele: every goal with its account (components/overview/SavingsGoal.tsx). */}
      <GoalsSection />
    </div>
  );
}
