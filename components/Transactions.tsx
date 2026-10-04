'use client';

// The Umsätze tile: the loaded statement as a list a person can scan, narrow
// and act on — and, exported alongside it, the Vorgemerkt panel for the
// sidebar. The parts live in components/transactions/.
//
// Two rules shape it. What the header says was loaded is what
// `statementInfo` says was fetched, never what a control currently shows —
// narrowing the list to a month is a filter on what is loaded, not a fetch.
// And the filter belongs to the provider, not to this tile, so the palette,
// the Analyse and the Verträge tab can open the list already narrowed.

import { useCallback, useEffect, useId, useMemo, useRef } from 'react';
import { calendarMonths, daysLabel, filterTransactions, searchReport, txMatcher, type SearchContext } from '@/lib/analytics';
import { EMPTY_FILTER } from '@/lib/app-types';
import { buildBalanceHistory } from '@/lib/balance-history';
import { isCardAccount } from '@/lib/balances';
import type { SerializedTransaction } from '@/lib/fints-types';
import { fmtRange } from '@/lib/format';
import { useFints } from './FintsProvider';
import { ArrowRightIcon, RefreshIcon } from './icons';
import { Money } from './Money';
import { Alert, Button, CountBadge, EmptyState, ErrorState, IconButton, Spinner, cx } from './ui';
import { LoadHistoryButton, YEAR_SPAN, spanDays } from './insights/shared';
import { TxDetailHost, openTxDetail } from './transactions/detail-host';
import { ExportMenu } from './transactions/ExportMenu';
import { groupByDay, listTotals, merchantFor, newestFirst, searchText } from './transactions/model';
import { PeriodControl } from './transactions/PeriodControl';
import { showPendingMatches } from './transactions/PendingPanel';
import { TxFilterBar, activeFilterCount } from './transactions/TxFilterBar';
import { TxList } from './transactions/TxList';
import { TxRowSkeleton } from './transactions/TxRow';

export { PendingPanel } from './transactions/PendingPanel';

const MAY_NEED_TAN = 'Kann eine Freigabe erfordern.';
const BUSY_NOTE = 'Möglich, sobald der laufende Vorgang fertig ist.';

// The last focus request this tile has answered. Module-level rather than a
// ref: a deep link from the Analyse tab mounts this tile fresh, with the
// request already pending, and a plain tab switch back must not count as one.
let answeredFocusNonce = 0;

const clock = (ms: number) => {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const umsaetze = (n: number) => `${n.toLocaleString('de-DE')} ${n === 1 ? 'Umsatz' : 'Umsätze'}`;

/** „a“, „a“ und „b“, „a“, „b“ und „c“. */
const quoted = (words: string[]) => {
  const q = words.map((w) => `„${w}“`);
  return q.length > 1 ? `${q.slice(0, -1).join(', ')} und ${q[q.length - 1]}` : q[0] ?? '';
};

export function Transactions() {
  const {
    activeAccount: a, transactions, loadingAccount, txError, txErrors, refreshAccount, busy, statementInfo, range, applyRange,
    txFilter, setTxFilter, txFocusNonce, categoryOf, merchants, pendingCache, accountLabel, accounts, selectAccount,
  } = useFints();

  const auto = useId();
  const titleId = `umsaetze${auto}-title`;
  const listId = `umsaetze${auto}-list`;
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const loaded = a ? statementInfo[a.accountNumber] : undefined;
  const loading = !!a && loadingAccount === a.accountNumber;
  const currency = a?.currency || 'EUR';

  // The search reads what the rows show — the tidied name, the town, the
  // category — not only the bank's raw strings. One context object, so each
  // booking's text is folded once rather than per keystroke.
  const searchCtx = useMemo<SearchContext & { categoryOf: typeof categoryOf }>(
    () => ({ categoryOf, shownText: searchText }),
    [categoryOf],
  );
  const sorted = useMemo(() => newestFirst(transactions ?? []), [transactions]);
  const filtered = useMemo(() => filterTransactions(sorted, txFilter, searchCtx), [sorted, txFilter, searchCtx]);
  // Each menu counts what the other filters leave, so a count never promises
  // rows that the direction chip or the search would then hide.
  const facetSource = useMemo(
    () => (txFilter.category ? filterTransactions(sorted, { ...txFilter, category: null }, searchCtx) : filtered),
    [sorted, filtered, txFilter, searchCtx],
  );
  const monthSource = useMemo(
    () => (txFilter.from || txFilter.to ? filterTransactions(sorted, { ...txFilter, from: '', to: '' }, searchCtx) : filtered),
    [sorted, filtered, txFilter, searchCtx],
  );
  const months = useMemo(() => (loaded ? calendarMonths(loaded.from, loaded.to) : []), [loaded]);
  const groups = useMemo(() => groupByDay(filtered), [filtered]);
  const totals = useMemo(() => listTotals(filtered, currency), [filtered, currency]);
  const merchantOf = useCallback((tx: SerializedTransaction) => merchantFor(merchants, tx), [merchants]);
  // The Kontostand at the end of each day — only where the bank's own
  // balances prove the whole chain, exactly as the Kontoverlauf draws it.
  const balanceOn = useMemo(() => {
    if (!loaded || !transactions?.length) return null;
    const h = buildBalanceHistory({ txs: transactions, blocks: loaded.blocks, range: { from: loaded.from, to: loaded.to } });
    return h.verified
      ? { byDay: new Map(h.points.map((p) => [p.date, p.balance])), currency: h.currency, card: !!a && isCardAccount(a) }
      : null;
  }, [loaded, transactions, a]);
  const onOpen = useCallback((tx: SerializedTransaction) => openTxDetail(tx, false), []);

  const filterCount = activeFilterCount(txFilter);
  const resetFilter = useCallback(() => setTxFilter(EMPTY_FILTER), [setTxFilter]);
  const q = txFilter.query.trim();

  // How each word fared on its own: which found nothing, which was also read
  // as a month. Only while a search is typed.
  const report = useMemo(() => (q ? searchReport(sorted, q, searchCtx) : []), [sorted, q, searchCtx]);
  const monthWords = report.filter((t) => t.month);

  // Vorgemerkte stay in their own panel — merged in, they would count in the
  // sums and the CSV, and twice once booked. The list says when some match.
  const pending = a ? pendingCache[a.accountNumber] : undefined;
  const pendingHits = useMemo(
    () => (pending?.length && filterCount > 0 ? filterTransactions(pending, txFilter, searchCtx).length : 0),
    [pending, txFilter, searchCtx, filterCount],
  );

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
  // Less than a year loaded: "weiter zurück" is worth offering where nothing was found.
  const shortHistory = !loaded || spanDays(loaded.from, loaded.to) < YEAR_SPAN;
  const days = txFilter.from || txFilter.to
    ? { from: txFilter.from || loaded?.from || '', to: txFilter.to || loaded?.to || '' }
    : null;

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
      : txError
        ? (
          <>
            Abruf fehlgeschlagen
            {a && txErrors[a.accountNumber] && (
              <span className="hidden sm:inline"> um {clock(txErrors[a.accountNumber].at)} Uhr</span>
            )}
          </>
        )
        : 'Noch nicht abgerufen';

  // A "show me" about one account (useShowOnAccount) that this list cannot
  // answer: it shows another account, or — for a transfer whose status is
  // unclear — it was fetched before that transfer went out. Either way an
  // empty result here says nothing about it, so the list says so first.
  const lookup = txFilter.lookup;
  const lookupAccount = lookup && lookup.accountNumber !== a.accountNumber
    ? accounts.find((x) => x.accountNumber === lookup.accountNumber)
    : undefined;
  const fetchedBefore = !!lookup?.sentAt && lookup.accountNumber === a.accountNumber && !!loaded
    && loaded.loadedAt < lookup.sentAt;
  const lookupNote = <span className="self-center text-[13px] leading-snug text-ink-3">{busy ? BUSY_NOTE : MAY_NEED_TAN}</span>;

  const pendingLine = pendingHits > 0 && (
    <button
      type="button"
      onClick={showPendingMatches}
      className="group inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-[4px] text-left text-[13.5px] font-semibold text-accent"
    >
      <span className="underline-offset-[3px] group-hover:underline">
        Außerdem {pendingHits === 1 ? 'passt 1 vorgemerkter Umsatz' : `passen ${pendingHits} vorgemerkte Umsätze`}
      </span>
      <ArrowRightIcon size={15} />
    </button>
  );

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
      <EmptyState
        illustration="transactions"
        title="Keine Umsätze in diesem Zeitraum"
        action={shortHistory ? <LoadHistoryButton layout="centered" /> : undefined}
      >
        {loaded ? `Zwischen ${fmtRange(loaded.from, loaded.to).replace('–', ' und ')} wurde nichts gebucht.` : ''}
        {shortHistory && ' Ein längerer Zeitraum zeigt vielleicht mehr.'}
      </EmptyState>
    );
  } else if (filtered.length === 0) {
    // Say why, word by word, instead of implying the booking does not exist.
    const missing = report.filter((t) => t.matches === 0).map((t) => t.text);
    const where = loaded
      ? <>im geladenen Zeitraum (<span className="whitespace-nowrap">{fmtRange(loaded.from, loaded.to)}</span>)</>
      : 'im geladenen Zeitraum';
    let reason: React.ReactNode;
    if (missing.length) {
      reason = <>{quoted(missing)} {missing.length === 1 ? 'kommt' : 'kommen'} {where} in keinem Umsatz vor.</>;
    } else if (q && report.length > 1 && !sorted.some(txMatcher(q, searchCtx))) {
      reason = <>Jedes Wort von „{q}“ kommt vor, aber kein Umsatz enthält alle zusammen.</>;
    } else if (q) {
      reason = <>„{q}“ findet Umsätze, aber keinen, der zu den übrigen Filtern passt.</>;
    } else {
      reason = <>Im geladenen Zeitraum passt kein Umsatz zu diesen Filtern.</>;
    }
    body = (
      <EmptyState
        illustration="search"
        title="Keine passenden Umsätze"
        action={
          <>
            <Button size="sm" variant="secondary" onClick={resetFilter}>Filter zurücksetzen</Button>
            {q && shortHistory && <LoadHistoryButton layout="centered" className="mt-2 w-full" />}
          </>
        }
      >
        {reason}
        {pendingLine && <span className="mt-1 block">{pendingLine}</span>}
      </EmptyState>
    );
  } else {
    body = (
      <TxList
        id={listId}
        groups={groups}
        total={filtered.length}
        resetKey={`${a.accountNumber}|${loaded?.from ?? ''}|${loaded?.to ?? ''}|${loaded?.loadedAt ?? 0}|${txFilter.dir}|${txFilter.category ?? ''}|${txFilter.from ?? ''}|${txFilter.to ?? ''}|${txFilter.query}`}
        merchantOf={merchantOf}
        categoryOf={categoryOf}
        onOpen={onOpen}
        balanceOn={balanceOn}
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
                  title={`Aktualisieren. ${MAY_NEED_TAN}`}
                  disabled={busy}
                  onClick={refresh}
                >
                  {loading ? <Spinner size={16} /> : <RefreshIcon size={18} />}
                </IconButton>
              )}
              <ExportMenu loaded={loaded} all={sorted} filtered={filtered} />
            </div>
          </div>

          {txError && transactions && !loading && (
            <Alert
              tone="error"
              className="mt-3"
              action={<Button size="xs" variant="secondary" disabled={busy} onClick={refresh}>Erneut versuchen</Button>}
            >
              Abruf fehlgeschlagen: {txError} Angezeigt werden die zuletzt abgerufenen Umsätze.
            </Alert>
          )}

          {/* Status unklar takes the warning's inset with the orange edge; a
              palette hit on another account is plain information. */}
          {lookup && lookupAccount && !loading && (
            <Alert
              tone={lookup.sentAt ? 'warn' : 'info'}
              className="mt-3"
              role="status"
              action={
                <>
                  <Button size="xs" variant="secondary" disabled={busy} onClick={() => selectAccount(lookupAccount)}>
                    Zu „{accountLabel(lookupAccount)}“ wechseln
                  </Button>
                  {lookupNote}
                </>
              }
            >
              {lookup.sentAt
                ? <>Die Überweisung ging von „{accountLabel(lookupAccount)}“ aus. Diese Liste zeigt „{accountLabel(a)}“ – ob sie ausgeführt wurde, siehst du nur dort.</>
                : <>Der Umsatz gehört zu „{accountLabel(lookupAccount)}“. Diese Liste zeigt „{accountLabel(a)}“.</>}
            </Alert>
          )}
          {fetchedBefore && loaded && !loading && (
            <Alert
              tone="warn"
              className="mt-3"
              role="status"
              action={
                <>
                  <Button size="xs" variant="secondary" disabled={busy} onClick={refresh}>Aktualisieren</Button>
                  {lookupNote}
                </>
              }
            >
              Diese Umsätze wurden um <span className="tnum">{clock(loaded.loadedAt)}</span> Uhr abgerufen, vor deiner
              Überweisung – sie kann hier noch nicht stehen.
            </Alert>
          )}

          {(hasList || filterCount > 0) && !loading && (
            <div className="mt-4">
              <TxFilterBar
                filter={txFilter}
                setFilter={setTxFilter}
                facetSource={facetSource}
                monthSource={monthSource}
                months={months}
                loaded={loaded}
                categoryOf={categoryOf}
                listId={listId}
              />
            </div>
          )}

          {/* A figure over every account led here: this list is one of them. */}
          {txFilter.acrossAccounts && hasList && !loading && (
            <Alert tone="info" className="mt-3" role="status">
              Die Analyse hat alle Konten mit Umsätzen gezählt. Diese Liste zeigt nur {accountLabel(a)}.
            </Alert>
          )}

          {/* What the narrowed list adds up to: the count on the left, with
              the way back from a filter beside it (always in view, unlike
              the end of a scrolling chip row), the sums on the right — over
              the column of amounts they add up. Count and sums are announced
              politely, so a screen reader hears the result of a filter
              without leaving the field. */}
          <div
            className={cx(
              'flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[13.5px] text-ink-2',
              hasList && !loading ? 'mt-3' : 'sr-only',
            )}
          >
            <div className="flex min-w-0 flex-wrap items-center gap-x-2">
              <p aria-live="polite" className="tnum font-semibold text-ink">
                {hasList && !loading && (
                  <>
                    {filterCount > 0
                      ? `${filtered.length.toLocaleString('de-DE')} von ${sorted.length.toLocaleString('de-DE')} ${sorted.length === 1 ? 'Umsatz' : 'Umsätzen'}`
                      : umsaetze(filtered.length)}
                    {/* On a phone the month chip may sit scrolled out of view; the count names it. */}
                    {days && <span className="font-normal text-ink-3 sm:hidden"> · {daysLabel(days.from, days.to)}</span>}
                    {totals.otherCurrency > 0 && (
                      <span className="font-normal text-ink-3"> · {totals.otherCurrency} in anderer Währung nicht summiert</span>
                    )}
                  </>
                )}
              </p>
              {hasList && !loading && filterCount > 0 && (
                <Button size="xs" variant="tertiary" className="-my-1 -ml-1" onClick={resetFilter}>
                  Zurücksetzen
                  <CountBadge count={filterCount} tone="accent" />
                </Button>
              )}
            </div>
            <p aria-live="polite" className="ml-auto flex items-baseline gap-2.5 sm:gap-3">
              {hasList && !loading && totals.income !== 0 && (
                <span title="Summe der Eingänge">
                  <span className="sr-only">Eingänge </span>
                  <Money value={totals.income} currency={currency} signed tone="credit" className="font-semibold" />
                </span>
              )}
              {hasList && !loading && totals.expense !== 0 && (
                <span title="Summe der Ausgänge">
                  <span className="sr-only">Ausgänge </span>
                  <Money value={totals.expense} currency={currency} signed tone="credit" className="font-semibold text-ink" />
                </span>
              )}
            </p>
          </div>
          {hasList && !loading && filtered.length > 0 && (monthWords.length > 0 || pendingLine) && (
            <div className="mt-1 flex flex-col items-start text-[13px] leading-snug text-ink-3">
              {/* A month word matches its month and its text: say so, so a
                  "Mai" that shows every May booking is not a mystery. */}
              {monthWords.length > 0 && (
                <p>
                  {monthWords.map((t) => `„${t.text}“ auch als Monat ${t.month}`).join(', ')} gesucht
                </p>
              )}
              {pendingLine}
            </div>
          )}
        </div>

        {/* No hairline above a list or its skeleton: the first day band is the edge. */}
        <div className={cx(!(loading || (hasList && filtered.length > 0)) && 'border-t border-line')}>{body}</div>
      </section>

      <TxDetailHost />
    </>
  );
}
