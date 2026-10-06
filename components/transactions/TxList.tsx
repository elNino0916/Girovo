'use client';

import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import type { CategoryId } from '@/lib/categories';
import type { Merchant, SerializedTransaction } from '@/lib/fints-types';
import { useT } from '@/lib/i18n/react';
import { Money } from '../Money';
import { ClockIcon } from '../icons';
import { Button } from '../ui';
import { rowKey, type DayGroup } from './model';
import { TxRow } from './TxRow';

/**
 * How many rows go into the DOM at first. A year of a busy Girokonto is well
 * over a thousand bookings; rendering them all would make every filter change
 * and every provider update pay for rows nobody has scrolled to. Fifty is
 * a few weeks of an ordinary account — more than one screen, and what most
 * visits look at.
 */
export const FIRST_PAGE = 50;

/** How many more each "Weitere … anzeigen" adds — someone who asks for more usually wants a good deal more. */
export const MORE_PAGE = 100;

/**
 * The bookings, one section per day. Each day's header sticks to the top of
 * the page's scroll container while that day is scrolled through, so the
 * reader never loses which day a row belongs to. It carries, labelled, the
 * Kontostand at the end of that day when the bank's own balances prove it
 * (lib/balance-history.ts) — the figure a right-aligned number in a date row
 * is read as — and otherwise the day's sum of the rows shown.
 *
 * `resetKey` names the current list (account, loaded range, filter): a new
 * list starts from the first page again.
 */
export function TxList({
  id, groups, total, resetKey, merchantOf, categoryOf, onOpen, balanceOn = null,
}: {
  id: string;
  groups: DayGroup[];
  total: number;
  resetKey: string;
  merchantOf: (tx: SerializedTransaction) => Merchant | null;
  categoryOf: (tx: SerializedTransaction) => { id: CategoryId };
  onOpen: (tx: SerializedTransaction) => void;
  /** The verified end-of-day balance per local day, when the bank's balances prove one. */
  balanceOn?: { byDay: ReadonlyMap<string, number>; currency: string; card?: boolean } | null;
}) {
  const t = useT();
  const words = t.transactions.days;
  // Derived rather than reset in an effect: a stale page count never renders.
  const [page, setPage] = useState({ key: resetKey, rows: FIRST_PAGE });
  const limit = page.key === resetKey ? page.rows : FIRST_PAGE;

  // After "Weitere … anzeigen", focus moves to the first of the added rows —
  // where the button was — so a keyboard user carries on reading instead of
  // landing on a button that has jumped a hundred rows down.
  const rootRef = useRef<HTMLDivElement>(null);
  const focusRow = useRef<number | null>(null);
  useEffect(() => {
    const i = focusRow.current;
    if (i === null) return;
    focusRow.current = null;
    rootRef.current?.querySelectorAll<HTMLElement>('[data-tx-row]')[i]?.focus({ preventScroll: true });
  }, [limit]);

  // Every row is a Tab stop, the way an online-banking Umsatzliste works —
  // so the list starts with a way past it. It appears only once focused, and
  // puts the next Tab after the last row shown.
  const endRef = useRef<HTMLSpanElement>(null);
  const skipList = (e: MouseEvent) => {
    e.preventDefault();
    endRef.current?.scrollIntoView({ block: 'center' });
    endRef.current?.focus({ preventScroll: true });
  };

  let budget = limit;
  const visible: DayGroup[] = [];
  for (const g of groups) {
    if (budget <= 0) break;
    visible.push(budget >= g.txs.length ? g : { ...g, txs: g.txs.slice(0, budget) });
    budget -= g.txs.length;
  }
  const rest = total - Math.min(total, limit);

  return (
    <div id={id} ref={rootRef} className="relative">
      <a
        href={`#${id}-end`}
        onClick={skipList}
        // not-sr-only also zeroes the padding; the pill gets it back. Above
        // the sticky day band it would otherwise sit under.
        className="sr-only rounded-full bg-accent text-[13.5px] font-semibold text-accent-ink focus:not-sr-only focus:absolute focus:top-1 focus:left-3 focus:z-10 focus:px-4! focus:py-1.5! focus:whitespace-nowrap"
      >
        {words.skip}
      </a>
      {visible.map((g) => (
        <section key={g.key} aria-labelledby={`${id}-${g.key}`}>
          <div className="sticky top-0 z-5 flex min-h-9 items-center gap-2 bg-inset px-4 py-1.5 sm:px-5">
            <h3 id={`${id}-${g.key}`} className="shrink-0 text-[13.5px] leading-snug font-semibold text-ink-2">
              {g.label}
            </h3>
            {g.future && (
              <span
                className="inline-flex min-w-0 items-center gap-1 text-[12.5px] font-semibold text-ink-3"
                title={words.future}
              >
                <ClockIcon size={13} />
                {/* On a phone the clock alone; the rows below say "Buchung 05.10." anyway. */}
                <span className="truncate max-sm:sr-only">{t.transactions.state.ahead}</span>
              </span>
            )}
            {balanceOn ? (
              // Days the proof does not reach (a Buchungstag still ahead) carry none.
              balanceOn.byDay.has(g.key) && (
                <span className="ml-auto shrink-0 text-[13px] text-ink-3">
                  <span className="sm:hidden" aria-hidden>{words.balanceShort} </span>
                  <span className="max-sm:sr-only">{t.common.account.balance} </span>
                  <span className="sr-only">{words.endOfDay} </span>
                  {/* A balance: red when below zero, like every balance (Money's "auto") —
                      a credit card's is negative by nature and stays ink. */}
                  <span className="font-semibold text-ink-2">
                    <Money value={balanceOn.byDay.get(g.key)!} currency={balanceOn.currency} tone={balanceOn.card ? 'plain' : 'auto'} />
                  </span>
                </span>
              )
            ) : g.net !== null && (
              <span className="ml-auto shrink-0 text-[13px] text-ink-3">
                <span aria-hidden>{t.transactions.sum} </span>
                <span className="sr-only">{words.dayTotal} </span>
                <Money value={g.net} currency={g.currency} signed tone="plain" className="font-semibold" />
              </span>
            )}
          </div>
          <ul>
            {g.txs.map((tx) => (
              // Inset hairlines that start where the text does — the avatar
              // column reads as one, the way a printed statement's date column does.
              <li
                key={rowKey(tx)}
                className="relative after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:left-[68px] after:h-px after:bg-line last:after:hidden sm:after:left-[72px]"
              >
                <TxRow tx={tx} merchant={merchantOf(tx)} category={categoryOf(tx).id} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {/* Where "Liste überspringen" leads: after the last row shown, before
          the way to show more. */}
      <span id={`${id}-end`} ref={endRef} tabIndex={-1} className="sr-only">
        {words.end}{rest > 0 ? `, ${words.shownOf(total - rest, total)}` : ''}
      </span>

      {rest > 0 && (
        <div className="flex flex-col items-center gap-1 border-t border-line px-4 py-5">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              focusRow.current = limit;
              setPage({ key: resetKey, rows: limit + MORE_PAGE });
            }}
          >
            {words.more(Math.min(rest, MORE_PAGE))}
          </Button>
          <span className="tnum text-[13px] text-ink-3">
            {words.shownOf(total - rest, total)}
          </span>
        </div>
      )}
    </div>
  );
}
