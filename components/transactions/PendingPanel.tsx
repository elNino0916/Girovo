'use client';

import { useCallback, useId, useMemo, useState } from 'react';
import { filterTransactions } from '@/lib/analytics';
import type { SerializedTransaction } from '@/lib/fints-types';
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

const TAN_NOTE = 'Kann eine Freigabe erfordern.';

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
 * Vorgemerkte Umsätze (HKVMK): bookings the bank knows about but has not
 * booked yet — an announced Lastschrift, a card payment still being cleared.
 *
 * Loaded only on request, never on its own: for many banks this is a second
 * approval on top of the statement, and an approval nobody asked for is a
 * prompt on the phone that makes no sense. Amber is the colour of
 * "vorgemerkt", and this panel is the one place it appears.
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
  const [expanded, setExpanded] = useState(false);
  const titleId = useId();
  const onOpen = useCallback((tx: SerializedTransaction) => openTxDetail(tx, true), []);

  const cached = a ? pendingCache[a.accountNumber] : undefined;
  const fetched = a ? pendingInfo[a.accountNumber] : undefined;
  const searchCtx = useMemo(() => ({ categoryOf, shownText: searchText }), [categoryOf]);
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

  if (!a?.canPending) return null;

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
            <h2 id={titleId} className="section-head">Vorgemerkt</h2>
            {cached && !loading ? (
              <>
                <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-[13.5px] text-ink-2">
                  <span className="tnum">
                    {txs.length === 0
                      ? (fetched?.booked ? 'Inzwischen alles gebucht' : 'Deine Bank meldet nichts Vorgemerktes')
                      : txs.length === 1 ? '1 Umsatz' : `${txs.length} Umsätze`}
                  </span>
                  {txs.length > 0 && (
                    <>
                      <span aria-hidden className="text-ink-3">·</span>
                      <span>
                        <span className="sr-only">Summe </span>
                        <Money value={sum} currency={currency} signed tone="plain" className="font-semibold text-ink" />
                      </span>
                    </>
                  )}
                </p>
                {/* Never re-read on its own (it can take a TAN), so it says
                    how fresh it is — and, when the bookings beside it are
                    newer, that too. What those show as booked has already
                    left this list. */}
                {fetched && (
                  <p className="mt-0.5 text-[12.5px] leading-snug text-ink-3">
                    <span className="tnum">Stand {fmtSince(fetched.loadedAt)}</span>
                    {fetched.behindStatement && ', vor dem letzten Umsatzabruf'}
                    {fetched.behindStatement && fetched.booked > 0 && txs.length > 0 && ` · ${fetched.booked} inzwischen gebucht`}
                  </p>
                )}
                {matches.size > 0 && (
                  <p className="mt-0.5 text-[12.5px] leading-snug font-semibold text-ink-2">
                    {matches.size === 1 ? '1 passt' : `${matches.size} passen`} zur Suche in den Umsätzen
                  </p>
                )}
                {failure && (
                  <p className="mt-1 text-[12.5px] leading-snug text-ink-2">
                    <span className="font-semibold text-red">Aktualisieren fehlgeschlagen:</span> {failure.message}
                  </p>
                )}
              </>
            ) : failure ? (
              <p className="mt-0.5 text-[13.5px] font-semibold text-red">Abruf fehlgeschlagen</p>
            ) : (
              <p className="mt-0.5 text-[13.5px] text-ink-3">{loading ? 'Wird abgerufen …' : 'Noch nicht abgerufen'}</p>
            )}
          </div>
          {cached && (
            <IconButton
              aria-label={`Vorgemerkte Umsätze aktualisieren. ${TAN_NOTE}`}
              title={`Aktualisieren — ${TAN_NOTE.toLowerCase()}`}
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
            <span className="sr-only" role="status">Vorgemerkte Umsätze werden geladen.</span>
          </div>
        ) : !cached ? (
          <div className="px-4 pb-4 sm:px-5">
            <p className="text-[14px] leading-relaxed text-ink-2">
              {failure
                ? <>{failure.message} {TAN_NOTE}</>
                : <>Angekündigte Lastschriften und Kartenzahlungen, die deine Bank noch nicht gebucht hat. {TAN_NOTE}</>}
            </p>
            <Button size="sm" variant="secondary" className="mt-3" disabled={busy} onClick={load}>
              {failure ? 'Erneut versuchen' : 'Vorgemerkte abrufen'}
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
                  {expanded ? 'Weniger anzeigen' : `Alle ${txs.length} anzeigen`}
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
