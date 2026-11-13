'use client';

// Girovo AI's answers from the app's own figures (lib/ask-facts.ts): the
// balances, the month-end forecast, Verträge & Abos (a contract's year, the
// price rises, the next salary, the days to cancel by), Aufteilen and
// Sparziele, the Monatsbudgets this month, and a past day's
// balance rebuilt from today's. A few template
// sentences (lib/i18n/messages/ask.ts facts) over the same figures the pages
// show, every amount drawn by <Money> or <RoundMoney> so "Beträge ausblenden"
// hides it, and a button to the place in the app it comes from.
//
// Routed from components/insights/AskThread.tsx IntentAnswer.

import { Fragment, useMemo } from 'react';
import type { ReactNode } from 'react';
import { liveValue, overviewFigures, type AccountValue } from '@/lib/account-overview';
import { bookingDay } from '@/lib/analytics';
import { budgetsAsked, monthBudgets, perDayLeft, daysLeftInMonth, tightBudgets, usedShare } from '@/lib/ask-budgets';
import { contractsAsked, deadlines } from '@/lib/ask-contracts';
import type { BudgetLine } from '@/lib/budgets';
import { categoryLabel, type BuiltinCategoryId } from '@/lib/categories';
import {
  balanceOn, contractsNamed, contractsYearCount, forecastAccount, goalsNamed, lastFrom, nameCase, nextSalary, priceRises, salaryWhen, type FactIntent,
} from '@/lib/ask-facts';
import { isDepot, namesList } from '@/lib/balances';
import { counterpartyName, txKey } from '@/lib/categories';
import type { SerializedAccount } from '@/lib/fints-types';
import { dayKey, fmtMonth } from '@/lib/format';
import { intlLocale } from '@/lib/i18n/locale';
import { rich, useT } from '@/lib/i18n/react';
import { forecastAllowed, goalsAllowed } from '@/lib/plus';
import { seriesTitle } from '@/lib/recurring';
import { goalProgress } from '@/lib/savings-goal';
import { owedByPerson } from '@/lib/split-requests';
import { useFints } from '../../FintsProvider';
import { Money, usePrivacy } from '../../Money';
import { PLACE_ROOT_EVENT, wantContracts } from '../../shell/frame';
import { txText } from '../../transactions/model';
import { Button } from '../../ui';
import { useScopeData } from '../analysis-model';
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
    case 'balanceAt': return <BalanceAtAnswer day={intent.day} onShown={onShown} />;
    case 'monthEnd': return <MonthEndAnswer onShown={onShown} />;
    case 'contractCost': return <ContractCostAnswer name={intent.name} onShown={onShown} />;
    case 'priceRises': return <PriceRisesAnswer onShown={onShown} />;
    case 'salary': return <SalaryAnswer onShown={onShown} />;
    case 'owed': return <OwedAnswer name={intent.name} onShown={onShown} />;
    case 'goal': return <GoalAnswer name={intent.name} onShown={onShown} />;
    case 'budgetLeft': return <BudgetAnswer category={intent.category} name={intent.name} onShown={onShown} />;
    case 'budgetsOver': return <BudgetsOverAnswer onShown={onShown} />;
    case 'cancelBy': return <CancelByAnswer until={intent.until} onShown={onShown} />;
    case 'renewal': return <RenewalAnswer name={intent.name} onShown={onShown} />;
  }
}

/** The balances as the Übersicht counts them: this session's figure, else the one kept from an earlier session. */
function useOverviewBalances() {
  const { accounts, balances, portfolios, banks, vault } = useFints();
  const kept = vault?.keepBalances === false ? undefined : vault?.keptBalances;
  const valueOf = (a: SerializedAccount): AccountValue => {
    const live = liveValue(a, balances[a.accountNumber], portfolios[a.accountNumber]);
    const k = kept?.[a.accountNumber];
    if (live.state === 'known' || live.state === 'never' || !k) return live;
    return { state: 'known', cents: k.cents, currency: k.currency, kept: true };
  };
  const absent = banks.filter((b) => b.state === 'remembered').length;
  return { figures: overviewFigures(accounts, valueOf, absent), valueOf, kept };
}

/** Back to the Übersicht with every account, where the balances stand. */
function OpenAccountsButton({ onShown }: { onShown: () => void }) {
  const words = useT().ask.facts;
  const { setTab, closeAccount } = useFints();
  return (
    <OpenButton
      label={words.openAccounts}
      onClick={() => {
        setTab('overview');
        closeAccount();
        onShown();
      }}
    />
  );
}

/** "Wie viel Geld habe ich?": the Gesamtsaldo as the Übersicht counts it, and each account's balance. */
function BalanceAnswer({ onShown }: { onShown: () => void }) {
  const words = useT().ask.facts;
  const { accounts, accountLabel } = useFints();
  const { figures, valueOf } = useOverviewBalances();
  if (!accounts.length) return <Lines lines={[words.noAccounts]} />;
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
      <OpenAccountsButton onShown={onShown} />
    </>
  );
}

/**
 * "Kontostand am 1. Oktober", "im August": each account the Übersicht counts
 * as it stood at the end of that day, its balance less the bookings since
 * (lib/ask-facts.ts balanceOn), and the total. A balance not read today
 * stands for the day the bank dates it. Before the loaded Umsätze, Girovo
 * says it cannot see that far back.
 */
function BalanceAtAnswer({ day, onShown }: { day: string; onShown: () => void }) {
  const words = useT().ask.facts;
  const { accounts, balances, balanceAt, txByAccount, statementInfo, accountLabel } = useFints();
  const { figures, kept } = useOverviewBalances();
  if (!accounts.length) return <Lines lines={[words.noAccounts]} />;
  const today = dayKey(new Date());
  const results = figures.counted.map((a) => {
    const acct = a.accountNumber;
    const live = balances[acct];
    const k = kept?.[acct];
    const txs = txByAccount[acct] ?? [];
    const days = txs.map(bookingDay).filter(Boolean).sort();
    const from = statementInfo[acct]?.from ?? days[0] ?? null;
    // A Depot's value then is in no booking.
    if (isDepot(a) || (!live && !k)) return { a, from, r: { state: 'unknown' as const } };
    const readAt = live ? balanceAt[acct] : Date.parse(k!.readAt);
    const asOf = live
      ? (readAt && dayKey(new Date(readAt)) === today ? today : dayKey(live.date))
      : dayKey(new Date(readAt));
    const r = balanceOn({
      cents: live ? Math.round(live.balance * 100) : k!.cents,
      asOf,
      from,
      to: statementInfo[acct]?.to ?? days[days.length - 1] ?? null,
      bookings: txs.map((tx) => ({ day: bookingDay(tx), cents: Math.round(tx.amount * 100) })),
    }, day);
    return { a, from, r };
  });
  const known = results.flatMap((x) => (x.r.state === 'known' ? [{ a: x.a, cents: x.r.cents }] : []));
  const early = results.filter((x) => x.r.state === 'tooEarly');
  if (!known.length) {
    const firsts = early.map((x) => x.from).filter((f): f is string => !!f).sort();
    return <Lines lines={[early.length ? words.balanceAtTooFar(firsts.length ? dayWords(firsts[0]) : null) : words.balanceOpen]} />;
  }
  const total = known.reduce((s, k) => s + k.cents, 0);
  const money = (cents: number) => <Fig><Money value={cents / 100} currency="EUR" /></Fig>;
  const left = [...results.filter((x) => x.r.state !== 'known').map((x) => x.a), ...figures.excluded.map((e) => e.account)];
  const lines: Line[] = [
    known.length === 1 ? words.balanceAtOne(accountLabel(known[0].a), dayWords(day), money(total)) : words.balanceAtTotal(dayWords(day), money(total), known.length),
    left.length > 0 && words.balanceWithout(namesList(left.map((a) => accountLabel(a)))),
    early.length > 0 && words.balanceAtSome,
  ];
  return (
    <>
      <Lines lines={lines} />
      {known.length > 1 && (
        <Rows rows={known.slice(0, 8).map((k) => ({ key: k.a.accountNumber, name: accountLabel(k.a), amount: <Money value={k.cents / 100} currency="EUR" /> }))} />
      )}
      <OpenAccountsButton onShown={onShown} />
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
 * "Wie viel schuldet mir Lea noch?": what Aufteilen asked for and is still
 * open (lib/split-requests.ts, settled by the bookings), per person or for
 * the one asked about, and what was paid back. With nothing asked of that
 * person, what last came from them.
 */
function OwedAnswer({ name, onShown }: { name: string | null; onShown: () => void }) {
  const words = useT().ask.facts;
  const { txByAccount, accounts, vault } = useFints();
  const show = useShowInList();
  const who = name ? nameCase(name) : null;
  const all = Object.values(txByAccount).flat();
  const requests = vault?.splitRequests ?? [];
  const people = owedByPerson(requests, name);
  const money = (cents: number) => <Fig><Money value={cents / 100} currency="EUR" tone="plain" /></Fig>;
  const openCents = people.reduce((s, p) => s + p.openCents, 0);
  const paidCents = people.reduce((s, p) => s + p.paidCents, 0);
  const last = name && !people.length
    ? lastFrom(all, name, (tx) => ({ amount: tx.amount, day: bookingDay(tx), payee: txText(tx).name || counterpartyName(tx) }))
    : null;
  // A request's row: the booking it came from, as its row names it, where that booking is loaded.
  const titles = new Map<string, string>();
  const titleOf = (key: string) => {
    if (!titles.size) for (const tx of all) if (tx.amount < 0) titles.set(txKey(tx), txText(tx).name || counterpartyName(tx));
    return titles.get(key) || words.owedRequest;
  };
  const shown = name && people.length === 1 ? people[0].name : who;
  const lines: Line[] = !people.length
    ? [
      requests.length ? who && words.owedNoneFor(who) : words.owedNoRequests,
      who && (last
        ? words.owedLast(who, <Fig><Money value={last.amount} currency={last.currency || 'EUR'} tone="plain" /></Fig>, dayWords(bookingDay(last)))
        : words.owedNothing(who)),
    ]
    : shown
    ? [openCents ? words.owedOpenOne(shown, money(openCents)) : words.owedAllPaid(shown), !!openCents && !!paidCents && words.owedPaidOne(shown, money(paidCents))]
    : [
      openCents ? words.owedOpenAll(money(openCents), people.filter((p) => p.openCents).length) : words.owedNobody,
      !!paidCents && words.owedPaidAll(money(paidCents)),
    ];
  const rows = shown
    ? people.flatMap((p) => p.open).slice(0, 8).map((r, i) => ({
      key: `${r.tx}|${i}`, name: titleOf(r.tx), sub: words.owedSince(dayWords(r.on)), amount: <Money value={r.cents / 100} currency="EUR" tone="plain" />,
    }))
    : people.filter((p) => p.openCents).slice(0, 8).map((p) => ({
      key: p.name, name: p.name, sub: words.owedOpenCount(p.open.length), amount: <Money value={p.openCents / 100} currency="EUR" tone="plain" />,
    }));
  return (
    <>
      <Lines lines={lines} />
      {rows.length > 0 && <Rows rows={rows} />}
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

/**
 * This month against the Monatsbudgets: every loaded account, as Girovo AI
 * counts (and its notes), each category's spending exactly as the Analyse's
 * budget tile adds it up (lib/ask-budgets.ts monthBudgets).
 */
function useBudgetMonth() {
  const { vault, categoryOf, activeAccount, accounts, transactions, txByAccount, statementInfo } = useFints();
  const data = useScopeData({ scope: 'all', activeAccount, accounts, transactions, txByAccount, statementInfo });
  const budgets = vault?.budgets;
  const today = dayKey(new Date());
  const m = useMemo(
    () => monthBudgets(budgets ?? {}, data?.txs ?? [], { categoryOf, currency: data?.currency ?? 'EUR', from: data?.from ?? '', to: data?.to ?? '', today }),
    [budgets, data, categoryOf, today],
  );
  const own = useMemo(() => (vault?.customCategories ?? []).map((c) => ({ id: c.id, name: c.name })), [vault?.customCategories]);
  return { m, currency: data?.currency ?? 'EUR', today, any: !!budgets && Object.keys(budgets).length > 0, own };
}

/** The Analyse on this month, where the budget tile stands. */
function OpenBudgetButton({ label, onShown }: { label: string; onShown: () => void }) {
  const { setTab, setAnalysisPeriod } = useFints();
  return (
    <OpenButton
      label={label}
      onClick={() => {
        setAnalysisPeriod(dayKey(new Date()).slice(0, 7));
        setTab('analysis');
        onShown();
      }}
    />
  );
}

/** A budget row's figure, as the tile writes it: what is left, how far over, or spent of the budget. */
function BudgetFigure({ line, currency, floor }: { line: BudgetLine; currency: string; floor: boolean }) {
  const words = useT().budgets.budget;
  const money = (cents: number) => <Money value={cents / 100} currency={currency} tone="plain" />;
  if (line.state === 'over') return <>{rich(floor ? words.overAtLeast(money(line.rest)) : words.over(money(line.rest)))}</>;
  if (line.state === 'left') return <>{rich(words.left(money(line.rest)))}</>;
  if (line.state === 'exact') return <>{words.exact}</>;
  return <>{rich(words.atLeastOf(money(line.spent), money(line.budget)))}</>;
}

/** Budget rows: the category, how far used up (left out with Beträge ausblenden, as the tile's bars are), the figure. */
function BudgetRows({ lines, currency, floor }: { lines: readonly BudgetLine[]; currency: string; floor: boolean }) {
  const words = useT().ask.facts;
  const privacy = usePrivacy();
  return (
    <Rows
      rows={lines.slice(0, 8).map((l) => ({
        key: l.id,
        name: categoryLabel(l.id),
        sub: privacy ? (l.state === 'over' ? words.budgetIsOver : undefined) : words.budgetUsed(Math.floor(usedShare(l) * 100)),
        amount: <BudgetFigure line={l} currency={currency} floor={floor} />,
      }))}
    />
  );
}

/**
 * "Was ist noch im Lebensmittel-Budget?", "Wie viel darf ich diesen Monat
 * noch für Essen ausgeben?": the budget, spent so far this month, what is
 * left and per day until the month ends. Every budget when none is named.
 */
function BudgetAnswer({ category, name, onShown }: { category: BuiltinCategoryId | null; name: string | null; onShown: () => void }) {
  const words = useT().ask.facts;
  const { m, currency, today, any, own } = useBudgetMonth();
  const { lines, asked } = budgetsAsked(m.lines, category, name, own);
  const named = !!category || !!name;
  if (named && !lines.length) {
    return <Lines lines={[asked.length ? words.budgetNone(namesList(asked.map((id) => categoryLabel(id)))) : words.budgetNamedNone(nameCase(name ?? ''))]} />;
  }
  if (!any || !lines.length) return <Lines lines={[words.budgetsNone]} />;
  const several = lines.length > 1 || !named;
  const button = <OpenBudgetButton label={several ? words.openBudgets : words.openBudget} onShown={onShown} />;
  if (m.coverage === 'none') return <><Lines lines={[words.budgetNoData]} />{button}</>;
  const floor = m.coverage === 'partial';
  if (several) {
    return (
      <>
        <Lines lines={[words.budgetsAll, floor && words.budgetFloorNote]} />
        <BudgetRows lines={lines} currency={currency} floor={floor} />
        {button}
      </>
    );
  }
  const l = lines[0];
  const cat = categoryLabel(l.id);
  const money = (cents: number) => <Fig><Money value={cents / 100} currency={currency} tone="plain" /></Fig>;
  const perDay = perDayLeft(l, today);
  const said: Line[] = l.state === 'over'
    ? [words.budgetOver(cat, money(l.budget), money(l.spent), money(l.rest)), floor && words.budgetFloorNote]
    : l.state === 'exact'
    ? [words.budgetExact(cat, money(l.budget))]
    : l.state === 'unknown'
    ? [words.budgetFloor(cat, money(l.budget), money(l.spent)), words.budgetFloorNote]
    : [words.budgetLeft(cat, money(l.budget), money(l.spent), money(l.rest)), perDay != null && daysLeftInMonth(today) > 1 && words.budgetPerDay(money(perDay))];
  return (
    <>
      <Lines lines={said} />
      {button}
    </>
  );
}

/** "Wo bin ich über dem Budget?": every budget over or nearly used up this month, the most used up first. */
function BudgetsOverAnswer({ onShown }: { onShown: () => void }) {
  const words = useT().ask.facts;
  const { m, currency, any } = useBudgetMonth();
  if (!any || !m.lines.length) return <Lines lines={[words.budgetsNone]} />;
  const button = <OpenBudgetButton label={words.openBudgets} onShown={onShown} />;
  if (m.coverage === 'none') return <><Lines lines={[words.budgetNoData]} />{button}</>;
  const floor = m.coverage === 'partial';
  const tight = tightBudgets(m.lines);
  if (!tight.length) return <><Lines lines={[words.budgetsFine, floor && words.budgetFloorNote]} />{button}</>;
  return (
    <>
      <Lines lines={[words.budgetsTight(tight.length), floor && words.budgetFloorNote]} />
      <BudgetRows lines={tight} currency={currency} floor={floor} />
      {button}
    </>
  );
}

/**
 * "Was kann ich bis Ende des Monats noch kündigen?": the contracts whose
 * "Kündbar bis" day falls between today and `until` (every one to come for
 * null), each with that day, the nearest first.
 */
function CancelByAnswer({ until, onShown }: { until: string | null; onShown: () => void }) {
  const t = useT();
  const words = t.ask.facts;
  const model = useRecurringModel();
  const { vault } = useFints();
  const openContracts = useOpenContracts(onShown);
  if (model.loading) return <Lines lines={[t.ask.thread.notLoaded]} />;
  const today = dayKey(new Date());
  const reminders = vault?.contractReminders;
  const ahead = deadlines(reminders, [...model.expense, ...model.income], [...model.ended, ...model.dismissed], today, null);
  const button = <OpenButton label={t.ask.actions.openContracts} onClick={openContracts} />;
  if (!ahead.length) return <><Lines lines={[Object.keys(reminders ?? {}).length ? words.cancelNoneAhead : words.cancelNoDates]} />{button}</>;
  const hits = until ? ahead.filter((d) => d.by <= until) : ahead;
  if (!hits.length) {
    return <><Lines lines={[until ? words.cancelNone(dayWords(until)) : words.cancelNoneAhead, words.cancelNext(ahead[0].name, dayWords(ahead[0].by))]} />{button}</>;
  }
  return (
    <>
      <Lines lines={[until ? words.cancelSome(hits.length, dayWords(until)) : words.cancelAhead(Math.min(hits.length, 8))]} />
      <Rows
        rows={hits.slice(0, 8).map((d) => ({
          key: d.id,
          name: d.name,
          sub: t.insights.contracts.cancelBy(dayWords(d.by)),
          amount: d.series ? <Money value={Math.abs(d.series.amount)} currency={d.series.currency} tone="plain" /> : null,
        }))}
      />
      {button}
    </>
  );
}

/**
 * "Wann verlängert sich mein Handyvertrag?", "Bis wann muss ich Spotify
 * kündigen?": the contract's "Kündbar bis" day and its next payment; where
 * no day is set, that Girovo does not know it.
 */
function RenewalAnswer({ name, onShown }: { name: string; onShown: () => void }) {
  const t = useT();
  const words = t.ask.facts;
  const model = useRecurringModel();
  const { vault } = useFints();
  const openContracts = useOpenContracts(onShown);
  if (model.loading) return <Lines lines={[t.ask.thread.notLoaded]} />;
  const today = dayKey(new Date());
  const button = <OpenButton label={t.ask.actions.openContracts} onClick={openContracts} />;
  const found = contractsAsked(name, vault?.contractReminders, model.expense, today);
  if (!found.length) return <><Lines lines={[words.contractNone(nameCase(name))]} />{button}</>;
  const [c, ...more] = found;
  const s = c.series;
  const said: Line[] = [
    c.by ? (c.by === today ? words.renewalToday(c.name) : words.renewalBy(c.name, dayWords(c.by))) : words.renewalUnknown(c.name),
    !!c.by && !!s && s.nextDate >= today && words.renewalNext(dayWords(s.nextDate), <Fig><Money value={Math.abs(s.amount)} currency={s.currency} tone="plain" /></Fig>),
    more.length > 0 && words.contractMore(namesList(more.slice(0, 3).map((x) => x.name))),
  ];
  return (
    <>
      <Lines lines={said} />
      {button}
    </>
  );
}
