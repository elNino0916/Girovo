'use client';

// Sparziele (lib/savings-goal.ts): one goal per savings account — a name, a
// target and, if the user gives one, the month it should be reached by —
// kept in the vault, sealed with the PIN. Progress is the account's balance
// as the bank reported it, never a figure the app makes up.
//
// On the Übersicht, under a savings account's balance (owner's pick
// "Monatsplan", 2026-10-24): the goal's name and what is still missing, then
// a strip with one segment per month of the plan, filled as far as the
// balance has come (so it never claims more than the money says), and the
// plan in words — how much a month, until when, which month this is. Without
// a date the strip is one bar. Analyse lists every goal.
//
// A Plus perk in the Play build: without Plus the account offers the Plus
// door (the gold plate) where it would offer "Sparziel setzen".

import { useId, useState } from 'react';
import { isSavingsAccount } from '@/lib/balances';
import type { SerializedAccount } from '@/lib/fints-types';
import { fmtAmountInput, fmtMonth, parseAmount } from '@/lib/format';
import { useT } from '@/lib/i18n/react';
import { goalsAllowed } from '@/lib/plus';
import { GOAL_LIMITS, goalProgress, monthKey, monthPlan, monthsUntil, type SavingsGoal } from '@/lib/savings-goal';
import { useFints } from '../FintsProvider';
import { Money } from '../Money';
import { CheckCircleIcon, FlagIcon, LockIcon } from '../icons';
import { RoundMoney } from '../insights/shared';
import { BrandPlate } from '../shell/BrandMark';
import { Button, Field, Input, Overlay, Sheet, cx } from '../ui';

/** The goal of `account`, if it has one. */
export function useGoalOf(account: SerializedAccount | null | undefined): SavingsGoal | null {
  const { vault } = useFints();
  if (!account) return null;
  return vault?.goals?.find((g) => g.accountNumber === account.accountNumber) ?? null;
}

/**
 * Under a savings account's balance: its goal, or the way to set one (the
 * Plus door where Plus is locked). Nothing for other accounts, nor before the
 * vault is readable — a goal set then could not be kept.
 */
export function AccountGoal({ account, balance }: { account: SerializedAccount; balance: number | null }) {
  const { plus, openPlus, vaultStatus } = useFints();
  const t = useT();
  const words = t.insights.goals;
  const goal = useGoalOf(account);
  const [editing, setEditing] = useState(false);
  if (!isSavingsAccount(account) || vaultStatus !== 'ready') return null;
  const allowed = goalsAllowed(plus.state);

  return (
    <div className="mt-5">
      {goal && allowed ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`${goal.name}, ${words.edit}`}
          className="-mx-2 block w-[calc(100%_+_16px)] rounded-[12px] px-2 py-1 text-left transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)]"
        >
          <GoalLine goal={goal} balance={balance} />
        </button>
      ) : allowed ? (
        <Button size="sm" variant="tertiary" className="-ml-3" iconLeft={<FlagIcon size={18} />} onClick={() => setEditing(true)}>
          {words.set}
        </Button>
      ) : (
        // The Plus door: the same tonal button with the gold plate everywhere (DESIGN.md, Girovo Plus).
        <Button size="sm" variant="secondary" iconLeft={<BrandPlate tone="plus" size={18} />} onClick={openPlus}>
          {words.set}
        </Button>
      )}
      {editing && <GoalSheet account={account} goal={goal} balance={balance} onClose={() => setEditing(false)} />}
    </div>
  );
}

/** A goal's name, what is missing, the month strip and the plan in words. */
export function GoalLine({ goal, balance, account }: { goal: SavingsGoal; balance: number | null; account?: string }) {
  const t = useT();
  const words = t.insights.goals;
  const cents = balance == null ? 0 : Math.round(balance * 100);
  const progress = goalProgress(goal, cents);
  const plan = monthPlan(goal);
  const segments = plan?.months ?? 1;
  // Filled by the money: so many of the segments as the balance covers of the target.
  const filled = progress.share * segments;
  const label = progress.reached
    ? words.reached
    : plan && progress.perMonth != null && progress.monthsLeft
      ? words.plan(
        <RoundMoney key="m" value={Math.ceil(progress.perMonth / 100)} />,
        fmtMonth(goal.by!),
        plan.current,
        plan.months,
      )
      : goal.by && progress.monthsLeft === 0
        ? words.due
        : words.share(Math.floor(progress.share * 100));

  return (
    <div className="w-full min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-[16px] leading-6 font-medium text-ink">
          {goal.name}
          {account && <span className="font-normal text-ink-2"> · {account}</span>}
        </p>
        <p className="shrink-0 text-[14px] leading-5 text-ink-2">
          {progress.reached ? (
            <span className="inline-flex items-center gap-1 font-medium text-green">
              <CheckCircleIcon size={16} />
              {words.reached}
            </span>
          ) : words.missing(<Money key="x" value={progress.missing / 100} tone="plain" />)}
        </p>
      </div>
      {/* One segment per month of the plan, filled as far as the balance has come. */}
      <div
        role="img"
        aria-label={words.shareSaid(Math.floor(progress.share * 100))}
        className={cx('mt-2 flex gap-1', segments > 24 ? 'h-2' : 'h-2.5')}
      >
        {Array.from({ length: segments }, (_, i) => {
          const part = Math.max(0, Math.min(1, filled - i));
          return (
            <span key={i} className="relative flex-1 overflow-hidden rounded-full bg-[var(--progress-track)]">
              {part > 0 && <span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${part * 100}%` }} />}
            </span>
          );
        })}
      </div>
      {!progress.reached && <p className="tnum mt-2 text-[14px] leading-5 text-ink-2">{label}</p>}
    </div>
  );
}

/** "Sparziel setzen": name, target and the optional month, with what that means per month. */
function GoalSheet({ account, goal, balance, onClose }: {
  account: SerializedAccount; goal: SavingsGoal | null; balance: number | null; onClose: () => void;
}) {
  const { setGoal, accountLabel } = useFints();
  const t = useT();
  const words = t.insights.goals;
  const id = useId();
  const [name, setName] = useState(goal?.name ?? '');
  const [target, setTarget] = useState(goal ? fmtAmountInput(goal.target / 100) : '');
  const [by, setBy] = useState(goal?.by ?? '');
  const [tried, setTried] = useState(false);
  const thisMonth = monthKey(new Date());

  const amount = parseAmount(target);
  const cents = amount == null ? null : Math.round(Math.abs(amount) * 100);
  const nameOk = !!name.trim();
  const targetOk = cents != null && cents > 0 && cents <= GOAL_LIMITS.target;
  const draft: SavingsGoal | null = targetOk
    ? { accountNumber: account.accountNumber, name: name.trim() || '–', target: cents!, ...(by ? { by } : {}) }
    : null;
  const progress = draft ? goalProgress(draft, balance == null ? 0 : Math.round(balance * 100)) : null;

  const save = () => {
    setTried(true);
    if (!nameOk || !targetOk) return;
    setGoal(account.accountNumber, {
      name: name.trim(),
      target: cents!,
      ...(by ? { by } : {}),
      // The plan starts the month the goal was first set; a changed goal keeps it.
      since: goal?.since ?? thisMonth,
    });
    onClose();
  };

  return (
    <Overlay open onClose={onClose} labelledBy={`${id}-title`} align="bottom">
      <Sheet
        onClose={onClose}
        footer={(
          // The note beside the button while both fit; above it at the phone's large text.
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <p className="flex min-w-fit items-center gap-2 text-[14px] leading-5 text-ink-2">
              <LockIcon size={18} className="shrink-0" />
              <span>{words.sealed}</span>
            </p>
            <Button variant="primary" className="ml-auto" onClick={save}>{words.save}</Button>
          </div>
        )}
      >
        <h2 id={`${id}-title`} className="text-[22px] leading-7 font-medium text-ink">{goal ? words.edit : words.set}</h2>
        <p className="mt-1 text-[16px] leading-6 text-ink-2">{words.intro(accountLabel(account))}</p>
        <Field label={words.name} htmlFor={`${id}-name`} error={tried && !nameOk ? words.nameInvalid : undefined} className="mt-5 mb-4">
          <Input id={`${id}-name`} value={name} maxLength={GOAL_LIMITS.name} autoComplete="off" onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={words.target} htmlFor={`${id}-target`} error={tried && !targetOk ? words.targetInvalid : undefined}>
          <Input
            id={`${id}-target`}
            inputMode="decimal"
            autoComplete="off"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="amount"
            trailing={<span aria-hidden className="pr-2.5 text-ink-2">€</span>}
          />
        </Field>
        <Field label={words.by} htmlFor={`${id}-by`} floatLabel="always" className="mb-0">
          <Input id={`${id}-by`} type="month" min={thisMonth} value={by} onChange={(e) => setBy(e.target.value)} />
        </Field>
        {/* What the goal asks for, live: per month until the date, or what is missing. */}
        {progress && !progress.reached && progress.perMonth != null && progress.monthsLeft ? (
          <p className="mt-4 text-[16px] leading-6 text-ink" aria-live="polite">
            {words.perMonth(<RoundMoney key="p" value={Math.ceil(progress.perMonth / 100)} className="font-medium" />)}
            <span className="block text-[14px] leading-5 text-ink-2">
              {words.perMonthDetail(<Money key="l" value={progress.missing / 100} tone="plain" />, monthsUntil(by, new Date()))}
            </span>
          </p>
        ) : null}
        {goal && (
          <Button
            size="sm"
            variant="tertiary"
            className="mt-4 -ml-3"
            onClick={() => {
              setGoal(account.accountNumber, null);
              onClose();
            }}
          >
            {words.remove}
          </Button>
        )}
      </Sheet>
    </Overlay>
  );
}

/** Analyse: every goal, with its account's balance as far as this session knows it. */
export function GoalsSection() {
  const { vault, accounts, balances, accountLabel, plus } = useFints();
  const t = useT();
  const words = t.insights.goals;
  const id = useId();
  const goals = (vault?.goals ?? []).filter((g) => accounts.some((a) => a.accountNumber === g.accountNumber));
  if (!goals.length || !goalsAllowed(plus.state)) return null;
  return (
    <section aria-labelledby={id} className="panel">
      <div className="px-4 py-4 sm:px-6">
        <h2 id={id} className="section-head">{words.title}</h2>
        <ul className="mt-3 space-y-5">
          {goals.map((g) => {
            const account = accounts.find((a) => a.accountNumber === g.accountNumber)!;
            const bal = balances[g.accountNumber];
            return (
              <li key={g.accountNumber}>
                <GoalLine goal={g} balance={bal?.balance ?? null} account={accountLabel(account)} />
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
