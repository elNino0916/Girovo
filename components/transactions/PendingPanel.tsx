'use client';

import { useCallback, useId, useMemo, useState } from 'react';
import { filterTransactions } from '@/lib/analytics';
import type { SerializedTransaction } from '@/lib/fints-types';
import { useT } from '@/lib/i18n/react';
import { useFints } from '../FintsProvider';
import { ClockIcon, RefreshIcon } from '../icons';
import { Money } from '../Money';
import { Button, IconButton, Spinner } from '../ui';
import { fmtSince } from '../shell/session';
import { merchantFor, newestFirst, rowKey, searchText } from './model';
import { TxDetailHost, openTxDetail } from './detail-host';
import { activeFilterCount } from './TxFilterBar';
import { TxRow, TxRowSkeleton } from './TxRow';

/** Rows shown before "Alle anzeigen" — the panel shares a column with other tiles. */
const PREVIEW_ROWS = 4;

/** The panel's DOM id — "Außerdem passt 1 vorgemerkter Umsatz" in the Umsätze list leads here. */
export const PENDING_PANEL_ID = 'vorgemerkt';

/**
 * Brings the Vorgemerkt panel into view with focus on the first row that
 * matches the Umsätze filter (the panel's heading when none is shown).
 */
export function showPendingMatches(): void {
  const panel = document.getElementById(PENDING_PANEL_ID);
  if (!panel) return;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  panel.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  const target = panel.querySelector<HTMLElement>('[data-pending-match] [data-tx-row]') ?? panel.querySelector<HTMLElement>('h2');
  if (target && !target.matches('button, [tabindex]')) target.setAttribute('tabindex', '-1');
  target?.focus({ preventScroll: true });
}

/**
 * Vorgemerkte Umsätze: bookings the bank knows about but has not booked yet —
 * an announced Lastschrift, a card payment still being cleared.
 *
 * They come one of two ways. A bank with HKVMK (`canPending`) lists them on
 * request only, never on its own: for many banks that is a second approval
 * on top of the statement, and an approval nobody asked for is a prompt on
 * the phone that makes no sense. Others — Sparkassen — send them beside the
 * Umsätze, so they arrive with every statement read and there is nothing
 * extra to fetch; the panel appears once such a list has come. Amber is the
 * colour of "vorgemerkt", and this panel is the one place it appears.
 *
 * Vorgemerkte never join the Umsätze list (they would count in its sums and
 * its CSV, and twice once booked), but its search reaches them here: while
 * the list is narrowed, the rows that match it come first and say so.
 */
export function PendingPanel() {
  const {
    activeAccount: a, pendingCache, pendingInfo, pendingLoading, loadPending, busy, merchants, txFilter, categoryOf,
    pendingErrors,
  } = useFints();
  // `tr`, not `t`: here `t` is a booking.
  const tr = useT();
  const words = tr.transactions.pending;
  const [expanded, setExpanded] = useState(false);
  const titleId = useId();
  const onOpen = useCallback((tx: SerializedTransaction) => openTxDetail(tx, true), []);

  const cached = a ? pendingCache[a.accountNumber] : undefined;
  const fetched = a ? pendingInfo[a.accountNumber] : undefined;
  // A new context on a change of language: the search caches each booking's
  // text per context, and that text holds what the rows show in words.
  const searchCtx = useMemo(() => ({ categoryOf, shownText: searchText }), [categoryOf, tr]);
  const narrowed = activeFilterCount(txFilter) > 0;
  // The rows the Umsätze filter matches, first — the rest after them.
  const { txs, matches } = useMemo(() => {
    const all = cached ? newestFirst(cached) : [];
    if (!narrowed || !all.length) return { txs: all, matches: new Set<SerializedTransaction>() };
    const hit = new Set(filterTransactions(all, txFilter, searchCtx));
    return { txs: [...all.filter((t) => hit.has(t)), ...all.filter((t) => !hit.has(t))], matches: hit };
  }, [cached, narrowed, txFilter, searchCtx]);
  const currency = a?.currency || 'EUR';
  // One currency only — a Vormerkposten in another is listed, not summed.
  const sum = useMemo(() => {
    let c = 0;
    for (const t of txs) if ((t.currency || 'EUR') === currency) c += Math.round(t.amount * 100);
    return c / 100;
  }, [txs, currency]);

  // Without HKVMK there is nothing to ask for: only a list the bank sent with the Umsätze.
  if (!a || (!a.canPending && !cached)) return null;
  const onRequest = a.canPending;

  const loading = pendingLoading === a.accountNumber;
  // A failed fetch is said here, where the list would be — not only in a toast.
  const failure = loading ? undefined : pendingErrors[a.accountNumber];
  const shown = expanded ? txs : txs.slice(0, PREVIEW_ROWS);
  const load = () => void loadPending(a);

  return (
    <>
      <section id={PENDING_PANEL_ID} aria-labelledby={titleId} aria-busy={loading || undefined} className="panel scroll-mt-4 overflow-clip">
        <div className="flex items-start gap-3 px-4 pt-4 pb-4 sm:px-5">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-amber-soft text-amber">
            <ClockIcon size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="section-head">{tr.common.booking.pending}</h2>
            {cached && !loading ? (
              <>
                <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-[13.5px] text-ink-2">
                  <span className="tnum">
                    {txs.length === 0
                      ? (fetched?.booked ? words.allBooked : words.none)
                      : tr.transactions.count(txs.length)}
                  </span>
                  {txs.length > 0 && (
                    <>
                      <span aria-hidden className="text-ink-3">·</span>
                      <span>
                        <span className="sr-only">{tr.transactions.sum} </span>
                        <Money value={sum} currency={currency} signed tone="plain" className="font-semibold text-ink" />
                      </span>
                    </>
                  )}
                </p>
                {/* Only as fresh as its last read — on request (it can take
                    a TAN) or with the Umsätze — so it says how fresh it is,
                    and, when the bookings beside it are newer, that too.
                    What those show as booked has already left this list. */}
                {fetched && (
                  <p className="mt-0.5 text-[12.5px] leading-snug text-ink-3">
                    <span className="tnum">{words.asOf(fmtSince(fetched.loadedAt))}</span>
                    {fetched.behindStatement && words.behindStatement}
                    {fetched.behindStatement && fetched.booked > 0 && txs.length > 0 && ` · ${words.bookedSince(fetched.booked)}`}
                  </p>
                )}
                {matches.size > 0 && (
                  <p className="mt-0.5 text-[12.5px] leading-snug font-semibold text-ink-2">
                    {words.matches(matches.size)}
                  </p>
                )}
                {failure && (
                  <p className="mt-1 text-[12.5px] leading-snug text-ink-2">
                    <span className="font-semibold text-red">{tr.common.fetchFailed}:</span> {failure.message}
                  </p>
                )}
              </>
            ) : failure ? (
              <p className="mt-0.5 text-[13.5px] font-semibold text-red">{tr.common.fetchFailed}</p>
            ) : (
              <p className="mt-0.5 text-[13.5px] text-ink-3">{loading ? words.loadingShort : tr.transactions.notFetched}</p>
            )}
          </div>
          {cached && onRequest && (
            <IconButton
              aria-label={`${words.refresh} ${tr.transactions.mayNeedApproval}`}
              title={`${tr.transactions.refresh}. ${tr.transactions.mayNeedApproval}`}
              disabled={busy}
              onClick={load}
              className="-mt-0.5 -mr-1.5"
            >
              {loading ? <Spinner size={15} /> : <RefreshIcon size={17} />}
            </IconButton>
          )}
        </div>

        {loading ? (
          <div className="border-t border-line">
            <TxRowSkeleton compact width={56} />
            <TxRowSkeleton compact width={42} />
            <span className="sr-only" role="status">{words.loading}</span>
          </div>
        ) : !cached ? (
          <div className="px-4 pb-4 sm:px-5">
            <p className="text-[14px] leading-relaxed text-ink-2">
              {failure ? failure.message : words.intro} {tr.transactions.mayNeedApproval}
            </p>
            <Button size="sm" variant="secondary" className="mt-3" disabled={busy} onClick={load}>
              {failure ? tr.common.retry : words.fetch}
            </Button>
          </div>
        ) : txs.length === 0 ? null : (
          <>
            <ul className="border-t border-line">
              {shown.map((tx) => (
                <li
                  key={rowKey(tx)}
                  data-pending-match={matches.has(tx) || undefined}
                  className="relative after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:left-[68px] after:h-px after:bg-line last:after:hidden"
                >
                  <TxRow tx={tx} merchant={merchantFor(merchants, tx)} pending compact onOpen={onOpen} />
                </li>
              ))}
            </ul>
            {txs.length > PREVIEW_ROWS && (
              <div className="border-t border-line px-2 py-1.5">
                <Button size="sm" variant="tertiary" block aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
                  {expanded ? words.showLess : words.showAll(txs.length)}
                </Button>
              </div>
            )}
          </>
        )}
      </section>
      <TxDetailHost fallback />
    </>
  );
}
