'use client';

// The Übersicht of the desktop's frame with more than one account ticked
// ("Konten als Ebenen", components/overview/layers.ts): one ledger of the
// ticked accounts. At its head the Gesamtsaldo of what is ticked — never a
// partial sum: until every figure is known the heading says so and offers
// "Alle Salden abrufen", as the overview of every account does — with what
// is left out, and the month's Eingänge, Ausgänge and what is due. Then the
// account page's own chips over the merged bookings (the same filter, so a
// day picked in the sidebar's month or a category narrows both), the period,
// the refresh, and the bookings of every ticked account by day, each row with
// its account's colour and name. The CSV and the bank's Kontoauszüge belong
// to one account: they are on its page (one account ticked).

import { useCallback, useId, useMemo, useState } from 'react';
import { calendarMonths, filterTransactions, periodTotals, type SearchContext } from '@/lib/analytics';
import { isDepot, namesList } from '@/lib/balances';
import { overviewFigures } from '@/lib/account-overview';
import type { DateRange, StatementInfo } from '@/lib/app-types';
import type { SerializedAccount, SerializedTransaction } from '@/lib/fints-types';
import { isoDate } from '@/lib/format';
import { useT } from '@/lib/i18n/react';
import { useFints } from '../FintsProvider';
import { useAcrossAccounts } from '../insights/analysis-model';
import { useRecurringModel, useUpcoming } from '../insights/recurring-model';
import { RefreshIcon } from '../icons';
import { Money } from '../Money';
import { TxDetailHost, openTxDetail } from '../transactions/detail-host';
import { groupByDay, merchantFor, newestFirst, searchText } from '../transactions/model';
import { PeriodControl } from '../transactions/PeriodControl';
import { TxFilterBar } from '../transactions/TxFilterBar';
import { TxList } from '../transactions/TxList';
import { sinceShort } from './AccountsOverview';
import { daySpan } from './MonthFigures';
import { Button, FilterChip, IconButton, Overlay, Sheet, Spinner } from '../ui';
import { PendingPanel } from '../transactions/PendingPanel';
import { hasBookings, useAccountValue, useLayers } from './layers';

export function Ledger() {
  const {
    txByAccount, statementInfo, categoryOf, merchants, noteOf, receiptKeys, brandNames, accountLabel,
    loadTransactions, loadAllBalances, loadingAllBalances, loadingAccount, busy, banks,
    txFilter, setTxFilter, range, applyRange, savedRange, applySavedRange, balanceAt, portfolios, vault, pendingCache,
  } = useFints();
  const [pendingOpen, setPendingOpen] = useState(false);
  const t = useT();
  const words = t.shell.frame;
  const totalWords = t.insights.accounts;
  const titleId = useId();
  const listId = useId();
  const { layers, shown } = useLayers();
  const valueOf = useAccountValue();

  // ---- the sum of what is ticked ------------------------------------------
  const absent = banks.filter((b) => b.state === 'remembered').map((b) => b.bank.name);
  const figures = overviewFigures(shown, valueOf, absent.length);
  const hidden = layers.filter((l) => !l.shown).map((l) => accountLabel(l.account));
  const missing = namesList(figures.missing.map(accountLabel));
  // What the total leaves out, named under it as the overview of every account does.
  const excluded = namesList(figures.excluded.map(({ account, reason, currency }) => (
    reason === 'currency' ? `${accountLabel(account)} (${currency})` : accountLabel(account)
  )));
  // "Stand": as fresh as the oldest figure the total is made of, a kept one's included.
  const kept = vault?.keepBalances === false ? undefined : vault?.keptBalances;
  const readTimes = figures.counted.map((a) => {
    const v = valueOf(a);
    if (v.state === 'known' && v.kept) return Date.parse(kept?.[a.accountNumber]?.readAt ?? '');
    if (isDepot(a)) return portfolios[a.accountNumber] ? Date.parse(portfolios[a.accountNumber].readAt) : NaN;
    return balanceAt[a.accountNumber] ?? NaN;
  }).filter(Number.isFinite);
  const stand = figures.total != null && readTimes.length ? t.transactions.pending.asOf(sinceShort(Math.min(...readTimes))) : null;

  // ---- the bookings, through the account page's filter --------------------
  const layerOf = useMemo(() => {
    const map = new Map<SerializedTransaction, { name: string; color: string; account: SerializedAccount }>();
    for (const l of layers) {
      if (!l.shown) continue;
      const mark = { name: accountLabel(l.account), color: l.color, account: l.account };
      for (const tx of txByAccount[l.account.accountNumber] ?? []) map.set(tx, mark);
    }
    return map;
  }, [layers, txByAccount, accountLabel]);
  const searchCtx = useMemo<SearchContext & { categoryOf: typeof categoryOf }>(
    () => ({ categoryOf, shownText: searchText, noteOf }),
    // brandNames: the shown names (Girovo AI's or Nano's) are what the search reads.
    [categoryOf, noteOf, brandNames, t],
  );
  const sorted = useMemo(() => newestFirst([...layerOf.keys()]), [layerOf]);
  const filtered = useMemo(() => filterTransactions(sorted, txFilter, searchCtx), [sorted, txFilter, searchCtx]);
  const facetSource = useMemo(
    () => (txFilter.category ? filterTransactions(sorted, { ...txFilter, category: null }, searchCtx) : filtered),
    [sorted, filtered, txFilter, searchCtx],
  );
  const monthSource = useMemo(
    () => (txFilter.from || txFilter.to ? filterTransactions(sorted, { ...txFilter, from: '', to: '' }, searchCtx) : filtered),
    [sorted, filtered, txFilter, searchCtx],
  );
  const groups = useMemo(() => groupByDay(filtered), [filtered, t]);
  const withBookings = shown.filter(hasBookings);
  // The ticked accounts' Vorgemerkte: in their own panels, as on an account's
  // page (merged in they would count in the sums, and twice once booked) —
  // one per account that can ask for them or was sent some with its Umsätze.
  const withPending = shown.filter((a) => a.canPending || !!pendingCache[a.accountNumber]);
  const pendingCount = withPending.reduce((n, a) => n + (pendingCache[a.accountNumber]?.length ?? 0), 0);
  const notLoaded = withBookings.filter((a) => !txByAccount[a.accountNumber]);
  // The span the ticked accounts' lists cover between them, for the period chip and the months.
  const loaded = useMemo<StatementInfo | undefined>(() => {
    const infos = withBookings.map((a) => statementInfo[a.accountNumber]).filter(Boolean) as StatementInfo[];
    if (!infos.length) return undefined;
    const from = infos.reduce((m, i) => (i.from < m ? i.from : m), infos[0].from);
    const to = infos.reduce((m, i) => (i.to > m ? i.to : m), infos[0].to);
    return { ...infos[0], from, to, saved: undefined };
  }, [withBookings, statementInfo]);
  const months = useMemo(() => (loaded ? calendarMonths(loaded.from, loaded.to) : []), [loaded, t]);
  const loading = withBookings.some((a) => loadingAccount === a.accountNumber);

  // ---- the month's figures, over every ticked account -----------------------
  const today = new Date();
  const todayKey = isoDate(today);
  const monthStart = isoDate(new Date(today.getFullYear(), today.getMonth(), 1));
  // Only once every ticked account's Umsätze are here (never a partial
  // figure), over the days of the month all of them cover, said in the label
  // ("1.–24. November") as the account page's line says it. A credit card's
  // bill and its credit on the card are left out, as the Analyse leaves them
  // out across accounts: the card's purchases count already.
  const across = useAcrossAccounts();
  const month = useMemo(() => {
    if (!withBookings.length || withBookings.some((a) => !txByAccount[a.accountNumber] || !statementInfo[a.accountNumber])) return null;
    let from = monthStart;
    let to = todayKey;
    for (const a of withBookings) {
      const info = statementInfo[a.accountNumber]!;
      if (info.from > from) from = info.from;
      if (info.to < to) to = info.to;
    }
    if (from > to) return null;
    const leftOut = new Set(across(withBookings, txByAccount).left);
    let income = 0;
    let expense = 0;
    let count = 0;
    for (const a of withBookings) {
      const own = txByAccount[a.accountNumber]!;
      const p = periodTotals(leftOut.size ? own.filter((tx) => !leftOut.has(tx)) : own, { categoryOf, from, to, currency: 'EUR' });
      income += p.income;
      expense += p.expense;
      count += p.count;
    }
    return count ? { income, expense, span: daySpan(from, to) } : null;
  }, [withBookings, txByAccount, statementInfo, categoryOf, monthStart, todayKey, across]);
  const model = useRecurringModel();
  const upcoming = useUpcoming(model, 30);
  const due = useMemo(() => {
    const own = new Set(shown.map((a) => a.accountNumber));
    let cents = 0;
    for (const { series: s } of upcoming) {
      if (own.has(model.accountOf(s) ?? '') && s.currency === 'EUR' && s.amount < 0) cents += Math.round(s.amount * 100);
    }
    return cents / 100;
  }, [upcoming, model, shown]);

  const merchantOf = useCallback((tx: SerializedTransaction) => merchantFor(merchants, tx), [merchants]);
  // The drawer follows the booking's own account: its Beleg, receipts and transfers.
  const onOpen = useCallback((tx: SerializedTransaction) => openTxDetail(tx, false, layerOf.get(tx)?.account), [layerOf]);
  // One after the other; a refused approval stops the rest, as "Alle Salden abrufen" does.
  const loadEach = (list: typeof withBookings, force = false) => {
    const step = (i: number) => {
      if (i >= list.length) return;
      void loadTransactions(list[i], undefined, undefined, {
        force,
        onSettled: (o) => { if (o !== 'cancelled' && o !== 'busy') step(i + 1); },
      });
    };
    step(0);
  };
  // A period picked here is every ticked account's, not only the active one's.
  const applyLedgerRange = useCallback((r: DateRange) => applyRange(r, withBookings), [applyRange, withBookings]);
  const applyLedgerSaved = useCallback(() => applySavedRange(withBookings), [applySavedRange, withBookings]);

  if (shown.length === 0) {
    return <p className="px-7 py-10 text-[16px] leading-6 text-ink-2">{words.noneShown}</p>;
  }

  return (
    <section aria-labelledby={titleId} className="pb-10">
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4 px-7 pt-6">
        <div className="min-w-0">
          {figures.total != null ? (
            <>
              <h2 id={titleId} className="text-[14px] leading-5 font-medium text-ink-2">
                {totalWords.total}
                {hidden.length > 0 && ` · ${words.shownCount(shown.length, layers.length)}`}
              </h2>
              <p data-balance className="mt-0.5 text-[36px] leading-[44px] font-medium tracking-[-0.025em]">
                <Money value={figures.total / 100} currency="EUR" tone="plain" split centsClassName="text-[0.58em]" />
              </p>
              {stand && <p className="tnum text-[14px] leading-5 text-ink-2">{stand}</p>}
              {excluded && <p className="text-[14px] leading-5 text-ink-2" title={totalWords.excludedHint}>{t.insights.without(excluded)}</p>}
            </>
          ) : (
            // No partial sum: the heading says what is missing, and the one way to complete it.
            <>
              <h2 id={titleId} className="text-[22px] leading-7 font-medium">{words.totalPending}</h2>
              {missing && <p className="mt-0.5 text-[14px] leading-5 text-ink-2">{totalWords.notYet(missing)}</p>}
              {/* A further bank not logged in keeps the total open: named, since no read here completes it. */}
              {absent.length > 0 && <p className="text-[14px] leading-5 text-ink-2">{t.banks.notLoggedIn(namesList(absent))}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <Button size="sm" variant="secondary" onClick={() => loadAllBalances()} disabled={busy || loadingAllBalances}>
                  {totalWords.loadAll}
                </Button>
                <span className="text-[14px] leading-5 text-ink-2">{t.common.mayNeedApproval}</span>
              </div>
            </>
          )}
          {hidden.length > 0 && <p className="text-[14px] leading-5 text-ink-2">{words.hidden(namesList(hidden))}</p>}
          {/* The balances complete, Umsätze still to read: a quiet line, never a second prompt beside the first. */}
          {figures.total != null && notLoaded.length > 0 && (
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[14px] leading-5 text-ink-2">
              <span>{words.notLoaded(namesList(notLoaded.map(accountLabel)))}</span>
              <Button size="sm" variant="tertiary" className="-my-1" onClick={() => void loadEach(notLoaded)} disabled={busy}>{words.load}</Button>
            </p>
          )}
        </div>
        {(month || due !== 0) && (
          <dl className="flex flex-wrap gap-x-10 gap-y-3">
            {month && (
              <>
                <Figure label={t.insights.monthFigures.income(month.span)}>
                  <Money value={month.income} currency="EUR" signed tone="credit" />
                </Figure>
                <Figure label={t.insights.monthFigures.spending(month.span)}>
                  <Money value={-month.expense} currency="EUR" signed tone="plain" />
                </Figure>
              </>
            )}
            {due !== 0 && (
              <Figure label={t.insights.monthFigures.due}>
                <Money value={due} currency="EUR" signed tone="plain" />
              </Figure>
            )}
          </dl>
        )}
      </div>

      <div className="px-7 pt-5 pb-1">
        <TxFilterBar
          filter={txFilter}
          setFilter={setTxFilter}
          facetSource={facetSource}
          monthSource={monthSource}
          months={months}
          loaded={loaded}
          categoryOf={categoryOf}
          leading={withPending.length > 0 ? (
            <FilterChip
              menu
              aria-haspopup="dialog"
              icon={<span aria-hidden className="mx-1 size-2 rounded-full bg-amber" />}
              onClick={() => setPendingOpen(true)}
            >
              {t.common.booking.pending}
              {pendingCount > 0 ? <span className="tnum"> {pendingCount}</span> : null}
            </FilterChip>
          ) : undefined}
          trailing={(
            <>
              <PeriodControl
                chip
                loaded={loaded}
                applyRange={applyLedgerRange}
                busy={busy}
                savedRange={savedRange}
                applySavedRange={applyLedgerSaved}
              />
              <IconButton
                size="md"
                aria-label={`${t.transactions.list.refresh} ${t.common.mayNeedApproval}`}
                disabled={busy}
                onClick={() => void loadEach(withBookings, true)}
              >
                {loading ? <Spinner size={16} /> : <RefreshIcon size={18} />}
              </IconButton>
            </>
          )}
        />
      </div>

      <div className="px-7">
        <div className="panel">
          <TxList
            id={listId}
            groups={groups}
            total={filtered.length}
            resetKey={`${shown.map((a) => a.accountNumber).join(',')}|${range.from}|${range.to}|${txFilter.dir}|${txFilter.category ?? ''}|${txFilter.from ?? ''}|${txFilter.to ?? ''}|${txFilter.query}|${sorted.length}`}
            merchantOf={merchantOf}
            categoryOf={categoryOf}
            noteOf={noteOf}
            receiptKeys={receiptKeys}
            brandNames={brandNames}
            onOpen={onOpen}
            layerOf={(tx) => layerOf.get(tx) ?? null}
          />
        </div>
      </div>
      <TxDetailHost />
      <Overlay open={pendingOpen} onClose={() => setPendingOpen(false)} label={t.common.booking.pending} align="bottom">
        <Sheet onClose={() => setPendingOpen(false)}>
          <div className="flex flex-col gap-4">
            {withPending.map((a) => <PendingPanel key={a.accountNumber} account={a} named={withPending.length > 1} />)}
          </div>
        </Sheet>
      </Overlay>
    </section>
  );
}

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[14px] leading-5 text-ink-2">{label}</dt>
      <dd className="mt-0.5 text-[16px] leading-6 font-medium text-ink">{children}</dd>
    </div>
  );
}
