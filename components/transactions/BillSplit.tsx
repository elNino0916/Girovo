'use client';

// Aufteilen (owner's pick "Anteile als Balken", 2026-10-24): a booking's
// amount shared between the user and others, each asked for their part with
// Geld anfordern, one after the other (lib/bill-split.ts counts in cents).
//
// A full-screen dialog on the phone. At its head the booking; then the shares
// as one bar — the user's own in the outline tone, everyone else's in the
// chart slots by order — with a chip per person under it. A chosen chip opens
// that person's name and share for editing in place; the user's own share is
// always what is left, so the shares add up by construction, and shares that
// ask for more than the booking stop the requests until they are fixed.
// "Alle anfordern" closes the booking and opens Geld anfordern for each
// person in turn, their amount and the purpose filled in.

import { useId, useMemo, useRef, useState } from 'react';
import { canRequest, resplit, type SplitPerson } from '@/lib/bill-split';
import type { SharePrefill } from '@/lib/app-types';
import { fmtAmountInput, parseAmount } from '@/lib/format';
import { useT } from '@/lib/i18n/react';
import { Money } from '../Money';
import { AlertTriangleIcon, CheckCircleIcon, PlusIcon, QrIcon } from '../icons';
import { Panel } from '../transfer/Panel';
import { Button, Field, FilterChip, Input, Overlay, cx } from '../ui';

/** The purpose's limit: a SEPA remittance line. */
const MAX_PURPOSE = 140;

/** The bar's and the dots' colour for the share at `index` (the user's own is -1). */
const tone = (index: number) => (index < 0 ? 'var(--md-outline)' : `var(--chart-${(index % 6) + 1})`);

export function BillSplit({
  name, meta, cents, glyph, defaultPurpose, onClose, onRequest,
}: {
  /** The booking's counterparty, as the row shows it. */
  name: string;
  /** "Mittwoch, 21.10. · girocard". */
  meta: string;
  /** The booking's amount in cents (its sign is ignored). */
  cents: number;
  glyph: React.ReactNode;
  defaultPurpose: string;
  onClose: () => void;
  onRequest: (list: SharePrefill[]) => void;
}) {
  const t = useT();
  const words = t.transactions.billSplit;
  const titleId = useId();
  const total = Math.abs(Math.round(cents));
  const nextId = useRef(2);
  const nameRef = useRef<HTMLInputElement>(null);
  const [people, setPeople] = useState<SplitPerson[]>([{ id: 'p1', name: '', cents: 0, typed: false }]);
  const [chosen, setChosen] = useState<string>('p1');
  const [draft, setDraft] = useState<{ id: string; text: string } | null>(null);
  const [purpose, setPurpose] = useState(defaultPurpose.slice(0, MAX_PURPOSE));

  const split = useMemo(() => resplit(total, people), [total, people]);
  const person = split.others.find((p) => p.id === chosen) ?? null;
  const index = person ? split.others.indexOf(person) : -1;
  const label = (p: SplitPerson, i: number) => p.name.trim() || words.unnamed(i + 1);

  const update = (id: string, patch: Partial<SplitPerson>) =>
    setPeople((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const add = () => {
    const id = `p${nextId.current++}`;
    setPeople((list) => [...list, { id, name: '', cents: 0, typed: false }]);
    setChosen(id);
    setDraft(null);
    requestAnimationFrame(() => nameRef.current?.focus());
  };
  const remove = (id: string) => {
    setPeople((list) => list.filter((p) => p.id !== id));
    setChosen('you');
    setDraft(null);
  };
  const equal = () => {
    setPeople((list) => list.map((p) => ({ ...p, typed: false })));
    setDraft(null);
  };
  const typeShare = (id: string, text: string) => {
    setDraft({ id, text });
    const value = parseAmount(text);
    update(id, value == null || !text.trim() ? { typed: false } : { cents: Math.round(Math.abs(value) * 100), typed: true });
  };

  const ready = canRequest(split) && !!purpose.trim();
  const names = split.others.map(label);
  const request = () => {
    if (!ready) return;
    const of = split.others.length;
    onRequest(split.others.map((p, i) => ({
      amount: fmtAmountInput(p.cents / 100),
      purpose: purpose.trim(),
      forName: label(p, i),
      step: { at: i + 1, of, ...(i + 1 < of ? { next: label(split.others[i + 1], i + 1) } : {}) },
    })));
  };
  const anyTyped = people.some((p) => p.typed);

  return (
    <Overlay open onClose={onClose} labelledBy={titleId}>
      <Panel
        titleId={titleId}
        title={words.title}
        onClose={onClose}
        footer={(
          <div className="flex flex-col gap-3">
            {ready && <p className="text-center text-[14px] leading-5 text-ink-2">{words.order(names)}</p>}
            <Button variant="primary" block iconLeft={<QrIcon size={20} />} disabled={!ready} onClick={request}>
              {words.requestAll(split.others.length)}
            </Button>
          </div>
        )}
      >
        {/* The booking being shared. */}
        <div className="flex items-center gap-4 pt-1">
          <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-full bg-inset text-ink-2">{glyph}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[16px] leading-6 font-medium text-ink">{name}</p>
            <p className="truncate text-[14px] leading-5 text-ink-2">{meta}</p>
          </div>
          <Money value={-total / 100} signed tone="credit" className="text-[18px] font-medium text-ink" />
        </div>

        <h3 className="mt-7 text-[16px] leading-6 text-ink-2">{words.who}</h3>

        {/* The shares as one bar: a picture of the split, said in words by the chips under it. */}
        <div aria-hidden className="mt-3 flex h-12 items-center gap-[3px]">
          {[{ id: 'you', cents: split.own }, ...split.others].map((p, i) => (
            <span
              key={p.id}
              className={cx(
                'min-w-3 rounded-full transition-[height,flex-grow] duration-200',
                p.id === chosen ? 'h-12' : 'h-10',
              )}
              style={{ flexGrow: Math.max(p.cents, 1), flexBasis: 0, background: tone(i - 1) }}
            />
          ))}
        </div>

        <div role="group" aria-label={words.who} className="mt-4 flex flex-wrap gap-2">
          <ShareChip
            label={words.you}
            cents={split.own}
            color={tone(-1)}
            selected={chosen === 'you'}
            onClick={() => setChosen('you')}
          />
          {split.others.map((p, i) => (
            <ShareChip
              key={p.id}
              label={label(p, i)}
              cents={p.cents}
              color={tone(i)}
              selected={chosen === p.id}
              onClick={() => { setChosen(p.id); setDraft(null); }}
            />
          ))}
          <FilterChip icon={<PlusIcon size={18} />} role="button" onBeforeInput={(e) => e.preventDefault()} onClick={add}>
            {words.person}
          </FilterChip>
        </div>

        {/* The chosen person, edited in place; the user's own share is the rest. */}
        {person ? (
          // Keyed by the person: their own fields, so a field never shows another's value under its label.
          <div key={person.id} className="mt-5">
            {/* Name and share side by side; the share's width grows with the
                phone's text zoom (app/layout.tsx), and at large text the row
                wraps, the share under the name. */}
            <div className="flex flex-wrap gap-3">
              <Field label={words.name} htmlFor={`${titleId}-name`} className="mb-0 min-w-0 flex-1 basis-48">
                <Input
                  id={`${titleId}-name`}
                  ref={nameRef}
                  value={person.name}
                  maxLength={40}
                  autoComplete="off"
                  onChange={(e) => update(person.id, { name: e.target.value })}
                />
              </Field>
              <Field label={words.share} htmlFor={`${titleId}-share`} className="mb-0 w-[calc(9rem*var(--text-zoom,1))] max-w-full shrink-0">
                <Input
                  id={`${titleId}-share`}
                  inputMode="decimal"
                  autoComplete="off"
                  value={draft?.id === person.id ? draft.text : fmtAmountInput(person.cents / 100)}
                  onChange={(e) => typeShare(person.id, e.target.value)}
                  onBlur={() => setDraft(null)}
                  className="amount text-right"
                  trailing={<span aria-hidden className="pr-2.5 text-ink-2">€</span>}
                />
              </Field>
            </div>
            <p className="mt-1.5 text-[14px] leading-5 text-ink-2">
              {words.yourShare(<Money key="own" value={split.own / 100} tone="plain" className="font-medium text-ink" />)}
            </p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <Button size="sm" variant="tertiary" className="-ml-3" onClick={() => remove(person.id)}>
                {words.remove(label(person, index))}
              </Button>
              {anyTyped && (
                <Button size="sm" variant="tertiary" className="-mr-3" onClick={equal}>{words.equal}</Button>
              )}
            </div>
          </div>
        ) : (
          <p className="mt-5 text-[14px] leading-5 text-ink-2">
            {words.youRest(<Money key="own" value={split.own / 100} tone="plain" className="font-medium text-ink" />)}
          </p>
        )}

        <Field label={words.purpose} htmlFor={`${titleId}-purpose`} className="mt-6 mb-0">
          <Input
            id={`${titleId}-purpose`}
            value={purpose}
            maxLength={MAX_PURPOSE}
            autoComplete="off"
            onChange={(e) => setPurpose(e.target.value)}
          />
        </Field>

        {/* Whether the shares hold: said in words, the colour only marks it. */}
        <p role="status" className="mt-5 flex items-center gap-2 text-[16px] leading-6 text-ink-2">
          {split.over ? (
            <>
              <AlertTriangleIcon size={22} className="shrink-0 text-red" />
              <span>{words.over(<Money key="d" value={-split.own / 100} tone="plain" className="font-medium text-ink" />)}</span>
            </>
          ) : (
            <>
              <CheckCircleIcon size={22} className="shrink-0 text-green" />
              <span>{words.sumOk(<Money key="s" value={total / 100} tone="plain" className="font-medium text-ink" />)}</span>
            </>
          )}
        </p>
      </Panel>
    </Overlay>
  );
}

/** A person's chip: their colour, their name and share; chosen, it is edited below. */
function ShareChip({ label, cents, color, selected, onClick }: {
  label: string; cents: number; color: string; selected: boolean; onClick: () => void;
}) {
  return (
    <FilterChip
      selected={selected}
      role="button"
      aria-pressed={selected}
      onBeforeInput={(e) => e.preventDefault()}
      onClick={onClick}
      icon={<span aria-hidden className="mx-1 size-2.5 rounded-full" style={{ background: color }} />}
    >
      <span className="inline-flex items-baseline gap-2">
        <span className="font-medium">{label}</span>
        <Money value={cents / 100} tone="plain" />
      </span>
    </FilterChip>
  );
}
