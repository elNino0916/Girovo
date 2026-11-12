'use client';

// Girovo AI's answers from the app's own figures (lib/ask-facts.ts): the
// balances, the month-end forecast, Verträge & Abos (a contract's year, the
// price rises, the next salary), Aufteilen and Sparziele. A few template
// sentences (lib/i18n/messages/ask.ts facts) over the same figures the pages
// show, every amount drawn by <Money> or <RoundMoney> so "Beträge ausblenden"
// hides it, and a button to the place in the app it comes from.
//
// Routed from components/insights/AskThread.tsx IntentAnswer.

import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { liveValue, overviewFigures, type AccountValue } from '@/lib/account-overview';
import { bookingDay } from '@/lib/analytics';
import {
  contractsNamed, contractsYearCount, forecastAccount, goalsNamed, lastFrom, nameCase, nextSalary, priceRises, salaryWhen, type FactIntent,
} from '@/lib/ask-facts';
import { namesList } from '@/lib/balances';
import { counterpartyName } from '@/lib/categories';
import type { SerializedAccount } from '@/lib/fints-types';
import { dayKey, fmtMonth } from '@/lib/format';
import { intlLocale } from '@/lib/i18n/locale';
import { useT } from '@/lib/i18n/react';
import { forecastAllowed, goalsAllowed } from '@/lib/plus';
import { seriesTitle } from '@/lib/recurring';
import { goalProgress } from '@/lib/savings-goal';
import { useFints } from '../../FintsProvider';
import { Money } from '../../Money';
import { PLACE_ROOT_EVENT, wantContracts } from '../../shell/frame';
import { txText } from '../../transactions/model';
import { Button } from '../../ui';
import { useMonthEndForecast } from '../Forecast';
import { useRecurringModel } from '../recurring-model';
import { RoundMoney, useShowInList } from '../shared';

const TEXT = 'text-[16px] leading-6 text-ink sm:text-[14px] sm:leading-[22px] [text-wrap:pretty]';

type Line = ReactNode[] | string | null | false;

/** Sentences in one paragraph, each a template's parts. */
function Lines({ lines }: { lines: Line[] }) {
  const shown = lines.filter((l): l is ReactNode[] | string => !!l);
  return (
    <p className={TEXT}>
      {shown.map((parts, i) => (
        <Fragment key={i}>
          {i > 0 && ' '}
          {typeof parts === 'string' ? parts : parts.map((p, j) => <Fragment key={j}>{p}</Fragment>)}
        </Fragment>
      ))}
    </p>
  );
}

/** A figure inside a sentence. */
function Fig({ children }: { children: ReactNode }) {
  return <span className="tnum font-medium whitespace-nowrap">{children}</span>;
}

/** The way from an answer to its place in the app. */
function OpenButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <Button variant="secondary" size="sm" className="mt-3" onClick={onClick}>{label}</Button>;
}

/** A day in a sentence: "5. Oktober", with the year only when it is not this one. */
function dayWords(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  const thisYear = d.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat(intlLocale(), { day: 'numeric', month: 'long', ...(thisYear ? {} : { year: 'numeric' }) }).format(d);
}

/** Zahlungen with Verträge & Abos in view, as a contract notice opens it. */
function useOpenContracts(onShown: () => void) {
  const { setTab } = useFints();
  return () => {
    setTab('contracts');
    wantContracts();
    onShown();
  };
}

/** The rows under an answer: a name, a line under it, an amount. */
function Rows({ rows }: { rows: { key: string; name: string; sub?: string; amount: ReactNode }[] }) {
  return (
    <ul className="mt-3 -mx-2 flex flex-col rounded-[12px] bg-[color-mix(in_srgb,var(--paper)_72%,transparent)] py-1">
      {rows.map((r) => (
        <li key={r.key} className="flex min-h-11 items-center gap-3 px-3">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-medium text-ink">{r.name}</span>
            {r.sub && <span className="block text-[12px] leading-4 text-ink-2">{r.sub}</span>}
          </span>
          <span className="shrink-0 text-[14px] font-medium">{r.amount}</span>
        </li>
      ))}
    </ul>
  );
}

export function FactAnswer({ intent, onShown }: { intent: FactIntent; onShown: () => void }) {
  switch (intent.kind) {
    case 'balance': return <BalanceAnswer onShown={onShown} />;
    case 'monthEnd': return <MonthEndAnswer onShown={onShown} />;
    case 'contractCost': return <ContractCostAnswer name={intent.name} onShown={onShown} />;
    case 'priceRises': return <PriceRisesAnswer onShown={onShown} />;
    case 'salary': return <SalaryAnswer onShown={onShown} />;
    case 'owed': return <OwedAnswer name={intent.name} onShown={onShown} />;
    case 'goal': return <GoalAnswer name={intent.name} onShown={onShown} />;
  }
}

/** "Wie viel Geld habe ich?": the Gesamtsaldo as the Übersicht counts it, and each account's balance. */
function BalanceAnswer({ onShown }: { onShown: () => void }) {
  const words = useT().ask.facts;
  const { accounts, balances, portfolios, banks, vault, accountLabel, setTab, closeAccount } = useFints();
  if (!accounts.length) return <Lines lines={[words.noAccounts]} />;
  // As the Übersicht: this session's figure, else the one kept from an earlier session.
  const kept = vault?.keepBalances === false ? undefined : vault?.keptBalances;
  const valueOf = (a: SerializedAccount): AccountValue => {
    const live = liveValue(a, balances[a.accountNumber], portfolios[a.accountNumber]);
    const k = kept?.[a.accountNumber];
    if (live.state === 'known' || live.state === 'never' || !k) return live;
    return { state: 'known', cents: k.cents, currency: k.currency, kept: true };
  };
  const absent = banks.filter((b) => b.state === 'remembered').length;
  const figures = overviewFigures(accounts, valueOf, absent);
  const known = figures.counted.flatMap((a) => {
    const v = valueOf(a);
    return v.state === 'known' ? [{ a, cents: v.cents, kept: !!v.kept }] : [];
  });
  const money = (cents: number) => <Fig><Money value={cents / 100} currency="EUR" /></Fig>;
  const lines: Line[] = [
    figures.total == null ? words.balanceOpen
      : figures.counted.length === 1 ? words.balanceOne(accountLabel(figures.counted[0]), money(figures.total))
        : words.balanceTotal(money(figures.total), figures.counted.length),
    figures.excluded.length > 0 && words.balanceWithout(namesList(figures.excluded.map((e) => accountLabel(e.account)))),
    known.some((k) => k.kept) && words.balanceKept,
  ];
  return (
    <>
      <Lines lines={lines} />
      {(known.length > 1 || figures.total == null) && known.length > 0 && (
        <Rows rows={known.slice(0, 8).map((k) => ({ key: k.a.accountNumber, name: accountLabel(k.a), amount: <Money value={k.cents / 100} currency="EUR" /> }))} />
      )}
      <OpenButton
        label={words.openAccounts}
        onClick={() => {
          setTab('overview');
          closeAccount();
          onShown();
        }}
      />
    </>
  );
}

/** "Reicht es bis Monatsende?": the Zahlungen forecast of the open Girokonto (or the first). */
function MonthEndAnswer({ onShown }: { onShown: () => void }) {
  const words = useT().ask.facts;
  const { accounts, activeAccount, accountLabel, plus, setTab } = useFints();
  const account = forecastAccount(accounts, activeAccount);
  const result = useMonthEndForecast(account);
  if (!forecastAllowed(plus.state)) return <Lines lines={[words.forecastPlus]} />;
  if (!account) return <Lines lines={[words.noGiro]} />;
  if (result === 'stale') return <Lines lines={[words.staleForecast]} />;
  if (!result) return <Lines lines={[words.noForecast]} />;
  const { f, currency } = result;
  const month = new Intl.DateTimeFormat(intlLocale(), { month: 'long' }).format(new Date(`${f.until}T12:00:00`));
  const lines: Line[] = [
    words.monthEnd(month, <Fig><RoundMoney value={f.end} currency={currency} /></Fig>, accounts.length > 1 ? accountLabel(account) : null),
    // Below zero on a day, back in the plus by the month's end: said as a dip, not as "it won't last".
    f.breach ? (f.breach.line === 'limit' ? words.monthEndLimit : f.end >= 0 ? words.monthEndDip : words.monthEndZero)(dayWords(f.breach.date)) : f.end >= 0 && words.monthEndFine,
  ];
  return (
    <>
      <Lines lines={lines} />
      <OpenButton
        label={words.openForecast}
        onClick={() => {
          setTab('contracts');
          // The desktop's Zahlungen back at its first level, where the forecast stands.
          window.dispatchEvent(new CustomEvent(PLACE_ROOT_EVENT, { detail: 'contracts' }));
          onShown();
        }}
      />
    </>
  );
}

/** "Was kostet mich Netflix im Jahr?": one contract's year from Verträge & Abos, or all of them. */
function ContractCostAnswer({ name, onShown }: { name: string | null; onShown: () => void }) {
  const t = useT();
  const words = t.ask.facts;
  const model = useRecurringModel();
  const openContracts = useOpenContracts(onShown);
  if (model.loading) return <Lines lines={[t.ask.thread.notLoaded]} />;
  const button = <OpenButton label={t.ask.actions.openContracts} onClick={openContracts} />;
  if (!name) {
    const { yearlyExpense, currency } = model.totals;
    // The count of what the total adds up: a contract in another currency is in neither.
    const counted = contractsYearCount(model.expense, currency);
    if (!counted) return <Lines lines={[t.ask.actions.noContracts]} />;
    return (
      <>
        <Lines lines={[words.contractsYear(<Fig><Money value={yearlyExpense} currency={currency} tone="plain" /></Fig>, counted)]} />
        {button}
      </>
    );
  }
  const found = contractsNamed(model.expense, name);
  if (!found.length) return <Lines lines={[words.contractNone(nameCase(name))]} />;
  const [s, ...more] = found;
  const money = (v: number) => <Fig><Money value={Math.abs(v)} currency={s.currency} tone="plain" /></Fig>;
  const rose = s.priceChange && s.priceChange.delta > 0 ? s.priceChange : null;
  const lines: Line[] = [
    words.contractYear(seriesTitle(s), money(s.yearlyAmount), money(s.monthlyAmount)),
    rose && words.contractRose(fmtMonth(rose.since), money(rose.delta)),
    more.length > 0 && words.contractMore(namesList(more.slice(0, 3).map(seriesTitle))),
  ];
  return (
    <>
      <Lines lines={lines} />
      {button}
    </>
  );
}

/** "Welche Abos sind teurer geworden?": the price rises Verträge & Abos keep for a year. */
function PriceRisesAnswer({ onShown }: { onShown: () => void }) {
  const t = useT();
  const words = t.ask.facts;
  const model = useRecurringModel();
  const openContracts = useOpenContracts(onShown);
  if (model.loading) return <Lines lines={[t.ask.thread.notLoaded]} />;
  const rises = priceRises(model.expense, dayKey(new Date()));
  if (!rises.length) return <Lines lines={[words.risesNone]} />;
  const money = (v: number, currency: string) => <Fig><Money value={v} currency={currency} tone="plain" /></Fig>;
  const first = rises[0];
  const p = first.priceChange!;
  // A sum only in one currency, the one Verträge & Abos add up in.
  const currency = model.totals.currency;
  const perYear = rises.filter((s) => s.currency === currency).reduce((sum, s) => sum + Math.round(s.priceChange!.perYear * 100), 0) / 100;
  const line = rises.length === 1
    ? words.riseOne(seriesTitle(first), fmtMonth(p.since), money(p.delta, first.currency), money(p.perYear, first.currency))
    : words.risesMany(rises.length, money(perYear, currency));
  return (
    <>
      <Lines lines={[line]} />
      {rises.length > 1 && (
        <Rows
          rows={rises.slice(0, 8).map((s) => ({
            key: s.id,
            name: seriesTitle(s),
            sub: words.riseSince(fmtMonth(s.priceChange!.since)),
            amount: <Money value={s.priceChange!.delta} currency={s.currency} signed tone="plain" />,
          }))}
        />
      )}
      <OpenButton label={t.ask.actions.openContracts} onClick={openContracts} />
    </>
  );
}

/** "Wann kommt das Gehalt?": the next booking of the regular salary Verträge & Abos found. */
function SalaryAnswer({ onShown }: { onShown: () => void }) {
  const t = useT();
  const words = t.ask.facts;
  const model = useRecurringModel();
  const openContracts = useOpenContracts(onShown);
  if (model.loading) return <Lines lines={[t.ask.thread.notLoaded]} />;
  const s = nextSalary(model.income);
  if (!s) return <Lines lines={[words.noSalary]} />;
  const today = dayKey(new Date());
  const when = salaryWhen(s, today);
  const line = when === 'late'
    ? words.salaryLate(seriesTitle(s), dayWords(s.nextDate))
    : when === 'due'
    ? words.salaryDue(seriesTitle(s), dayWords(s.nextDate))
    : words.salaryNext(
      seriesTitle(s),
      when === 'today' ? null : dayWords(s.nextDate),
      <Fig><Money value={Math.abs(s.amount)} currency={s.currency} tone="plain" /></Fig>,
      s.variable,
    );
  return (
    <>
      <Lines lines={[line]} />
      <OpenButton label={t.ask.actions.openContracts} onClick={openContracts} />
    </>
  );
}

/**
 * "Wie viel schuldet mir Lea noch?": Aufteilen keeps no record of its
 * requests, so Girovo says so, and what last came from that person.
 */
function OwedAnswer({ name, onShown }: { name: string | null; onShown: () => void }) {
  const words = useT().ask.facts;
  const { txByAccount, accounts } = useFints();
  const show = useShowInList();
  const who = name ? nameCase(name) : null;
  const last = name
    ? lastFrom(Object.values(txByAccount).flat(), name, (tx) => ({ amount: tx.amount, day: bookingDay(tx), payee: txText(tx).name || counterpartyName(tx) }))
    : null;
  const lines: Line[] = [
    words.owedNoRecord,
    who && (last
      ? words.owedLast(who, <Fig><Money value={last.amount} currency={last.currency || 'EUR'} tone="plain" /></Fig>, dayWords(bookingDay(last)))
      : words.owedNothing(who)),
  ];
  return (
    <>
      <Lines lines={lines} />
      {who && last && (
        <OpenButton
          label={words.owedShow(who)}
          onClick={() => {
            show(last, { dir: 'in', query: who, ...(accounts.length > 1 ? { acrossAccounts: true } : {}) });
            onShown();
          }}
        />
      )}
    </>
  );
}

/** "Wie weit bin ich beim Urlaubsziel?": a Sparziel's progress, the account's balance as the bank gave it. */
function GoalAnswer({ name, onShown }: { name: string | null; onShown: () => void }) {
  const words = useT().ask.facts;
  const { vault, accounts, balances, plus, setTab, selectAccount } = useFints();
  if (!goalsAllowed(plus.state)) return <Lines lines={[words.goalPlus]} />;
  const all = (vault?.goals ?? []).filter((g) => accounts.some((a) => a.accountNumber === g.accountNumber));
  if (!all.length) return <Lines lines={[words.noGoals]} />;
  const { goals, matched } = goalsNamed(all, name);
  const shown = goals.slice(0, 3);
  const money = (cents: number) => <Fig><Money value={cents / 100} currency="EUR" tone="plain" /></Fig>;
  const paragraphs: Line[][] = shown.map((g) => {
    const balance = balances[g.accountNumber];
    if (!balance) return [words.goalNoBalance(g.name)];
    const p = goalProgress(g, Math.round(balance.balance * 100));
    if (p.reached) return [words.goalReached(g.name)];
    const have = Math.max(0, Math.round(g.target) - p.missing);
    return [
      words.goalProgress(g.name, money(have), money(g.target), Math.floor(p.share * 100)),
      words.goalMissing(money(p.missing)),
      !!p.perMonth && !!g.by && words.goalPerMonth(money(p.perMonth), fmtMonth(g.by)),
    ];
  });
  if (!matched && name) paragraphs.unshift([words.goalNotFound(nameCase(name))]);
  const one = shown.length === 1 ? accounts.find((a) => a.accountNumber === shown[0].accountNumber) ?? null : null;
  return (
    <>
      <div className="flex flex-col gap-2">
        {paragraphs.map((lines, i) => <Lines key={i} lines={lines} />)}
      </div>
      <OpenButton
        label={one ? words.openGoal : words.openGoals}
        onClick={() => {
          if (one) {
            setTab('overview');
            selectAccount(one);
          } else setTab('analysis');
          onShown();
        }}
      />
    </>
  );
}
