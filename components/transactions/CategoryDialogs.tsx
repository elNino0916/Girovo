'use client';

// The two dialogs behind the category menu (TxDetail's CategorySection):
//
//   - SplitDialog spreads one booking across categories (lib/splits.ts). The
//     first share is the rest: whatever the others leave, worked out as they
//     are typed, so the shares always add up to the booking and the only
//     thing that can go wrong is the others taking too much.
//   - CategoryNameDialog makes a category of the user's own, or renames one.
//     From a booking it files the booking under the new category at once.
//
// Both are basic dialogs with their buttons pinned below the form, and both
// change only the vault — nothing here reaches the bank.

import { useId, useMemo, useRef, useState } from 'react';
import { categoryLabel, type CategoryId, type CustomCategoryId } from '@/lib/categories';
import type { SerializedTransaction } from '@/lib/fints-types';
import { fmtAmountInput, parseAmount } from '@/lib/format';
import { rich, useT } from '@/lib/i18n/react';
import { CUSTOM_LIMITS, SPLIT_LIMITS, remainderCents, type SplitPart } from '@/lib/splits';
import { useFints } from '../FintsProvider';
import { AlertTriangleIcon, CategoryIcon, MinusIcon, PlusIcon } from '../icons';
import { Money, currencyMark } from '../Money';
import { Button, Dialog, Field, IconButton, Input, Segmented, Select, cx } from '../ui';
import { menuGroups } from './TxDetail';

// ---------------------------------------------------------------------------
// Splitting a booking
// ---------------------------------------------------------------------------

type Row = { key: number; id: CategoryId; text: string };

/** A typed share in cents: null for nothing typed, NaN for what is no amount above zero. */
function rowCents(text: string): number | null {
  if (!text.trim()) return null;
  const n = parseAmount(text);
  if (n == null) return Number.NaN;
  const c = Math.round(n * 100);
  return c > 0 && c <= SPLIT_LIMITS.cents ? c : Number.NaN;
}

export function SplitDialog({
  tx, open, onClose, onSaved,
}: {
  tx: SerializedTransaction;
  open: boolean;
  onClose: () => void;
  /** After the split is kept: how many categories it has. */
  onSaved?: (count: number) => void;
}) {
  if (!open) return null;
  return <SplitForm tx={tx} onClose={onClose} onSaved={onSaved} />;
}

function SplitForm({ tx, onClose, onSaved }: { tx: SerializedTransaction; onClose: () => void; onSaved?: (count: number) => void }) {
  const { categoryOf, setSplit, vaultStatus } = useFints();
  const t = useT();
  const words = t.transactions.split;
  const auto = useId();
  const credit = tx.amount > 0;
  const currency = tx.currency || 'EUR';
  // The menu's groups, the booking's own direction first — the user's own
  // categories among them (allCategories, read as the form opens).
  const groups = useMemo(() => menuGroups(credit, t), [credit, t]);
  const firstFree = (taken: readonly CategoryId[]) =>
    groups.flatMap((g) => g.ids).find((id) => !taken.includes(id)) ?? 'other';

  const nextKey = useRef(0);
  // Seeded once: an existing split as it stands, else the booking's category
  // as the rest and one empty share beside it.
  const [rows, setRows] = useState<Row[]>(() => {
    const current = categoryOf(tx);
    if (current.parts?.length) {
      return current.parts.map((p, i) => ({
        key: nextKey.current++,
        id: p.id,
        text: i === 0 ? '' : fmtAmountInput(Math.abs(p.amount)),
      }));
    }
    const first = current.id;
    const second = groups.flatMap((g) => g.ids).find((id) => id !== first) ?? 'other';
    return [
      { key: nextKey.current++, id: first, text: '' },
      { key: nextKey.current++, id: second, text: '' },
    ];
  });
  const [tried, setTried] = useState(false);
  const fieldRefs = useRef(new Map<number, HTMLInputElement>());

  const others = rows.slice(1).map((r) => rowCents(r.text));
  const typed = others.map((c) => (c != null && Number.isFinite(c) ? c : 0));
  const rest = remainderCents(tx.amount, typed);
  const badRow = rows.slice(1).findIndex((_, i) => others[i] == null || !Number.isFinite(others[i]!));
  const ids = rows.map((r) => r.id);
  const twice = new Set(ids).size !== ids.length;
  const problem: 'over' | 'empty' | 'twice' | null = rest <= 0 ? 'over' : badRow >= 0 ? 'empty' : twice ? 'twice' : null;

  const update = (key: number, patch: Partial<Row>) =>
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = () => {
    const key = nextKey.current++;
    setRows((list) => [...list, { key, id: firstFree(list.map((r) => r.id)), text: '' }]);
    setTimeout(() => fieldRefs.current.get(key)?.focus(), 0);
  };
  const removeRow = (key: number) => setRows((list) => list.filter((r) => r.key !== key));

  const save = () => {
    setTried(true);
    if (problem) {
      if (problem === 'empty') fieldRefs.current.get(rows[badRow + 1].key)?.focus();
      return;
    }
    const parts: SplitPart[] = [
      { id: rows[0].id, cents: rest },
      ...rows.slice(1).map((r, i) => ({ id: r.id, cents: typed[i] })),
    ];
    if (!setSplit(tx, parts)) return;
    onSaved?.(parts.length);
    onClose();
  };

  const options = (
    <>
      {groups.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.ids.map((id) => <option key={id} value={id}>{categoryLabel(id)}</option>)}
        </optgroup>
      ))}
    </>
  );
  const amountText = <Money value={Math.abs(tx.amount)} currency={currency} tone="plain" />;

  return (
    <Dialog
      open
      onClose={onClose}
      // A form with something typed into it is not closed by a stray click beside it.
      onBackdrop={() => {}}
      title={words.title}
      description={rich(words.intro(<strong className="font-semibold text-ink">{amountText}</strong>))}
      size="md"
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>{t.common.cancel}</Button>
          <Button variant="primary" onClick={save}>{words.save}</Button>
        </>
      }
    >
      <ul className="-mt-1">
        {rows.map((r, i) => {
          const selectId = `split${auto}-${r.key}-cat`;
          const fieldId = `split${auto}-${r.key}-amount`;
          const invalid = tried && i > 0 && (others[i - 1] == null || !Number.isFinite(others[i - 1]!));
          return (
            <li key={r.key} className="flex items-center gap-2 border-b border-line py-2.5 last:border-b-0">
              <span aria-hidden className="hidden size-9 shrink-0 place-items-center rounded-full bg-inset text-ink-2 sm:grid">
                <CategoryIcon id={r.id} size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <label htmlFor={selectId} className="sr-only">{words.categoryFor(i + 1)}</label>
                <Select id={selectId} value={r.id} onChange={(e) => update(r.key, { id: e.target.value as CategoryId })}>
                  {options}
                </Select>
              </div>
              <div className="w-[8.5rem] shrink-0 sm:w-[9.5rem]">
                {i === 0 ? (
                  // The rest is worked out, never typed: what the others leave.
                  <div className="flex h-12 flex-col items-end justify-center pr-1" aria-live="polite">
                    <span className={cx('amount text-[20px] font-semibold', rest <= 0 ? 'text-red' : 'text-ink')}>
                      <Money value={rest / 100} currency={currency} tone="plain" />
                    </span>
                    <span className="text-[12.5px] leading-tight text-ink-3">{words.rest}</span>
                  </div>
                ) : (
                  <Input
                    ref={(el) => {
                      if (el) fieldRefs.current.set(r.key, el);
                      else fieldRefs.current.delete(r.key);
                    }}
                    id={fieldId}
                    inputMode="decimal"
                    autoComplete="off"
                    aria-label={words.amountFor(categoryLabel(r.id))}
                    invalid={invalid}
                    value={r.text}
                    onChange={(e) => update(r.key, { text: e.target.value })}
                    onBlur={(e) => {
                      const c = rowCents(e.currentTarget.value);
                      if (c != null && Number.isFinite(c)) update(r.key, { text: fmtAmountInput(c / 100) });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        save();
                      }
                    }}
                    className="amount text-right text-[20px] font-semibold"
                    trailing={<span aria-hidden className="pr-2.5 text-[17px] font-semibold text-ink-3">{currencyMark(currency)}</span>}
                  />
                )}
              </div>
              {i > 0 && rows.length > 2 ? (
                <IconButton aria-label={words.removePart(categoryLabel(r.id))} onClick={() => removeRow(r.key)}>
                  <MinusIcon size={18} />
                </IconButton>
              ) : (
                <span aria-hidden className="size-8 shrink-0" />
              )}
            </li>
          );
        })}
      </ul>
      {rows.length < SPLIT_LIMITS.parts && (
        <Button size="sm" variant="tertiary" className="mt-2 -ml-3" iconLeft={<PlusIcon size={16} />} onClick={addRow}>
          {words.addPart}
        </Button>
      )}
      {(problem === 'over' || (tried && problem)) && (
        <p role={tried ? 'alert' : undefined} className="mt-3 flex items-start gap-1.5 text-[13.5px] leading-snug font-semibold text-red">
          <AlertTriangleIcon size={16} className="mt-px shrink-0" />
          <span>
            {problem === 'over'
              ? rest === 0
                ? words.nothingLeft(categoryLabel(rows[0].id))
                : rich(words.over(<Money value={Math.abs(rest) / 100} currency={currency} tone="plain" />))
              : problem === 'twice' ? words.twice : words.emptyPart}
          </span>
        </p>
      )}
      <p className="mt-3 text-[13px] leading-snug text-ink-3">
        {vaultStatus === 'ready' ? t.budgets.budget.dialog.private : t.transactions.categorize.sessionOnly}
      </p>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// A category of the user's own
// ---------------------------------------------------------------------------

export function CategoryNameDialog({
  open, onClose, rename, direction: initialDirection = 'out', fileLabel, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  /** Renames this category instead of making a new one. */
  rename?: { id: CustomCategoryId; name: string };
  /** A new category's side, as the booking it is made from suggests. */
  direction?: 'in' | 'out';
  /** Made from a booking: the primary says it files the booking too. */
  fileLabel?: boolean;
  onCreated?: (id: CustomCategoryId, name: string) => void;
}) {
  if (!open) return null;
  return (
    <NameForm onClose={onClose} rename={rename} initialDirection={initialDirection} fileLabel={fileLabel} onCreated={onCreated} />
  );
}

function NameForm({
  onClose, rename, initialDirection, fileLabel, onCreated,
}: {
  onClose: () => void;
  rename?: { id: CustomCategoryId; name: string };
  initialDirection: 'in' | 'out';
  fileLabel?: boolean;
  onCreated?: (id: CustomCategoryId, name: string) => void;
}) {
  const { addCustomCategory, renameCustomCategory, vaultStatus } = useFints();
  const t = useT();
  const words = t.transactions.custom;
  const [name, setName] = useState(rename?.name ?? '');
  const [direction, setDirection] = useState<'in' | 'out'>(initialDirection);
  const [error, setError] = useState<'empty' | 'taken' | 'full' | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const submit = () => {
    if (rename) {
      const res = renameCustomCategory(rename.id, name);
      if (res !== 'ok') {
        setError(res);
        inputRef.current?.focus();
        return;
      }
      onClose();
      return;
    }
    const res = addCustomCategory(name, direction);
    if ('error' in res) {
      setError(res.error);
      inputRef.current?.focus();
      return;
    }
    onCreated?.(res.id, name.trim());
    onClose();
  };

  const errorText = error === 'empty' ? words.empty : error === 'taken' ? words.taken : error === 'full' ? words.full(CUSTOM_LIMITS.count) : null;

  return (
    <Dialog
      open
      onClose={onClose}
      onBackdrop={name.trim() ? () => {} : undefined}
      title={rename ? words.renameTitle : words.newTitle}
      description={rename ? undefined : words.newIntro}
      initialFocus={inputRef}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>{t.common.cancel}</Button>
          <Button variant="primary" onClick={submit}>
            {rename ? t.common.save : fileLabel ? words.createAndFile : words.create}
          </Button>
        </>
      }
    >
      <Field label={words.name} error={errorText}>
        <Input
          ref={inputRef}
          value={name}
          maxLength={CUSTOM_LIMITS.name}
          autoComplete="off"
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
      </Field>
      {!rename && (
        <div className="mb-1">
          <p aria-hidden className="mb-1.5 text-[13px] leading-snug font-semibold text-ink-2">{words.kind}</p>
          <Segmented
            aria-label={words.kind}
            block
            value={direction}
            onChange={setDirection}
            options={[
              { value: 'out', label: words.kindOut },
              { value: 'in', label: words.kindIn },
            ]}
          />
        </div>
      )}
      {vaultStatus !== 'ready' && <p className="mt-3 text-[13px] leading-snug text-ink-3">{t.transactions.categorize.sessionOnly}</p>}
    </Dialog>
  );
}
