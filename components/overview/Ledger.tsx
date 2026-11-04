'use client';

// The Übersicht of the desktop's frame with more than one account ticked
// ("Konten als Ebenen", components/overview/layers.ts): one ledger of the
// ticked accounts. At its head the Gesamtsaldo of what is ticked — never a
// partial sum: until every figure is known it says so and offers "Alle Salden
// abrufen", as the overview of every account does — with what is left out,
// and the month's Eingänge, Ausgänge and what is due. Then the chips and the
// bookings of every ticked account by day, each row with its account's
// colour and name. A ticked account whose Umsätze this session has not read
// is named, with the way to read them (each read may ask for a Freigabe).

import { useCallback, useId, useMemo, useState } from 'react';
import { periodTotals } from '@/lib/analytics';
import { namesList } from '@/lib/balances';
import { overviewFigures } from '@/lib/account-overview';
import type { SerializedTransaction } from '@/lib/fints-types';
import { dayKey, isoDate } from '@/lib/format';
import { intlLocale } from '@/lib/i18n';
import { useT } from '@/lib/i18n/react';
import { useFints } from '../FintsProvider';
import { useRecurringModel, useUpcoming } from '../insights/recurring-model';
import { Icon } from '../icons';
import { Money } from '../Money';
import { TxDetailHost, openTxDetail } from '../transactions/detail-host';
import { groupByDay, merchantFor, newestFirst } from '../transactions/model';
import { TxList } from '../transactions/TxList';
import { Button, FilterChip } from '../ui';
import { hasBookings, useAccountValue, useLayers } from './layers';

type Dir = 'all' | 'in' | 'out';

export function Ledger({ pickedDay, onClearDay }: { pickedDay: string | null; onClearDay: () => void }) {
  const {
    txByAccount, categoryOf, merchants, noteOf, receiptKeys, brandNames, accountLabel,
    loadTransactions, loadAllBalances, loadingAllBalances, busy, banks,
  } = useFints();
  const t = useT();
  const words = t.shell.frame;
  const totalWords = t.insights.accounts;
  const titleId = useId();
  const listId = useId();
  const { layers, shown } = useLayers();
  const valueOf = useAccountValue();
  const [dir, setDir] = useState<Dir>('all');

  // ---- the sum of what is ticked ------------------------------------------
  const absent = banks.filter((b) => b.state === 'remembered').length;
  const figures = overviewFigures(shown, valueOf, absent);
  const hidden = layers.filter((l) => !l.shown).map((l) => accountLabel(l.account));
  const missing = namesList(figures.missing.map(accountLabel));

  // ---- the bookings ---------------------------------------------------------
  const layerOf = useMemo(() => {
    const map = new Map<SerializedTransaction, { name: string; color: string }>();
    for (const l of layers) {
      if (!l.shown) continue;
      const mark = { name: accountLabel(l.account), color: l.color };
      for (const tx of txByAccount[l.account.accountNumber] ?? []) map.set(tx, mark);
    }
    return map;
  }, [layers, txByAccount, accountLabel]);
  const all = useMemo(() => newestFirst([...layerOf.keys()]), [layerOf]);
  const filtered = useMemo(() => all.filter((tx) => (
    (dir === 'in' ? tx.amount > 0 : dir === 'out' ? tx.amount < 0 : true)
    && (!pickedDay || dayKey(tx.entryDate || tx.valueDate) === pickedDay)
  )), [all, dir, pickedDay]);
  const groups = useMemo(() => groupByDay(filtered), [filtered, t]);
  const notLoaded = shown.filter((a) => hasBookings(a) && !txByAccount[a.accountNumber]);

  // ---- the month's figures, over every ticked account -----------------------
  const today = new Date();
  const todayKey = isoDate(today);
  const monthStart = isoDate(new Date(today.getFullYear(), today.getMonth(), 1));
  const month = useMemo(() => {
    let income = 0;
    let expense = 0;
    let count = 0;
    for (const a of shown) {
      const txs = txByAccount[a.accountNumber];
      if (!txs) continue;
      const p = periodTotals(txs, { categoryOf, from: monthStart, to: todayKey, currency: 'EUR' });
      income += p.income;
      expense += p.expense;
      count += p.count;
    }
    return count ? { income, expense } : null;
  }, [shown, txByAccount, categoryOf, monthStart, todayKey]);
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
  const monthName = new Intl.DateTimeFormat(intlLocale(), { month: 'long' }).format(today);

  const merchantOf = useCallback((tx: SerializedTransaction) => merchantFor(merchants, tx), [merchants]);
  const onOpen = useCallback((tx: SerializedTransaction) => openTxDetail(tx, false), []);
  const loadMissing = async () => {
    for (const a of notLoaded) await loadTransactions(a);
  };

  if (shown.length === 0) {
    return <p className="px-7 py-10 text-[16px] leading-6 text-ink-2">{words.noneShown}</p>;
  }

  return (
    <section aria-labelledby={titleId} className="pb-10">
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4 px-7 pt-6">
        <div className="min-w-0">
          <h2 id={titleId} className="text-[14px] leading-5 font-medium text-ink-2">
            {totalWords.total}
            {hidden.length > 0 && ` · ${words.shownCount(shown.length, layers.length)}`}
          </h2>
          {figures.total != null ? (
            <p data-balance className="mt-0.5 text-[36px] leading-[44px] font-medium tracking-[-0.025em]">
              <Money value={figures.total / 100} currency="EUR" tone="plain" split centsClassName="text-[0.58em]" />
            </p>
          ) : (
            <>
              <p className="mt-0.5 text-[22px] leading-7 font-medium">{totalWords.pending}</p>
              {missing && <p className="text-[14px] leading-5 text-ink-2">{totalWords.notYet(missing)}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <Button size="sm" variant="secondary" onClick={() => loadAllBalances()} disabled={busy || loadingAllBalances}>
                  {totalWords.loadAll}
                </Button>
                <span className="text-[14px] leading-5 text-ink-2">{t.common.mayNeedApproval}</span>
              </div>
            </>
          )}
          {hidden.length > 0 && <p className="text-[14px] leading-5 text-ink-2">{words.hidden(namesList(hidden))}</p>}
        </div>
        {(month || due !== 0) && (
          <dl className="flex flex-wrap gap-x-10 gap-y-3">
            {month && (
              <>
                <Figure label={t.insights.monthFigures.income(monthName)}>
                  <Money value={month.income} currency="EUR" signed tone="credit" />
                </Figure>
                <Figure label={t.insights.monthFigures.spending(monthName)}>
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

      <div className="flex flex-wrap items-center gap-2 px-7 pt-5 pb-2">
        <FilterChip selected={dir === 'in'} onClick={() => setDir(dir === 'in' ? 'all' : 'in')}>{t.common.booking.incoming}</FilterChip>
        <FilterChip selected={dir === 'out'} onClick={() => setDir(dir === 'out' ? 'all' : 'out')}>{t.common.booking.outgoing}</FilterChip>
        {pickedDay && (
          <FilterChip selected onClick={onClearDay} aria-label={words.clearDay}>
            {words.day(new Intl.DateTimeFormat(intlLocale(), { day: 'numeric', month: 'long' }).format(new Date(`${pickedDay}T12:00:00`)))}
            <Icon ms="close" size={18}>{null}</Icon>
          </FilterChip>
        )}
      </div>

      {notLoaded.length > 0 && (
        <div className="mx-7 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[12px] bg-[var(--md-surface-container)] px-4 py-3">
          <span className="min-w-0 flex-1 text-[14px] leading-5 text-ink">{words.notLoaded(namesList(notLoaded.map(accountLabel)))}</span>
          <Button size="sm" variant="tertiary" onClick={() => void loadMissing()} disabled={busy}>{words.load}</Button>
          <span className="text-[14px] leading-5 text-ink-2">{t.common.mayNeedApproval}</span>
        </div>
      )}

      <div className="px-7">
      <div className="panel">
      <TxList
        id={listId}
        groups={groups}
        total={filtered.length}
        resetKey={`${shown.map((a) => a.accountNumber).join(',')}|${dir}|${pickedDay ?? ''}|${all.length}`}
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
