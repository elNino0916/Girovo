'use client';

// Girovo AI does five things for you (lib/ask-actions.ts), each the way the
// app already does it and only after "Ja, bitte", as ChangeAnswer in
// AskThread.tsx asks for a setting:
//
// - fileUnder        a rule for the payee, as "für alle" in a booking's details (FintsProvider setCategory with `rule`);
//                    a payee whose bookings the user filed by hand is left alone, as "Mit Girovo AI kategorisieren" leaves it
// - createGoal       a Sparziel on a savings account without one (setGoal, as the Sparziel sheet saves it); Plus on Android
// - budget           a monthly budget set or deleted (setBudgets, as the Analyse's budget dialog saves them)
// - remindContract   Verträge & Abos' cancellation reminder (setContractReminder, as the reminder dialog saves it);
//                    without a known date, one line and the way to Verträge & Abos
// - prepareTransfer  the transfer form, filled in (openTransfer, as "Erneut überweisen" opens it), the IBAN only
//                    from the newest earlier transfer to that person. Girovo never sends: the form's review and
//                    the Freigabe stay the user's.
//
// Routed from components/insights/AskThread.tsx IntentAnswer.

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { budgetAfter, contractChoices, contractsFor, filePlan, transferPayee, type ActionIntent } from '@/lib/ask-actions';
import { nameCase } from '@/lib/ask-facts';
import { isSavingsAccount } from '@/lib/balances';
import { BUDGET_MAX_CENTS, isBudgetCategory } from '@/lib/budgets';
import { categoryLabel, counterpartyName, counterpartyRuleKeys, type CategoryId } from '@/lib/categories';
import { compactIban, dayKey, fmtAmountInput, fmtMonth } from '@/lib/format';
import { intlLocale } from '@/lib/i18n/locale';
import { useT } from '@/lib/i18n/react';
import { goalsAllowed } from '@/lib/plus';
import { seriesTitle } from '@/lib/recurring';
import { GOAL_LIMITS, monthKey } from '@/lib/savings-goal';
import { useFints } from '../../FintsProvider';
import { Money } from '../../Money';
import { wantContracts } from '../../shell/frame';
import { txText } from '../../transactions/model';
import { recentPayees } from '../../transfer/model';
import { Button } from '../../ui';
import { settleOutcome, type Turn } from '../ask-thread-store';
import { useRecurringModel } from '../recurring-model';

const TEXT = 'text-[16px] leading-6 text-ink sm:text-[14px] sm:leading-[22px] [text-wrap:pretty]';

type Line = ReactNode[] | string | null | false;

/** Sentences in one paragraph. */
function Said({ lines }: { lines: Line[] }) {
  const shown = lines.filter((l): l is ReactNode[] | string => !!l);
  return (
    <p className={TEXT}>
      {shown.map((parts, i) => (
        <span key={i}>
          {i > 0 && ' '}
          {typeof parts === 'string' ? parts : parts.map((p, j) => <span key={j}>{p}</span>)}
        </span>
      ))}
    </p>
  );
}

/** An amount inside a sentence: <Money>, so "Beträge ausblenden" hides it. */
function Amount({ cents }: { cents: number }) {
  return <span className="tnum font-medium whitespace-nowrap"><Money value={cents / 100} currency="EUR" tone="plain" /></span>;
}

/** The way from an answer to its place in the app. */
function OpenButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <Button variant="secondary" size="sm" className="mt-3" onClick={onClick}>{label}</Button>;
}

/**
 * What will happen, and the two buttons: made only on the yes, then the turn
 * keeps "done"; "Abbrechen" keeps "cancelled". `yes` names the button where
 * "Ja, bitte" would say too little ("Überweisung öffnen").
 */
function Confirm({ turn, lines, note, yes, onYes }: { turn: Turn; lines: Line[]; note?: string; yes?: string; onYes: () => void }) {
  const words = useT().ask.actions;
  return (
    <>
      <Said lines={lines} />
      {note && <p className="mt-1 text-[14px] leading-5 text-ink-2">{note}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => {
            onYes();
            settleOutcome(turn.id, 'done');
          }}
        >
          {yes ?? words.yes}
        </Button>
        <Button variant="tertiary" size="sm" onClick={() => settleOutcome(turn.id, 'cancelled')}>{words.no}</Button>
      </div>
    </>
  );
}

/** A day in a sentence: "31. März", with the year only when it is not this one. */
function dayWords(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  const thisYear = d.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat(intlLocale(), { day: 'numeric', month: 'long', ...(thisYear ? {} : { year: 'numeric' }) }).format(d);
}

export function ActionAnswer({ turn, intent, onShown }: { turn: Turn; intent: ActionIntent; onShown: () => void }) {
  const cancelled = useT().ask.actions.cancelled;
  if (turn.outcome === 'cancelled') return <Said lines={[cancelled]} />;
  switch (intent.kind) {
    case 'fileUnder': return <FileAnswer turn={turn} intent={intent} />;
    case 'createGoal': return <GoalAnswer turn={turn} intent={intent} onShown={onShown} />;
    case 'budget': return <BudgetAnswer turn={turn} intent={intent} onShown={onShown} />;
    case 'remindContract': return <RemindAnswer turn={turn} intent={intent} onShown={onShown} />;
    case 'prepareTransfer': return <TransferAnswer turn={turn} intent={intent} onShown={onShown} />;
  }
}

/** "Ordne alle Shell-Buchungen Mobilität zu": the payee's rule, as "für alle" in a booking's details. */
function FileAnswer({ turn, intent }: { turn: Turn; intent: Extract<ActionIntent, { kind: 'fileUnder' }> }) {
  const words = useT().ask.tasks;
  const { txByAccount, pendingCache, loadedTxs, categoryOf, setCategory } = useFints();
  const { name, category } = intent;
  // The listed bookings, Vorgemerkte included, are counted; every loaded one the rule reaches is checked.
  const plan = useMemo(() => {
    if (!name || !category) return null;
    const listed = [...new Set([...Object.values(txByAccount).flat(), ...Object.values(pendingCache).flat()])];
    return filePlan(listed, loadedTxs, name, category, (tx) => {
      const c = categoryOf(tx);
      return { name: txText(tx).name || counterpartyName(tx), keys: counterpartyRuleKeys(tx), category: c.id, source: c.source, split: !!c.parts };
    });
  }, [name, category, txByAccount, pendingCache, loadedTxs, categoryOf]);
  if (!name) return <Said lines={[words.fileNoName]} />;
  if (!category) return <Said lines={[words.fileNoCategory(name)]} />;
  const label = categoryLabel(category);
  const shown = plan && plan.state !== 'none' && plan.names.length === 1 ? plan.names[0] : name;
  if (turn.outcome === 'done') return <Said lines={[words.fileDone(shown, label)]} />;
  if (!plan || plan.state === 'none') return <Said lines={[words.fileNotFound(name)]} />;
  if (plan.state === 'handFiled') return <Said lines={[words.fileHandFiled(shown)]} />;
  if (plan.state === 'already') return <Said lines={[words.fileAlready(shown, label)]} />;
  const several = plan.names.length > 1 ? words.fileNames(plan.names.slice(0, 4).join(', ') + (plan.names.length > 4 ? ' …' : '')) : null;
  return (
    <Confirm
      turn={turn}
      lines={[words.fileAsk(plan.count, shown, label), several]}
      note={plan.skipped ? words.fileSkipped : undefined}
      onYes={() => {
        for (const tx of plan.anchors) setCategory(tx, category as CategoryId, { rule: true });
      }}
    />
  );
}

/** "Leg ein Sparziel über 500 € bis Juni an": a goal on a savings account that has none yet. */
function GoalAnswer({ turn, intent, onShown }: { turn: Turn; intent: Extract<ActionIntent, { kind: 'createGoal' }>; onShown: () => void }) {
  const t = useT();
  const words = t.ask.tasks;
  const { plus, vault, vaultStatus, accounts, accountLabel, setGoal, setTab, selectAccount } = useFints();
  const name = intent.name ?? words.goalName;
  // A Plus perk in the Play build, as the account's own "Sparziel setzen".
  if (!goalsAllowed(plus.state)) return <Said lines={[t.ask.facts.goalPlus]} />;
  if (turn.outcome === 'done') {
    const made = vault?.goals?.find((g) => g.name === name);
    const account = made ? accounts.find((a) => a.accountNumber === made.accountNumber) ?? null : null;
    return (
      <>
        <Said lines={[words.goalDone(name)]} />
        {account && (
          <OpenButton
            label={t.ask.facts.openGoal}
            onClick={() => {
              setTab('overview');
              selectAccount(account);
              onShown();
            }}
          />
        )}
      </>
    );
  }
  if (intent.cents == null) return <Said lines={[words.goalNoAmount]} />;
  if (intent.cents > GOAL_LIMITS.target) return <Said lines={[words.goalTooHigh]} />;
  if (vaultStatus !== 'ready') return <Said lines={[words.goalLocked]} />;
  const savings = accounts.filter(isSavingsAccount);
  if (!savings.length) return <Said lines={[words.goalNoAccount]} />;
  const free = savings.filter((a) => !(vault?.goals ?? []).some((g) => g.accountNumber === a.accountNumber));
  if (!free.length) return <Said lines={[words.goalAllTaken]} />;
  const account = free[0];
  const cents = intent.cents;
  return (
    <Confirm
      turn={turn}
      lines={[words.goalAsk(name, <Amount cents={cents} />, intent.by ? fmtMonth(intent.by) : null, accountLabel(account))]}
      onYes={() => setGoal(account.accountNumber, { name, target: cents, ...(intent.by ? { by: intent.by } : {}), since: monthKey(new Date()) })}
    />
  );
}

/** "Leg für Essen ein Budget von 300 € an", "Budget für Essen löschen": the Analyse's monthly budgets. */
function BudgetAnswer({ turn, intent, onShown }: { turn: Turn; intent: Extract<ActionIntent, { kind: 'budget' }>; onShown: () => void }) {
  const t = useT();
  const words = t.ask.tasks;
  const { vault, setBudgets, setTab } = useFints();
  const { category } = intent;
  if (!category) return <Said lines={[words.budgetNoCategory]} />;
  const label = categoryLabel(category);
  if (!isBudgetCategory(category)) return <Said lines={[words.budgetNotFor(label)]} />;
  const budgets = vault?.budgets ?? {};
  const current = budgets[category] ?? null;
  const open = <OpenButton label={words.openBudgets} onClick={() => { setTab('analysis'); onShown(); }} />;
  if (intent.remove) {
    if (turn.outcome === 'done') return <><Said lines={[words.budgetRemoved(label)]} />{open}</>;
    if (current == null) return <Said lines={[words.budgetNone(label)]} />;
    return (
      <Confirm
        turn={turn}
        lines={[words.budgetRemoveAsk(label, <Amount cents={current} />)]}
        onYes={() => {
          const { [category]: _gone, ...rest } = budgets;
          setBudgets(rest);
        }}
      />
    );
  }
  if (intent.cents == null) return <Said lines={[words.budgetNoCategory]} />;
  // "Erhöhe das Budget um 50 €": the budget it has, raised or lowered; once done, it has the new one.
  if (intent.step && turn.outcome === 'done' && current != null) return <><Said lines={[words.budgetDone(label, <Amount cents={current} />)]} />{open}</>;
  const cents = budgetAfter(intent.cents, intent.step, current);
  if (cents == null) return <Said lines={[words.budgetNone(label)]} />;
  if (turn.outcome === 'done') return <><Said lines={[words.budgetDone(label, <Amount cents={cents} />)]} />{open}</>;
  if (cents <= 0) return <Said lines={[words.budgetTooLow]} />;
  if (cents > BUDGET_MAX_CENTS) return <Said lines={[words.budgetTooHigh]} />;
  if (current === cents) return <Said lines={[t.ask.actions.already]} />;
  return (
    <Confirm
      turn={turn}
      lines={[words.budgetAsk(label, <Amount cents={cents} />, current != null ? <Amount cents={current} /> : null)]}
      onYes={() => setBudgets({ ...budgets, [category]: cents })}
    />
  );
}

/** Up to this many fitting contracts are offered to pick from; more, and the user names one. */
const PICK_MAX = 6;

/** "Erinner mich vor der Verlängerung von Spotify": Verträge & Abos' reminder before the day it can be cancelled by. */
function RemindAnswer({ turn, intent, onShown }: { turn: Turn; intent: Extract<ActionIntent, { kind: 'remindContract' }>; onShown: () => void }) {
  const t = useT();
  const words = t.ask.tasks;
  const model = useRecurringModel();
  const { vault, setContractReminder, setTab } = useFints();
  const asked = intent.name;
  // The contract picked when more than one fits; until then none is taken.
  const [picked, setPicked] = useState<string | null>(null);
  const hits = useMemo(
    () => (asked ? contractsFor(model.expense.filter((s) => !s.ended), asked, (s) => [seriesTitle(s), s.name]) : []),
    [asked, model.expense],
  );
  if (!asked) return <Said lines={[words.remindNoName]} />;
  if (!hits.length) return <Said lines={[t.ask.facts.contractNone(nameCase(asked))]} />;
  const pool = contractChoices(hits, asked, (s) => [seriesTitle(s), s.name], (s) => s.id);
  let chosen = pool.length === 1 ? pool[0] : pool.find((s) => s.id === picked) ?? null;
  if (!chosen && turn.outcome === 'done') chosen = pool.find((s) => vault?.contractReminders?.[s.id]) ?? pool[0];
  if (!chosen) {
    if (pool.length > PICK_MAX) return <Said lines={[words.remindSeveral([...new Set(pool.map((s) => seriesTitle(s)))].slice(0, 4).join(', '))]} />;
    return (
      <>
        <Said lines={[words.remindPick]} />
        <div className="mt-3 flex flex-wrap gap-2">
          {pool.map((s) => (
            <Button key={s.id} variant="secondary" size="sm" onClick={() => setPicked(s.id)}>
              <span className="inline-flex gap-2">
                <span>{seriesTitle(s)}</span>
                <Amount cents={Math.round(Math.abs(s.amount) * 100)} />
              </span>
            </Button>
          ))}
        </div>
      </>
    );
  }
  const s = chosen;
  const title = seriesTitle(s);
  const current = vault?.contractReminders?.[s.id];
  const leadOf = (n: number) => words.remindLead[n] ?? words.remindLead[30];
  if (turn.outcome === 'done') return <Said lines={[words.remindDone(title, dayWords(intent.by ?? current?.by ?? dayKey(new Date())))]} />;
  if (intent.by) {
    if (intent.by < dayKey(new Date())) return <Said lines={[words.remindPast]} />;
    const by = intent.by;
    const lead = intent.lead ?? current?.lead ?? 30;
    if (current && current.by === by && current.lead === lead) return <Said lines={[words.remindAlready(title, dayWords(by), leadOf(lead))]} />;
    return (
      <Confirm
        turn={turn}
        lines={[words.remindAsk(title, dayWords(by), leadOf(lead))]}
        onYes={() => setContractReminder(s.id, { by, lead, name: title })}
      />
    );
  }
  if (current) {
    const lead = intent.lead;
    if (lead && lead !== current.lead) {
      return (
        <Confirm
          turn={turn}
          lines={[words.remindAsk(title, dayWords(current.by), leadOf(lead))]}
          onYes={() => setContractReminder(s.id, { ...current, lead })}
        />
      );
    }
    return <Said lines={[words.remindAlready(title, dayWords(current.by), leadOf(current.lead))]} />;
  }
  // No date known: the user sets it at the contract, in Verträge & Abos.
  return (
    <>
      <Said lines={[words.remindUnknown(title)]} />
      <OpenButton
        label={t.ask.actions.openContracts}
        onClick={() => {
          setTab('contracts');
          wantContracts();
          onShown();
        }}
      />
    </>
  );
}

/** "Überweis Mama 50 Euro für Pizza": the transfer form, filled in. Sending stays the user's. */
function TransferAnswer({ turn, intent, onShown }: { turn: Turn; intent: Extract<ActionIntent, { kind: 'prepareTransfer' }>; onShown: () => void }) {
  const words = useT().ask.tasks;
  const { txByAccount, accounts, openTransfer } = useFints();
  // Every earlier transfer's payee, the newest first; the user's own accounts are no payees.
  const payees = useMemo(() => {
    const own = new Set(accounts.map((a) => compactIban(a.iban)).filter(Boolean));
    return recentPayees(txByAccount, { limit: 100_000 }).filter((p) => !own.has(p.iban));
  }, [txByAccount, accounts]);
  if (turn.outcome === 'done') return <Said lines={[words.transferOpened]} />;
  const base = {
    ...(intent.cents ? { amount: fmtAmountInput(intent.cents / 100) } : {}),
    ...(intent.purpose ? { purpose: intent.purpose } : {}),
  };
  const open = (p: Parameters<typeof openTransfer>[0]) => {
    settleOutcome(turn.id, 'done');
    onShown();
    // On the next tick, once the thread has stepped aside on a phone.
    setTimeout(() => openTransfer(p), 0);
  };
  const form = <OpenButton label={words.transferForm} onClick={() => open(base)} />;
  if (!intent.name) return <><Said lines={[words.transferNoName]} />{form}</>;
  const found = transferPayee(payees, intent.name);
  if (found.state === 'none') return <><Said lines={[words.transferNoIban(intent.name)]} />{form}</>;
  if (found.state === 'several') return <><Said lines={[words.transferSeveral(intent.name, found.names.slice(0, 4).join(', '))]} />{form}</>;
  const { payee } = found;
  return (
    <Confirm
      turn={turn}
      lines={[words.transferAsk(payee.name, intent.cents ? <Amount cents={intent.cents} /> : null), intent.purpose && words.transferPurpose(intent.purpose)]}
      note={words.transferNote}
      yes={words.transferOpen}
      onYes={() => {
        onShown();
        setTimeout(() => openTransfer({ ...base, name: payee.name, iban: payee.iban, source: 'recent' }), 0);
      }}
    />
  );
}
