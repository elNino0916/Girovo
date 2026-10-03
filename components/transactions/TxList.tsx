'use client';

import { useEffect, useRef, useState } from 'react';
import type { CategoryId } from '@/lib/categories';
import type { Merchant, SerializedTransaction } from '@/lib/fints-types';
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
 * the page's scroll container while that day is scrolled through, carrying
 * the day's net so the reader never loses which day a row belongs to.
 *
 * `resetKey` names the current list (account, loaded range, filter): a new
 * list starts from the first page again.
 */
export function TxList({
  id, groups, total, resetKey, merchantOf, categoryOf, onOpen,
}: {
  id: string;
  groups: DayGroup[];
  total: number;
  resetKey: string;
  merchantOf: (tx: SerializedTransaction) => Merchant | null;
  categoryOf: (tx: SerializedTransaction) => { id: CategoryId };
  onOpen: (tx: SerializedTransaction) => void;
}) {
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

  let budget = limit;
  const visible: DayGroup[] = [];
  for (const g of groups) {
    if (budget <= 0) break;
    visible.push(budget >= g.txs.length ? g : { ...g, txs: g.txs.slice(0, budget) });
    budget -= g.txs.length;
  }
  const rest = total - Math.min(total, limit);

  return (
    <div id={id} ref={rootRef}>
      {visible.map((g) => (
        <section key={g.key} aria-labelledby={`${id}-${g.key}`}>
          <div className="sticky top-0 z-5 flex min-h-9 items-center gap-2 bg-inset px-4 py-1.5 sm:px-5">
            <h3 id={`${id}-${g.key}`} className="shrink-0 text-[13.5px] leading-snug font-semibold text-ink-2">
              {g.label}
            </h3>
            {g.future && (
              <span
                className="inline-flex min-w-0 items-center gap-1 text-[12.5px] font-semibold text-ink-3"
                title="Diese Buchungen tragen einen Buchungstag in der Zukunft — die Bank verbucht sie erst an diesem Tag."
              >
                <ClockIcon size={13} />
                {/* On a phone the clock alone; the rows below say "Buchung 05.10." anyway. */}
                <span className="truncate max-sm:sr-only">noch nicht gebucht</span>
              </span>
            )}
            {g.net !== null && (
              <span className="ml-auto shrink-0 text-[13px] text-ink-3" title="Summe des Tages">
                <span className="sr-only">Summe des Tages: </span>
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
            Weitere {Math.min(rest, MORE_PAGE)} anzeigen
          </Button>
          <span className="tnum text-[13px] text-ink-3">
            {total - rest} von {total} angezeigt
          </span>
        </div>
      )}
    </div>
  );
}
