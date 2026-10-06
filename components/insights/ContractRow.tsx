'use client';

// One detected recurring series as a row of the Verträge list: who, how often,
// what it costs, when it is due next — and, folded open, the bookings the
// guess was made from, so a "monatlich, 12,99 €" can be checked against the
// evidence instead of taken on trust.

import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useFints } from '../FintsProvider';
import { CategoryIcon, ChevronIcon, ClockIcon, EyeOffIcon, MoreIcon, ReceiptIcon, UndoIcon } from '../icons';
import { Money } from '../Money';
import { Button, IconButton, Menu, MenuItem, Tag, cx } from '../ui';
import { categoryLabel } from '@/lib/categories';
import { dayKey, displayName, fmtIban } from '@/lib/format';
import { msgs } from '@/lib/i18n';
import { rich, useT } from '@/lib/i18n/react';
import type { RecurringSeries } from '@/lib/recurring';
import {
  CounterpartyAvatar, RoundMoney, daysUntil, fmtDayKey, fmtDayKeyShort, focusAfterRemoval, relativeDays, useShowInList,
} from './shared';

/** The column template shared by the header and every row from `md` up. */
export const CONTRACT_COLUMNS = 'md:grid md:grid-cols-[minmax(0,1fr)_12rem_8.5rem_7.5rem] md:items-center md:gap-4';

/** `next` names the second column — "Nächste Buchung" unless given. */
export function ContractListHeader({ next }: { next?: string }) {
  const t = useT();
  const columns = t.insights.contracts.columns;
  return (
    <div aria-hidden className="hidden border-b border-line pr-11 pb-2 pl-6 text-[12.5px] font-semibold text-ink-3 md:block">
      <div className={CONTRACT_COLUMNS}>
        <span>{columns.contract}</span>
        <span>{next ?? columns.next}</span>
        <span className="text-right">{t.common.booking.amount}</span>
        <span className="text-right">{columns.perYear}</span>
      </div>
    </div>
  );
}

const name = (s: RecurringSeries) => displayName(s.name) || msgs().insights.contracts.unknown;

/** Where a series stands: its next expected booking, or why there is none. */
function DueText({ s, compact }: { s: RecurringSeries; compact?: boolean }) {
  const due = useT().insights.contracts.due;
  if (s.ended) {
    return compact
      ? <>{due.endedCompact(fmtDayKey(s.lastDate))}</>
      : (
        <>
          <span className="block text-[14px] text-ink">{due.last(fmtDayKey(s.lastDate))}</span>
          <span className="block text-[13px] text-ink-3">{due.ended}</span>
        </>
      );
  }
  if (s.overdue) {
    return compact
      ? <>{due.overdueCompact(fmtDayKey(s.nextDate))}</>
      : (
        <>
          <span className="inline-flex items-center gap-1 text-[14px] text-ink">
            <ClockIcon size={14} className="text-ink-3" /> {fmtDayKey(s.nextDate)}
          </span>
          <span className="block text-[13px] text-ink-3">{due.overdue}</span>
        </>
      );
  }
  // Due a few days ago and not late enough to call overdue (a weekend, or a
  // date past the end of the loaded bookings): "voraussichtlich, vor 2 Tagen"
  // would read as a forecast of the past. Say what is known instead.
  if (daysUntil(s.nextDate) < 0) {
    return compact
      ? <>{due.missingCompact(fmtDayKey(s.nextDate))}</>
      : (
        <>
          <span className="tnum block text-[14px] text-ink">{fmtDayKey(s.nextDate)}</span>
          <span className="block text-[13px] text-ink-3">{due.missing}</span>
        </>
      );
  }
  return compact
    ? <>{due.expectedCompact(fmtDayKey(s.nextDate))}</>
    : (
      <>
        <span className="tnum block text-[14px] text-ink">{fmtDayKey(s.nextDate)}</span>
        <span className="block text-[13px] text-ink-3">{due.expected(relativeDays(s.nextDate))}</span>
      </>
    );
}

export function ContractRow({
  s, onDismiss, account = null,
}: {
  s: RecurringSeries;
  onDismiss: (s: RecurringSeries) => void;
  /** The account it is paid from (or into) — named when the list spans several. */
  account?: string | null;
}) {
  const { categoryOf } = useFints();
  const t = useT();
  const words = t.insights.contracts;
  const showInList = useShowInList();
  const [open, setOpen] = useState(false);
  const rowRef = useRef<HTMLLIElement>(null);
  const detailId = useId();
  const n = name(s);
  const credit = s.kind === 'income';
  const rose = s.changed && (s.change ?? 0) > 0 && !s.variable;
  const show = () => showInList(s.transactions[0] ?? null, { query: s.iban ? fmtIban(s.iban) : s.name, dir: credit ? 'in' : 'out' });
  const dismiss = () => {
    focusAfterRemoval(rowRef.current);
    onDismiss(s);
  };

  // A fixed price exactly; an amount that varies as "ca." in whole euros —
  // cents would claim a precision the estimate does not have.
  const amount = s.variable ? (
    <>
      <span className="mr-1 text-[13px] font-normal text-ink-3">{t.insights.approx}</span>
      <RoundMoney value={s.amount} currency={s.currency} signed className={cx('font-semibold', credit && 'text-green')} />
    </>
  ) : (
    <Money value={s.amount} currency={s.currency} signed tone="credit" className="font-semibold" />
  );

  return (
    <li ref={rowRef} className="border-b border-line last:border-b-0">
      <div className="flex items-start pr-4 transition-colors duration-150 hover:bg-inset sm:pr-6 md:items-center md:pr-3">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailId}
          onClick={() => setOpen((o) => !o)}
          className={cx('row-focus min-w-0 flex-1 py-3 pl-4 text-left sm:pl-6', CONTRACT_COLUMNS)}
        >
          {/* Who, how often. The chevron says the row opens: the bookings
              the guess rests on are behind it. */}
          <span className="flex min-w-0 items-start gap-3 md:items-center">
            <ChevronIcon className="chev -mr-1 shrink-0 self-center text-ink-3" data-open={open} />
            <CounterpartyAvatar tx={s.transactions[0]} name={n} credit={credit} />
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-baseline justify-between gap-3">
                <span className="truncate text-[15px] font-semibold text-ink">{n}</span>
                {/* Phones: the amount rides on the name line. */}
                <span className="shrink-0 text-[15px] md:hidden">{amount}</span>
              </span>
              {/* Phones trade the category (it is in the folded-open details) for
                  the yearly figure, which is what the row is there to tell. */}
              <span className="block truncate text-[13px] text-ink-3">
                {s.cadenceLabel}
                <span className="md:hidden">
                  {' · '}
                  {rich(words.perYear(<RoundMoney value={Math.abs(s.yearlyAmount)} currency={s.currency} />))}
                </span>
                <span className="hidden md:inline">
                  <span aria-hidden> · </span>
                  <span className="sr-only">, </span>
                  {categoryLabel(s.category)}
                  {account && <> · {account}</>}
                </span>
              </span>
              <span className="mt-0.5 block text-[13px] text-ink-2 md:hidden">
                <DueText s={s} compact />
              </span>
              {rose && (
                <span className="mt-1.5 flex">
                  <Tag tone="emphasis" size="sm">
                    {rich(words.rose(<Money value={s.change ?? 0} currency={s.currency} signed tone="plain" />))}
                  </Tag>
                </span>
              )}
            </span>
          </span>

          {/* Columns from md up. Their header is visual only, so each cell
              says what it is to a screen reader. */}
          <span className="hidden md:block">
            <span className="sr-only">{credit ? words.columns.nextIncoming : words.columns.next}: </span>
            <DueText s={s} />
          </span>
          <span className="hidden text-right md:block">
            <span className="sr-only">{t.common.booking.amount}: </span>
            <span className="block text-[15px]">{amount}</span>
            <span className="block text-[13px] text-ink-3">{words.lastShort(fmtDayKeyShort(s.lastDate))}</span>
          </span>
          <span className="hidden text-right md:block">
            <span className="sr-only">{words.columns.perYear}: </span>
            <RoundMoney value={Math.abs(s.yearlyAmount)} currency={s.currency} className="text-[15px] text-ink" />
          </span>
        </button>

        {/* On phones the row itself opens the actions (see the details below),
            which gives the name and figures the menu's column back. */}
        <span className="hidden shrink-0 md:block">
          <Menu
            placement="bottom-end"
            label={words.actionsFor(n)}
            trigger={(p) => (
              <IconButton {...p} aria-label={words.actionsFor(n)}>
                <MoreIcon size={18} />
              </IconButton>
            )}
          >
            <MenuItem icon={<ReceiptIcon size={18} />} onSelect={show}>{t.insights.bookings.show}</MenuItem>
            <MenuItem
              icon={<EyeOffIcon size={18} />}
              description={words.dismissHint}
              onSelect={dismiss}
            >
              {words.dismiss}
            </MenuItem>
          </Menu>
        </span>
      </div>

      <div id={detailId} hidden={!open} className="bg-inset px-4 pt-3 pb-4 sm:px-6 md:pl-[4.75rem]">
        {open && (
          <>
            <p className="text-[13px] text-ink-2">
              <span className="md:hidden">{categoryLabel(s.category)} · </span>
              {words.since(s.count, fmtDayKey(s.firstDate))}
              {s.directDebit && ` · ${words.byDirectDebit}`}
              {s.variable && ` · ${words.varies}`}
              {account && <span className="md:hidden"> · {account}</span>}
              {rose && s.previousAmount != null && (
                <> · {rich(words.before(<Money value={Math.abs(s.previousAmount)} currency={s.currency} tone="plain" />))}</>
              )}
            </p>
            {/* What a dispute or a blocked Lastschrift at the bank asks for. */}
            {(s.creditorId || s.mandateReference) && (
              <dl className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
                {s.creditorId && (
                  <div className="flex gap-1.5">
                    <dt className="text-ink-3">{t.common.booking.creditorId}</dt>
                    <dd className="iban text-ink">{s.creditorId}</dd>
                  </div>
                )}
                {s.mandateReference && (
                  <div className="flex min-w-0 gap-1.5">
                    <dt className="shrink-0 text-ink-3">{words.mandate}</dt>
                    <dd className="iban min-w-0 truncate text-ink">{s.mandateReference}</dd>
                  </div>
                )}
              </dl>
            )}
            <ol className="mt-2 grid max-w-[40rem] gap-x-8 sm:grid-cols-2">
              {s.transactions.slice(0, 6).map((tx, i) => {
                // A booking filed differently from the series (a one-off the user
                // re-categorised) says so; the rest would only repeat the same icon.
                const cat = categoryOf(tx).id;
                return (
                  <li key={`${dayKey(tx.entryDate)}|${i}`} className="flex items-baseline justify-between gap-3 border-b border-line py-1.5 text-[14px]">
                    <span className="tnum text-ink-2">{fmtDayKey(dayKey(tx.entryDate || tx.valueDate))}</span>
                    <span className="inline-flex items-center gap-2">
                      {cat !== s.category && (
                        <span className="inline-flex items-center gap-1 text-[12.5px] text-ink-3">
                          <CategoryIcon id={cat} size={14} /> {categoryLabel(cat)}
                        </span>
                      )}
                      <Money value={tx.amount} currency={tx.currency} signed tone="credit" />
                    </span>
                  </li>
                );
              })}
            </ol>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={show}>{t.insights.bookings.show}</Button>
              <Button size="sm" variant="tertiary" onClick={dismiss}>{words.dismiss}</Button>
            </div>
          </>
        )}
      </div>
    </li>
  );
}

/** A series the user set aside, with the way back. */
export function DismissedRow({ s, onRestore }: { s: RecurringSeries; onRestore: (s: RecurringSeries) => void }) {
  const t = useT();
  const n = name(s);
  const rowRef = useRef<HTMLLIElement>(null);
  return (
    <li ref={rowRef} className="flex items-center gap-3 border-b border-line py-2.5 pr-3 pl-4 last:border-b-0 sm:pl-6">
      <CounterpartyAvatar tx={s.transactions[0]} name={n} size={32} credit={s.kind === 'income'} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-ink">{n}</span>
        {/* The amount first: when a narrow screen has to cut the line, it
            cuts the rhythm's word, never the figure. */}
        <span className="block truncate text-[13px] text-ink-3">
          <Money value={s.amount} currency={s.currency} signed tone="plain" /> · {s.cadenceLabel}
        </span>
      </span>
      <Button
        size="xs"
        variant="tertiary"
        // The arrow only where there is room: on a phone its column is worth
        // more to the name beside it than to the button.
        iconLeft={<UndoIcon size={15} className="hidden sm:block" />}
        onClick={() => {
          focusAfterRemoval(rowRef.current);
          onRestore(s);
        }}
      >
        {/* The name is computed from this text, so it starts with what the
            button visibly says — "Wieder anzeigen" works as a voice command —
            and only then says which series. */}
        {t.insights.contracts.restore}<span className="sr-only">{t.insights.contracts.restoreWhich(n)}</span>
      </Button>
    </li>
  );
}

/** A titled group of rows inside one tile. */
export function ContractGroup({
  title, subtitle, children, headerNext,
}: { title: ReactNode; subtitle?: ReactNode; children: ReactNode; headerNext?: string }) {
  const id = useId();
  return (
    <section className="panel overflow-hidden" aria-labelledby={id}>
      <div className="px-4 pt-4 pb-3 sm:px-6 sm:pt-5">
        <h2 id={id} className="section-head">{title}</h2>
        {subtitle && <div className="mt-0.5 text-[13px] text-ink-3">{subtitle}</div>}
      </div>
      <ContractListHeader next={headerNext} />
      <ul>{children}</ul>
    </section>
  );
}
