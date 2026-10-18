'use client';

// Monatsbudgets in the Umsatzanalyse: how the month on view stands against
// the budgets the user set (lib/budgets.ts), and the dialog that sets them.
//
// The tile follows the toolbar like every other tile here — the accounts in
// scope, the month picked — and counts exactly what "Ausgaben nach Kategorie"
// counts. A budget is per month, so over the whole range it lists the budgets
// alone and offers the newest month. A month the loaded days do not wholly
// cover says so, and its spending is "mindestens", never a total.
//
// "Beträge ausblenden": every figure is a <Money>, and the bars go too — how
// full a budget is says how much of it is spent. Whether a budget is over
// stays, in words: that is no amount.

import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CategoryAmount } from '@/lib/analytics';
import {
  BUDGET_CATEGORIES, BUDGET_MAX_CENTS, budgetLines, monthCoverage, parseBudgetInput, type BudgetLine, type Budgets,
} from '@/lib/budgets';
import { categoryLabel, type CategoryId } from '@/lib/categories';
import { dayKey, fmtAmountInput, fmtMonth } from '@/lib/format';
import { rich, useT } from '@/lib/i18n/react';
import { BarTrack } from '../charts';
import { AlertTriangleIcon, CategoryIcon, ChevronIcon, PencilIcon } from '../icons';
import { Money, currencyMark, formatMoney, usePrivacy } from '../Money';
import { Button, Dialog, Input, Tag, cx } from '../ui';
import type { AnalysisMonth } from './analysis-model';
import { InsightTile, fmtDayKey } from './shared';

// ---------------------------------------------------------------------------
// The tile
// ---------------------------------------------------------------------------

export function BudgetTile({
  budgets, month, spending, currency, subtitle, newest, onShowMonth, onShow, onEdit,
}: {
  budgets: Budgets;
  /** The month on view, or null for the whole loaded range. */
  month: AnalysisMonth | null;
  /** That period's "Ausgaben nach Kategorie" (periodTotals().byCategory). */
  spending: readonly CategoryAmount[];
  currency: string;
  subtitle?: ReactNode;
  /** The newest month of the range — offered while the whole range is on view. */
  newest: AnalysisMonth | null;
  onShowMonth: (month: string) => void;
  onShow: (id: CategoryId) => void;
  onEdit: () => void;
}) {
  const t = useT();
  const words = t.budgets.budget;
  const privacy = usePrivacy();
  // Read per render: a tab left open overnight moves the running month on.
  const today = dayKey(new Date());
  const coverage = month ? monthCoverage(month, today) : null;
  // A month with something loaded is measured; the whole range, or a month
  // with nothing loaded, shows each budget's own figure.
  const measured = !!month && coverage !== 'none';
  const lines = useMemo(
    () => budgetLines(budgets, coverage === 'none' ? [] : spending, coverage ?? 'none'),
    [budgets, spending, coverage],
  );

  const note = !month
    ? words.wholeRange
    : coverage === 'running'
      ? words.running(fmtDayKey(month.to))
      : coverage === 'partial'
        ? words.partial(fmtDayKey(month.from), fmtDayKey(month.to))
        : coverage === 'none'
          ? words.none
          : null;

  return (
    <InsightTile
      title={words.title}
      subtitle={subtitle}
      actions={
        <Button variant="tertiary" size="xs" iconLeft={<PencilIcon size={15} />} aria-label={words.editLabel} onClick={onEdit}>
          {words.edit}
        </Button>
      }
    >
      {note && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-2 sm:px-6">
          <p className="text-[13px] leading-snug text-ink-3">{note}</p>
          {!month && newest && (
            <Button variant="tertiary" size="xs" className="-ml-3" onClick={() => onShowMonth(newest.month)}>
              {words.showMonth(fmtMonth(newest.month))}
            </Button>
          )}
        </div>
      )}
      <ul className="pb-1">
        {lines.map((line) => (
          <li key={line.id}>
            <button
              type="button"
              onClick={() => onShow(line.id)}
              className="row-focus group flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors duration-150 hover:bg-inset sm:gap-3 sm:px-6"
            >
              <span className="hidden size-9 shrink-0 place-items-center rounded-full bg-inset text-ink-2 transition-colors duration-150 group-hover:bg-surface sm:grid">
                <CategoryIcon id={line.id} size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="min-w-0 text-[15px] leading-snug font-semibold text-ink">{categoryLabel(line.id)}</span>
                  <span className="tnum text-[14px] leading-snug whitespace-nowrap text-ink-2">
                    {measured
                      ? <BudgetFigures line={line} currency={currency} floor={coverage === 'partial'} />
                      : rich(words.perMonth(<Money value={line.budget / 100} currency={currency} tone="plain" className="font-semibold text-ink" />))}
                  </span>
                </span>
                {measured && (
                  <>
                    {!privacy && <BudgetBar line={line} />}
                    <span className="mt-1.5 flex min-h-6 items-center">
                      <BudgetState line={line} currency={currency} floor={coverage === 'partial'} />
                    </span>
                  </>
                )}
              </span>
              <ChevronIcon dir="right" size={16} className="shrink-0 text-ink-3" />
              <span className="sr-only">. {t.insights.bookings.show}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="px-4 pt-1 pb-4 text-[13px] leading-snug text-ink-3 sm:px-6 sm:pb-5">{words.basis}</p>
    </InsightTile>
  );
}

/** "212,40 € von 300,00 €" — "mind. …" where the month is not fully loaded. */
function BudgetFigures({ line, currency, floor }: { line: BudgetLine; currency: string; floor: boolean }) {
  const t = useT();
  const spent = <Money value={line.spent / 100} currency={currency} tone="plain" className="font-semibold text-ink" />;
  const budget = <Money value={line.budget / 100} currency={currency} tone="plain" />;
  return <>{rich(floor ? t.budgets.budget.atLeastOf(spent, budget) : t.budgets.budget.of(spent, budget))}</>;
}

/**
 * How far into the budget the month is: navy, like every bar that reports,
 * on an inset track that is the budget itself. Never longer than the track —
 * being over is said in words beside it — and empty while nothing is spent
 * (BarTrack would draw its smallest stub).
 */
function BudgetBar({ line }: { line: BudgetLine }) {
  return (
    <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-inset">
      {line.spent > 0 && <BarTrack value={line.spent} max={line.budget} color="var(--headline)" thickness={6} />}
    </span>
  );
}

/** "88,00 € übrig", "Budget ausgeschöpft", "40,00 € drüber" (an emphasis tag: orange is a mark, never text). */
function BudgetState({ line, currency, floor }: { line: BudgetLine; currency: string; floor: boolean }) {
  const t = useT();
  const words = t.budgets.budget;
  const amount = <Money value={line.rest / 100} currency={currency} tone="plain" />;
  switch (line.state) {
    case 'over':
      return <Tag tone="emphasis" size="sm">{rich(floor ? words.overAtLeast(amount) : words.over(amount))}</Tag>;
    case 'exact':
      return <span className="text-[13px] font-semibold text-ink-2">{words.exact}</span>;
    case 'left':
      return <span className="text-[13px] text-ink-2">{rich(words.left(amount))}</span>;
    default:
      return <span className="text-[13px] text-ink-3">{words.unknown}</span>;
  }
}

// ---------------------------------------------------------------------------
// The dialog
// ---------------------------------------------------------------------------

type FieldError = 'format' | 'notPositive' | 'tooLarge';

/**
 * "Monatsbudgets": one amount field per spending category, empty for none.
 * Typed the way the interface language writes amounts; checked on leaving a
 * field and on saving. Saving replaces every budget at once.
 */
export function BudgetDialog({
  open, onClose, budgets, averages, currency, sessionOnly, onSave,
}: {
  open: boolean;
  onClose: () => void;
  budgets: Budgets;
  /** Average monthly spending per category over the complete months in scope, whole cents. */
  averages: ReadonlyMap<CategoryId, number>;
  currency: string;
  /** The vault cannot save right now: the budgets last for this session. */
  sessionOnly: boolean;
  onSave: (next: Budgets) => void;
}) {
  if (!open) return null;
  return (
    <BudgetForm onClose={onClose} budgets={budgets} averages={averages} currency={currency} sessionOnly={sessionOnly} onSave={onSave} />
  );
}

function BudgetForm({
  onClose, budgets, averages, currency, sessionOnly, onSave,
}: Omit<Parameters<typeof BudgetDialog>[0], 'open'>) {
  const t = useT();
  const words = t.budgets.budget.dialog;
  const auto = useId();
  const fieldRefs = useRef(new Map<CategoryId, HTMLInputElement>());
  // Seeded once: what is typed is the user's until they save or leave.
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const id of BUDGET_CATEGORIES) {
      const cents = budgets[id];
      out[id] = cents ? fmtAmountInput(cents / 100) : '';
    }
    return out;
  });
  const [errors, setErrors] = useState<Partial<Record<CategoryId, FieldError>>>({});
  const [dirty, setDirty] = useState(false);

  const errorText = (e: FieldError) =>
    e === 'format' ? words.invalid : e === 'notPositive' ? words.notPositive : words.tooLarge(formatMoney(BUDGET_MAX_CENTS / 100, currency));

  const check = (id: CategoryId, text: string) => {
    const read = parseBudgetInput(text);
    setErrors((prev) => {
      const next = { ...prev };
      if (read.error) next[id] = read.error;
      else delete next[id];
      return next;
    });
    // A valid amount is written back the way the language writes it.
    if (read.cents) setValues((v) => ({ ...v, [id]: fmtAmountInput(read.cents! / 100) }));
  };

  const save = () => {
    const next: Budgets = {};
    const found: Partial<Record<CategoryId, FieldError>> = {};
    for (const id of BUDGET_CATEGORIES) {
      const read = parseBudgetInput(values[id] ?? '');
      if (read.error) found[id] = read.error;
      else if (read.cents) next[id] = read.cents;
    }
    const invalid = BUDGET_CATEGORIES.find((id) => found[id]);
    if (invalid) {
      setErrors(found);
      fieldRefs.current.get(invalid)?.focus();
      return;
    }
    onSave(next);
    onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      // A form with something typed into it is not closed by a stray click beside it.
      onBackdrop={dirty ? () => {} : undefined}
      title={words.title}
      description={words.intro}
      size="md"
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>{t.common.cancel}</Button>
          <Button variant="primary" onClick={save}>{t.common.save}</Button>
        </>
      }
    >
      <ul className="-mt-1">
        {BUDGET_CATEGORIES.map((id) => {
          const fieldId = `budget${auto}-${id}`;
          const hintId = `${fieldId}-hint`;
          const errorId = `${fieldId}-error`;
          const average = averages.get(id);
          const error = errors[id];
          return (
            <li key={id} className="border-b border-line py-2.5 last:border-b-0">
              <div className="flex items-center gap-3">
                <span aria-hidden className="hidden size-9 shrink-0 place-items-center rounded-full bg-inset text-ink-2 sm:grid">
                  <CategoryIcon id={id} size={18} />
                </span>
                <label htmlFor={fieldId} className="min-w-0 flex-1">
                  <span className="block text-[15px] leading-snug font-semibold text-ink">{categoryLabel(id)}</span>
                  {average != null && average > 0 && (
                    <span id={hintId} className="block text-[13px] leading-snug text-ink-3">
                      {rich(words.average(<Money value={average / 100} currency={currency} tone="plain" />))}
                    </span>
                  )}
                </label>
                <div className="w-[9.5rem] shrink-0">
                  <Input
                    ref={(el) => {
                      if (el) fieldRefs.current.set(id, el);
                    }}
                    id={fieldId}
                    inputMode="decimal"
                    autoComplete="off"
                    aria-label={words.amountFor(categoryLabel(id))}
                    aria-describedby={cx(error && errorId, average != null && average > 0 && hintId) || undefined}
                    invalid={!!error}
                    value={values[id] ?? ''}
                    onChange={(e) => {
                      const text = e.target.value;
                      setValues((v) => ({ ...v, [id]: text }));
                      setDirty(true);
                      if (error) setErrors((prev) => ({ ...prev, [id]: undefined }));
                    }}
                    onBlur={(e) => {
                      if (e.currentTarget.value.trim()) check(id, e.currentTarget.value);
                    }}
                    // Enter saves, as in any form.
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        save();
                      }
                    }}
                    className="amount text-right text-[20px] font-semibold"
                    trailing={<span aria-hidden className="pr-2.5 text-[17px] font-semibold text-ink-3">{currencyMark(currency)}</span>}
                  />
                </div>
              </div>
              {error && (
                <p id={errorId} className="mt-1.5 flex items-start justify-end gap-1.5 text-[13.5px] leading-snug font-semibold text-red">
                  <AlertTriangleIcon size={16} className="mt-px shrink-0" />
                  <span>{errorText(error)}</span>
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[13px] leading-snug text-ink-3">
        {sessionOnly ? t.transactions.categorize.sessionOnly : words.private}
      </p>
    </Dialog>
  );
}
