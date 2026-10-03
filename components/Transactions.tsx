'use client';

// The Umsätze tile: the loaded statement as a list a person can scan, narrow
// and act on — and, exported alongside it, the Vorgemerkt panel for the
// sidebar. The parts live in components/transactions/.
//
// Two rules shape it. What the header says was loaded is what
// `statementInfo` says was fetched, never what a control currently shows.
// And the filter belongs to the provider, not to this tile, so the palette,
// the Analyse and the Verträge tab can open the list already narrowed.

import { useCallback, useEffect, useId, useMemo, useRef } from 'react';
import { filterTransactions } from '@/lib/analytics';
import type { SerializedTransaction } from '@/lib/fints-types';
import { fmtRange } from '@/lib/format';
import { useFints } from './FintsProvider';
import { RefreshIcon } from './icons';
import { Money } from './Money';
import { Alert, Button, EmptyState, ErrorState, IconButton, Spinner, cx } from './ui';
import { TxDetailHost, openTxDetail } from './transactions/detail-host';
import { ExportMenu } from './transactions/ExportMenu';
import { groupByDay, listTotals, merchantFor, newestFirst } from './transactions/model';
import { PeriodControl } from './transactions/PeriodControl';
import { TxFilterBar, activeFilterCount } from './transactions/TxFilterBar';
import { TxList } from './transactions/TxList';
import { TxRowSkeleton } from './transactions/TxRow';

export { PendingPanel } from './transactions/PendingPanel';

const MAY_NEED_TAN = 'Kann eine Freigabe erfordern.';

// The last focus request this tile has answered. Module-level rather than a
// ref: a deep link from the Analyse tab mounts this tile fresh, with the
// request already pending, and a plain tab switch back must not count as one.
let answeredFocusNonce = 0;

const clock = (ms: number) => {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const umsaetze = (n: number) => `${n.toLocaleString('de-DE')} ${n === 1 ? 'Umsatz' : 'Umsätze'}`;

export function Transactions() {
  const {
    activeAccount: a, transactions, loadingAccount, txError, refreshAccount, busy, statementInfo, range, applyRange,
    txFilter, setTxFilter, txFocusNonce, categoryOf, merchants,
  } = useFints();

  const auto = useId();
  const titleId = `umsaetze${auto}-title`;
  const listId = `umsaetze${auto}-list`;
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const loaded = a ? statementInfo[a.accountNumber] : undefined;
  const loading = !!a && loadingAccount === a.accountNumber;
  const currency = a?.currency || 'EUR';

  const sorted = useMemo(() => newestFirst(transactions ?? []), [transactions]);
  const filtered = useMemo(() => filterTransactions(sorted, txFilter, { categoryOf }), [sorted, txFilter, categoryOf]);
  // The category menu counts what the other filters leave, so a count never
  // promises rows that the direction chip or the search would then hide.
  const facetSource = useMemo(
    () => (txFilter.category ? filterTransactions(sorted, { ...txFilter, category: null }, { categoryOf }) : filtered),
    [sorted, filtered, txFilter, categoryOf],
  );
  const groups = useMemo(() => groupByDay(filtered), [filtered]);
  const totals = useMemo(() => listTotals(filtered, currency), [filtered, currency]);
  const merchantOf = useCallback((tx: SerializedTransaction) => merchantFor(merchants, tx), [merchants]);
  const onOpen = useCallback((tx: SerializedTransaction) => openTxDetail(tx, false), []);

  const filterCount = activeFilterCount(txFilter);
  const resetFilter = useCallback(() => setTxFilter({ dir: 'all', category: null, query: '' }), [setTxFilter]);

  // "Alle Umsätze mit …", a category bar in the Analyse, a palette hit: bring
  // the list into view and put focus on its heading, so a screen reader
  // starts here and the next Tab lands in the filters. The request counts as
  // answered only once the frame has run: a cancelled frame (StrictMode's
  // mount, cleanup, mount in dev) leaves it pending for the next run.
  useEffect(() => {
    if (txFocusNonce < answeredFocusNonce) answeredFocusNonce = txFocusNonce; // a new session counts from 0
    if (txFocusNonce === answeredFocusNonce) return;
    const raf = requestAnimationFrame(() => {
      answeredFocusNonce = txFocusNonce;
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      sectionRef.current?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
      headingRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [txFocusNonce]);

  if (!a) return null;

  const refresh = () => refreshAccount(a);
  const hasList = !!transactions && sorted.length > 0;

  const rangeLine = loading
    ? <>Lädt {fmtRange(range.from, range.to)} …</>
    : loaded
      ? (
        <>
          {fmtRange(loaded.from, loaded.to)}
          {/* When it was fetched matters less than what — on a phone the dates win the room. */}
          <span className="hidden sm:inline"> · abgerufen {clock(loaded.loadedAt)} Uhr</span>
        </>
      )
      : 'Noch nicht abgerufen';

  let body: React.ReactNode;
  if (!a.canStatements) {
    body = (
      <EmptyState illustration="transactions" title="Keine Umsätze für dieses Konto">
        Deine Bank bietet für dieses Konto keine Umsatzabfrage über FinTS an.
      </EmptyState>
    );
  } else if (loading) {
    body = (
      <>
        <p role="status" className="sr-only">Umsätze werden geladen.</p>
        <div aria-hidden>
          {/* A shimmer is the colour of the band itself; on the band the
              placeholder is a plain hairline-coloured bar. */}
          <div className="flex min-h-9 items-center bg-inset px-4 sm:px-5">
            <span className="block h-3 w-28 rounded-full bg-line" />
          </div>
          {[62, 48, 70, 40, 56].map((w, i) => <TxRowSkeleton key={i} width={w} />)}
          <div className="flex min-h-9 items-center bg-inset px-4 sm:px-5">
            <span className="block h-3 w-36 rounded-full bg-line" />
          </div>
          {[52, 66, 44].map((w, i) => <TxRowSkeleton key={i} width={w} />)}
        </div>
      </>
    );
  } else if (txError && !transactions) {
    body = (
      <ErrorState title="Umsätze konnten nicht geladen werden" onRetry={refresh} busy={busy}>
        {txError}
      </ErrorState>
    );
  } else if (!transactions) {
    body = (
      <EmptyState
        illustration="transactions"
        title="Umsätze noch nicht abgerufen"
        action={<Button variant="primary" size="sm" disabled={busy} onClick={refresh}>Umsätze abrufen</Button>}
      >
        {fmtRange(range.from, range.to)}. {MAY_NEED_TAN}
      </EmptyState>
    );
  } else if (sorted.length === 0) {
    body = (
      <EmptyState illustration="transactions" title="Keine Umsätze in diesem Zeitraum">
        {loaded ? `Zwischen ${fmtRange(loaded.from, loaded.to).replace('–', ' und ')} wurde nichts gebucht. ` : ''}
        Wähle oben einen längeren Zeitraum, um weiter zurückzublicken.
      </EmptyState>
    );
  } else if (filtered.length === 0) {
    const q = txFilter.query.trim();
    body = (
      <EmptyState
        illustration="search"
        title="Keine passenden Umsätze"
        action={<Button size="sm" variant="secondary" onClick={resetFilter}>Filter zurücksetzen</Button>}
      >
        {q
          ? <>Im geladenen Zeitraum passt kein Umsatz zu „{q}“{filterCount > 1 ? ' und den gewählten Filtern' : ''}.</>
          : 'Im geladenen Zeitraum passt kein Umsatz zu diesen Filtern.'}
      </EmptyState>
    );
  } else {
    body = (
      <TxList
        id={listId}
        groups={groups}
        total={filtered.length}
        resetKey={`${a.accountNumber}|${loaded?.from ?? ''}|${loaded?.to ?? ''}|${loaded?.loadedAt ?? 0}|${txFilter.dir}|${txFilter.category ?? ''}|${txFilter.query}`}
        merchantOf={merchantOf}
        categoryOf={categoryOf}
        onOpen={onOpen}
      />
    );
  }

  return (
    <>
      <section
        ref={sectionRef}
        aria-labelledby={titleId}
        aria-busy={loading || undefined}
        className="panel scroll-mt-4 overflow-clip"
      >
        <div className="px-4 pt-4 pb-4 sm:px-5 sm:pt-5">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} ref={headingRef} tabIndex={-1} className="section-head outline-none">Umsätze</h2>
              <p className="tnum mt-0.5 truncate text-[13.5px] text-ink-3">{rangeLine}</p>
            </div>
            <div className="-mt-0.5 -mr-1.5 flex shrink-0 items-center gap-1 sm:gap-2">
              {a.canStatements && <PeriodControl loaded={loaded} applyRange={applyRange} busy={busy} />}
              {a.canStatements && (
                <IconButton
                  size="md"
                  aria-label={`Umsätze aktualisieren. ${MAY_NEED_TAN}`}
                  title={`Aktualisieren — ${MAY_NEED_TAN.toLowerCase()}`}
                  disabled={busy}
                  onClick={refresh}
                >
                  {loading ? <Spinner size={16} /> : <RefreshIcon size={18} />}
                </IconButton>
              )}
              <ExportMenu loaded={loaded} all={sorted} filtered={filtered} filterActive={filterCount > 0} />
            </div>
          </div>

          {txError && transactions && !loading && (
            <Alert
              tone="error"
              className="mt-3"
              action={<Button size="xs" variant="secondary" disabled={busy} onClick={refresh}>Erneut versuchen</Button>}
            >
              Aktualisieren hat nicht geklappt: {txError} Angezeigt werden die zuletzt geladenen Umsätze.
            </Alert>
          )}

          {(hasList || filterCount > 0) && !loading && (
            <div className="mt-4">
              <TxFilterBar
                filter={txFilter}
                setFilter={setTxFilter}
                facetSource={facetSource}
                categoryOf={categoryOf}
                listId={listId}
              />
            </div>
          )}

          {/* What the narrowed list adds up to: the count on the left, the
              sums on the right — over the column of amounts they add up.
              Announced politely, so a screen reader hears the result of a
              filter without leaving the field. */}
          <div
            aria-live="polite"
            className={cx(
              'flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[13.5px] text-ink-2',
              hasList && !loading ? 'mt-3' : 'sr-only',
            )}
          >
            {hasList && !loading && (
              <>
                <p className="tnum font-semibold text-ink">
                  {filterCount > 0
                    ? `${filtered.length.toLocaleString('de-DE')} von ${sorted.length.toLocaleString('de-DE')} ${sorted.length === 1 ? 'Umsatz' : 'Umsätzen'}`
                    : umsaetze(filtered.length)}
                  {totals.otherCurrency > 0 && (
                    <span className="font-normal text-ink-3"> · {totals.otherCurrency} in anderer Währung nicht summiert</span>
                  )}
                </p>
                {(totals.income !== 0 || totals.expense !== 0) && (
                  <p className="ml-auto flex items-baseline gap-2.5 sm:gap-3">
                    {totals.income !== 0 && (
                      <span title="Summe der Eingänge">
                        <span className="sr-only">Eingänge </span>
                        <Money value={totals.income} currency={currency} signed tone="credit" className="font-semibold" />
                      </span>
                    )}
                    {totals.expense !== 0 && (
                      <span title="Summe der Ausgänge">
                        <span className="sr-only">Ausgänge </span>
                        <Money value={totals.expense} currency={currency} signed tone="credit" className="font-semibold text-ink" />
                      </span>
                    )}
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        {/* No hairline above a list or its skeleton: the first day band is the edge. */}
        <div className={cx(!(loading || (hasList && filtered.length > 0)) && 'border-t border-line')}>{body}</div>
      </section>

      <TxDetailHost />
    </>
  );
}
