'use client';

// "Verträge & Abos" — the payments that come back on a rhythm, recognised in
// the bookings already loaded for every account of this session (salary,
// rent, energy, insurance, subscriptions). And "Demnächst fällig", the short
// list of what the next 30 days are expected to bring, for the overview.
//
// All of it is a guess drawn from history (lib/recurring.ts) and says so:
// amounts are "ca." and in whole euros, dates "voraussichtlich", totals a
// "Schätzung". The basis — which accounts, each with its period, which are
// missing — is always on screen; a history too short for the slower rhythms
// says what it cannot show; and the user can overrule the guess ("Nicht als
// Vertrag zählen"), which is remembered in the vault.

import { useCallback, useId, useMemo } from 'react';
import { useFints } from './FintsProvider';
import { ArrowRightIcon } from './icons';
import { Money } from './Money';
import { Alert, Button, Disclosure, DotList, EmptyState, ErrorState, Skeleton, Spinner, Tile, cx } from './ui';
import { namesList } from '@/lib/balances';
import { fmtRange, displayName, presetRange } from '@/lib/format';
import type { Messages } from '@/lib/i18n';
import { rich, useT } from '@/lib/i18n/react';
import type { Cadence, RecurringSeries } from '@/lib/recurring';
import { ContractGroup, ContractRow, DismissedRow } from './insights/ContractRow';
import { useRecurringModel, useUpcoming, type AccountBasis, type RecurringModel } from './insights/recurring-model';
import { LoadHistoryButton, RoundMoney, YEAR_SPAN, daysUntil, fmtDayKeyShort, fmtWeekday } from './insights/shared';

/**
 * "Vierteljährliche und jährliche" ("Quarterly and yearly") — the rhythms a
 * short history cannot show, as one phrase.
 */
function unseenPhrase(unseen: readonly Cadence[], t: Messages): string {
  const adjective = t.insights.contracts.unseenAdjective;
  const text = namesList(unseen.map((c) => adjective[c]).filter((w): w is string => !!w));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function useDismiss() {
  const { dismissRecurring, restoreRecurring, toast } = useFints();
  const t = useT();
  const dismiss = useCallback((s: RecurringSeries) => {
    dismissRecurring(s.id);
    toast(t.insights.contracts.dismissed(displayName(s.name)), 'info', 6500, {
      label: t.insights.contracts.undo,
      run: () => restoreRecurring(s.id),
    });
  }, [dismissRecurring, restoreRecurring, toast, t]);
  const restore = useCallback((s: RecurringSeries) => restoreRecurring(s.id), [restoreRecurring]);
  return { dismiss, restore };
}

// ---------------------------------------------------------------------------
// The tab
// ---------------------------------------------------------------------------

export function Contracts() {
  const model = useRecurringModel();
  const { vaultStatus, accountLabel } = useFints();
  const { dismiss, restore } = useDismiss();
  const t = useT();
  const words = t.insights.contracts;

  if (model.loading) return <ContractsSkeleton />;

  const { basis, income, groups, ended, dismissed, totals, accountOf } = model;
  const live = income.length + model.expense.length;
  const several = model.accounts.filter((b) => b.status === 'included').length > 1;
  // The account a contract is paid from, named on its row when there are several.
  const accountName = (s: RecurringSeries) => {
    if (!several) return null;
    const acct = accountOf(s);
    const b = model.accounts.find((x) => x.account.accountNumber === acct);
    return b ? accountLabel(b.account) : null;
  };

  if (!basis) return <NoBasis model={model} />;
  const shortHistory = basis.shortestSpan < YEAR_SPAN;

  return (
    <div className="min-w-0 space-y-4 sm:space-y-6">
      <SummaryTile model={model} shortHistory={shortHistory} />

      {live === 0 && !model.incomplete && (
        <section className="panel" aria-label={words.noneFound}>
          {/* No bookings at all is a different finding from bookings without
              a rhythm — "wiederholt sich keine Zahlung" would be a stretch. */}
          {basis.bookings === 0 ? (
            <EmptyState illustration="contracts" title={t.insights.bookings.noneInRange}>
              {words.noneInRange(fmtRange(basis.from, basis.to))}
            </EmptyState>
          ) : (
            <EmptyState illustration="contracts" title={words.noRegular}>
              {words.noRegularHint(fmtRange(basis.from, basis.to))}
              {shortHistory && ` ${words.longerHelps}`}
            </EmptyState>
          )}
        </section>
      )}

      {income.length > 0 && (
        <ContractGroup
          title={words.regularIncome}
          subtitle={model.incomplete
            ? t.insights.count.regularIncoming(income.length)
            : rich(words.perMonth(<RoundMoney value={totals.monthlyIncome} currency={totals.currency} />))}
          headerNext={words.columns.nextIncoming}
        >
          {income.map((s) => <ContractRow key={s.id} s={s} account={accountName(s)} onDismiss={dismiss} />)}
        </ContractGroup>
      )}

      {/* The regular payments out, grouped as a household reads them — the
          rent apart from the subscriptions — each group with its own sums. */}
      {groups.map((g) => (
        <ContractGroup
          key={g.id}
          title={g.label}
          subtitle={
            // While an account failed, no sum: it would look complete and is not.
            <DotList
              items={[
                !model.incomplete && rich(words.perMonth(<RoundMoney value={g.monthly} currency={g.currency} />)),
                !model.incomplete && rich(words.perYear(<RoundMoney value={g.yearly} currency={g.currency} />)),
                t.insights.count.contracts(g.series.length),
              ]}
            />
          }
        >
          {g.series.map((s) => <ContractRow key={s.id} s={s} account={accountName(s)} onDismiss={dismiss} />)}
        </ContractGroup>
      ))}

      {/* On phones the "load a year" notice follows the list instead of
          pushing it below the first screen (see SummaryTile). */}
      {shortHistory && (
        <section className="panel overflow-hidden sm:hidden" aria-label={words.longerHistory}>
          <HistoryNotice model={model} />
        </section>
      )}

      {(ended.length > 0 || dismissed.length > 0) && (
        <section className="panel overflow-hidden" aria-label={words.moreFound}>
          {ended.length > 0 && (
            <Disclosure
              title={<span className="text-[15px] font-semibold text-ink">{words.endedTitle(ended.length)}</span>}
              trailing={<span className="hidden text-[13px] text-ink-3 sm:inline">{words.notInTotals}</span>}
              headerClassName="min-h-14 sm:px-6"
            >
              <p className="border-t border-line px-4 pt-3 pb-1 text-[13px] text-ink-3 sm:px-6">
                {words.endedHint}
              </p>
              <ul>{ended.map((s) => <ContractRow key={s.id} s={s} account={accountName(s)} onDismiss={dismiss} />)}</ul>
            </Disclosure>
          )}
          {dismissed.length > 0 && (
            <Disclosure
              title={<span className="text-[15px] font-semibold text-ink">{words.hiddenTitle(dismissed.length)}</span>}
              trailing={<span className="hidden text-[13px] text-ink-3 sm:inline">{words.notCounted}</span>}
              headerClassName="min-h-14 sm:px-6"
              className={ended.length > 0 ? 'border-t border-line' : undefined}
            >
              {vaultStatus === 'error' || vaultStatus === 'unavailable' ? (
                <p className="border-t border-line px-4 pt-3 pb-1 text-[13px] text-ink-3 sm:px-6">
                  {words.vaultUnavailable}
                </p>
              ) : null}
              <ul className="border-t border-line">{dismissed.map((s) => <DismissedRow key={s.id} s={s} onRestore={restore} />)}</ul>
            </Disclosure>
          )}
        </section>
      )}
    </div>
  );
}

/** Nothing loaded at all: why, and the way to change it. */
function NoBasis({ model }: { model: RecurringModel }) {
  const { activeAccount, busy, refreshAccount, accountLabel } = useFints();
  const t = useT();
  const words = t.insights.contracts;
  const own = model.accounts.find((b) => b.account.accountNumber === activeAccount?.accountNumber);
  if (own?.status === 'failed' && activeAccount) {
    return (
      <section className="panel" aria-label={words.label}>
        <ErrorState title={t.common.fetchFailed} onRetry={() => refreshAccount(activeAccount)} busy={busy}>
          {own.error} {words.cannotRecognise}
        </ErrorState>
      </section>
    );
  }
  const canLoad = !!activeAccount?.canStatements;
  return (
    <section className="panel" aria-label={words.label}>
      <EmptyState
        illustration="contracts"
        title={words.notLoaded}
        action={canLoad && activeAccount ? (
          <Button variant="primary" size="sm" disabled={busy} onClick={() => refreshAccount(activeAccount)}>
            {t.insights.bookings.load}
          </Button>
        ) : undefined}
      >
        {words.howItWorks}
        {canLoad && activeAccount && <> {words.loadHint(accountLabel(activeAccount))}</>}
      </EmptyState>
    </section>
  );
}

function SummaryTile({ model, shortHistory }: { model: RecurringModel; shortHistory: boolean }) {
  const { basis, totals, income, expense, groups, otherCurrency, unseen } = model;
  const headingId = useId();
  const t = useT();
  const words = t.insights.contracts;
  if (!basis) return null;
  const live = income.length + expense.length;
  const housing = groups.find((g) => g.id === 'housing');
  const rest = groups.filter((g) => g.id !== 'housing');
  const restMonthly = Math.round(rest.reduce((sum, g) => sum + g.monthly * 100, 0)) / 100;
  const restCount = rest.reduce((n, g) => n + g.series.length, 0);
  const failed = model.accounts.filter((b) => b.status === 'failed');
  // Rent and energy apart from everything else, when there is both.
  const split = !!housing && rest.length > 0;

  return (
    <section className="panel overflow-hidden" aria-labelledby={headingId}>
      {/* Where focus lands when the row that held it goes away (focusAfterRemoval). */}
      <h2 id={headingId} className="sr-only" data-focus-fallback>{words.summary}</h2>
      {failed.length > 0 ? (
        // A sum without a failed account would look complete and is not.
        <FailedNotice failed={failed} />
      ) : live > 0 && (
        // With nothing recognised there is nothing to add up — "ca. 0 €"
        // would read as a finding. The basis and the notice still show.
        <dl className={cx('grid grid-cols-2 gap-px border-b border-line bg-line', split ? 'desk:grid-cols-4' : 'desk:grid-cols-3')}>
          {split && housing ? (
            <>
              <SummaryFigure label={housing.label} sub={words.perMonthWith(t.insights.count.contracts(housing.series.length))}>
                <RoundMoney value={housing.monthly} currency={totals.currency} />
              </SummaryFigure>
              <SummaryFigure label={words.subscriptions} sub={words.perMonthWith(t.insights.count.contracts(restCount))}>
                <RoundMoney value={restMonthly} currency={totals.currency} />
              </SummaryFigure>
            </>
          ) : (
            <SummaryFigure label={words.fixedCosts} sub={words.perMonthWith(t.insights.count.contracts(expense.length))}>
              <RoundMoney value={totals.monthlyExpense} currency={totals.currency} />
            </SummaryFigure>
          )}
          <SummaryFigure
            label={t.common.booking.incoming}
            sub={income.length ? words.perMonthWith(t.insights.count.regularIncoming(income.length)) : words.inLoadedHistory}
          >
            {income.length
              ? <RoundMoney value={totals.monthlyIncome} currency={totals.currency} />
              : null}
          </SummaryFigure>
          <SummaryFigure
            label={words.fixedPerYear}
            prefix={unseen.length ? words.atLeast : t.insights.approx}
            sub={unseen.length ? words.unseenPayments(unseenPhrase(unseen, t)) : words.projected}
            wide={!split}
          >
            <RoundMoney value={totals.yearlyExpense} currency={totals.currency} />
          </SummaryFigure>
        </dl>
      )}
      {/* "Schätzung" only once there is something estimated. */}
      <div className="px-4 py-3 sm:px-6">
        {/* Where the "more than the bank" work happens, it says where it happened. */}
        <p className="text-[13px] leading-relaxed text-ink-3">{words.computedHere}</p>
        <p className="tnum text-[13px] leading-relaxed text-ink-3">
          <DotList
            items={[
              live > 0 && !failed.length && words.estimate,
              basis.bookings > 0 && words.excluded,
              otherCurrency > 0 && words.otherCurrency(otherCurrency),
            ]}
          />
        </p>
        <AccountList accounts={model.accounts} />
      </div>
      {shortHistory && <HistoryNotice model={model} className="hidden border-t border-line sm:block" />}
    </section>
  );
}

/** One account in scope failed: the totals are held back, and it says which and why. */
function FailedNotice({ failed }: { failed: AccountBasis[] }) {
  const { busy, refreshAccount, accountLabel } = useFints();
  const t = useT();
  const names = failed.map((b) => accountLabel(b.account));
  return (
    <div className="border-b border-line px-4 py-4 sm:px-6">
      <Alert
        tone="error"
        className="mt-0"
        title={`${t.common.fetchFailed}: ${namesList(names)}`}
        action={failed.map((b) => (
          <Button key={b.account.accountNumber} size="xs" variant="secondary" disabled={busy} onClick={() => refreshAccount(b.account)}>
            {failed.length === 1 ? t.common.retry : t.insights.contracts.reloadAccount(accountLabel(b.account))}
          </Button>
        ))}
      >
        {failed[0].error} {t.insights.contracts.failedHint(failed.length)}
      </Alert>
    </div>
  );
}

/**
 * Which accounts the detection read, each with its own period — and which it
 * did not, with the way to add them. Fetching another account here does not
 * switch to it: it only adds its bookings.
 */
function AccountList({ accounts }: { accounts: AccountBasis[] }) {
  const { busy, loadTransactions, accountLabel, activeAccount } = useFints();
  const t = useT();
  const words = t.insights.contracts;
  const listed = accounts.filter((b) => b.status !== 'unsupported' || accounts.length > 1);
  if (!listed.length) return null;
  // Said once, under the buttons that may ask the bank for an approval.
  const needsHint = listed.some((b) => b.status === 'missing'
    || (b.status === 'included' && b.account.accountNumber !== activeAccount?.accountNumber && (b.span ?? 0) < YEAR_SPAN));
  return (
    <div className="mt-2">
      <h3 className="text-[13px] font-semibold text-ink-2">{t.common.account.accounts}</h3>
      <ul className="mt-1">
        {listed.map((b) => {
          const name = accountLabel(b.account);
          const active = b.account.accountNumber === activeAccount?.accountNumber;
          return (
            <li key={b.account.accountNumber} className="flex min-h-9 flex-wrap items-center gap-x-3 py-1 text-[13.5px]">
              <span className="min-w-0 font-semibold text-ink">{name}</span>
              {/* Beside the name from sm up; under it on a phone, where both would wrap into each other. */}
              <span className="tnum order-last w-full min-w-0 text-ink-3 sm:order-none sm:w-auto sm:flex-1">
                {b.status === 'included' && (
                  <>
                    {fmtRange(b.from, b.to)} · {t.insights.count.bookings(b.bookings ?? 0)}
                    {(b.span ?? 0) < YEAR_SPAN && ` · ${words.historyDays(b.span ?? 0)}`}
                  </>
                )}
                {b.status === 'loading' && <span className="inline-flex items-center gap-1.5"><Spinner size={12} /> {words.loading}</span>}
                {b.status === 'failed' && t.common.fetchFailed}
                {b.status === 'missing' && words.notIncluded}
                {b.status === 'unsupported' && words.noFints}
              </span>
              {b.status === 'missing' && (
                <Button size="xs" variant="tertiary" className="-mr-3 ml-auto" disabled={busy} onClick={() => void loadTransactions(b.account)}>
                  {t.insights.bookings.load}<span className="sr-only"> {words.forAccount(name)}</span>
                </Button>
              )}
              {b.status === 'included' && !active && (b.span ?? 0) < YEAR_SPAN && (
                <Button
                  size="xs"
                  variant="tertiary"
                  className="-mr-3 ml-auto"
                  disabled={busy}
                  onClick={() => {
                    const r = presetRange('365d');
                    void loadTransactions(b.account, r.from, r.to, { force: true });
                  }}
                >
                  {words.loadYear}<span className="sr-only"> {words.forAccount(name)}</span>
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {needsHint && <p className="text-[12.5px] text-ink-3">{t.insights.mayNeedApproval} {words.noSwitch}</p>}
    </div>
  );
}

/** Too little history for the slower rhythms — which account, and the one button that fetches more. */
function HistoryNotice({ model, className }: { model: RecurringModel; className?: string }) {
  const { activeAccount, accountLabel } = useFints();
  const t = useT();
  const words = t.insights.contracts;
  const short = model.accounts.filter((b) => b.status === 'included' && (b.span ?? 0) < YEAR_SPAN);
  const activeShort = short.some((b) => b.account.accountNumber === activeAccount?.accountNumber);
  if (!short.length) return null;
  const phrase = unseenPhrase(model.unseen, t);
  // "GiroKomfort und Visa Classic reichen 91 Tage zurück" when they agree.
  const same = short.every((b) => b.span === short[0].span);
  const reach = same
    ? words.reach(namesList(short.map((b) => accountLabel(b.account))), short.length !== 1, short[0].span ?? 0)
    : short.map((b) => words.reach(accountLabel(b.account), false, b.span ?? 0)).join(', ');
  return (
    <div className={cx('bg-info-soft px-4 py-3.5 sm:px-6', className)}>
      <p className="text-[14px] leading-snug text-ink">
        {reach}.
        {' '}
        {phrase ? words.unseenContracts(phrase) : words.loadYearForYearly}
      </p>
      {activeShort && <LoadHistoryButton className="mt-2.5" />}
    </div>
  );
}

function SummaryFigure({
  label, sub, prefix, wide, children,
}: {
  label: string;
  sub: string;
  /** "ca." for an estimate (the default), "mind." for a sum the history may be short of. */
  prefix?: string;
  /** Spans both columns on a phone (a lone third figure). */
  wide?: boolean;
  /** The figure; null for "none recognised". */
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <div className={cx('min-w-0 bg-surface px-4 py-3.5 sm:px-6 sm:py-5', wide && 'col-span-2 desk:col-span-1')}>
      <dt className="text-[13px] leading-snug font-semibold text-ink-2">{label}</dt>
      <dd className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-[20px] leading-tight font-bold text-ink sm:text-[24px]">
        {children ? (
          <>
            <span className="text-[13px] font-normal text-ink-3 sm:text-[14px]">{prefix ?? t.insights.approx}</span>
            {children}
          </>
        ) : (
          <span className="text-[15px] font-semibold text-ink-3">{t.insights.contracts.noneRecognised}</span>
        )}
      </dd>
      <dd className="mt-1 text-[13px] leading-snug text-ink-3">{sub}</dd>
    </div>
  );
}

function ContractsSkeleton() {
  const t = useT();
  return (
    <div aria-hidden className="space-y-4 sm:space-y-6">
      <div className="panel grid grid-cols-2 gap-px overflow-hidden bg-line desk:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-surface px-4 py-3.5 sm:px-6 sm:py-5">
            <Skeleton className="h-3 w-28 max-w-full" />
            <Skeleton className="mt-3 h-6 w-32 max-w-full" />
            <Skeleton className="mt-2 h-3 w-24 max-w-full" />
          </div>
        ))}
      </div>
      <div className="panel py-4">
        <Skeleton className="mx-4 h-4 w-40 sm:mx-6" />
        {[60, 48, 54, 40].map((w) => (
          <div key={w} className="flex items-center gap-3 px-4 py-3 sm:px-6">
            <Skeleton circle className="size-10 shrink-0" />
            <div className="flex-1">
              <Skeleton className="h-3" style={{ width: `${w}%` }} />
              <Skeleton className="mt-2 h-3" style={{ width: `${w - 20}%` }} />
            </div>
            <Skeleton className="h-3.5 w-16" />
          </div>
        ))}
      </div>
      <span role="status" className="sr-only">{t.insights.contracts.recognising}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Demnächst fällig — the overview's sidebar tile
// ---------------------------------------------------------------------------

const UPCOMING_MAX = 5;

/**
 * What the next 30 days are expected to bring on the active account — the
 * account the Monatsbilanz beside it shows — with what that adds up to.
 */
export function UpcomingPayments() {
  const { setTab, activeAccount, accountLabel } = useFints();
  const t = useT();
  const words = t.insights.upcoming;
  const model = useRecurringModel();
  const acct = activeAccount?.accountNumber ?? null;
  const items = useUpcoming(model, 30, acct);
  const shown = items.slice(0, UPCOMING_MAX);
  const more = items.length - shown.length;
  const any = model.income.length + model.expense.length > 0;
  const own = model.accounts.find((b) => b.account.accountNumber === acct);
  const currency = activeAccount?.currency || 'EUR';
  // What the 30 days add up to, each way, in the account's currency only.
  const sums = useMemo(() => {
    let out = 0;
    let inc = 0;
    for (const { series: s } of items) {
      if (s.currency !== currency) continue;
      if (s.amount < 0) out += Math.round(s.amount * 100);
      else inc += Math.round(s.amount * 100);
    }
    return { out: out / 100, in: inc / 100 };
  }, [items, currency]);
  const name = activeAccount ? accountLabel(activeAccount) : '';

  return (
    <Tile
      // A grid track sizes to its widest unbreakable line unless told otherwise;
      // the truncated names below must be allowed to give way instead.
      className="min-w-0"
      title={words.title}
      // On a narrow tile the facts take a line each, rather than leave the
      // dot hanging — "voraussichtlich" stays: these are expectations.
      subtitle={<DotList items={[name, words.next30, words.expected]} />}
      actions={
        // -mr-2.5: the label's text, not the pill's padding, ends on the
        // tile's content edge, like the figures below it.
        <Button variant="tertiary" size="xs" iconRight={<ArrowRightIcon size={15} />} className="-mr-2.5" onClick={() => setTab('contracts')}>
          {words.all}
        </Button>
      }
    >
      {model.loading ? (
        <ul aria-hidden className="pb-3">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
              <Skeleton className="h-8 w-11 rounded-[8px]" />
              <Skeleton className="h-3 flex-1" />
              <Skeleton className="h-3 w-14" />
            </li>
          ))}
        </ul>
      ) : shown.length === 0 ? (
        <p className="px-4 pb-4 text-[14px] leading-relaxed text-ink-2 sm:px-5 sm:pb-5">
          {own?.status === 'failed'
            ? words.failed(name)
            : own?.status !== 'included'
              ? words.notLoaded(name)
              : any
                ? words.none(name)
                : words.noneYet}
        </p>
      ) : (
        <>
          <ul className="pb-1">
            {shown.map(({ series: s, date }) => {
              const n = displayName(s.name) || t.insights.contracts.unknown;
              const wd = fmtWeekday(date);
              const dm = fmtDayKeyShort(date);
              const soon = daysUntil(date) <= 1;
              return (
                <li key={s.id} className="flex items-center gap-3 px-4 py-2 sm:px-5">
                  <span
                    className="tnum grid w-14 shrink-0 place-items-center rounded-[8px] bg-inset py-1 leading-tight"
                    aria-hidden
                  >
                    <span className="text-[12.5px] font-semibold text-ink-3">{wd}</span>
                    <span className="text-[13px] font-semibold text-ink">{dm}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-ink">{n}</span>
                    <span className="block truncate text-[12.5px] text-ink-3">
                      <span className="sr-only">{words.on(dm)}</span>
                      {soon ? `${daysUntil(date) === 0 ? t.insights.relative.today : t.insights.relative.tomorrow} · ` : ''}
                      {s.cadenceLabel}
                    </span>
                  </span>
                  <span className="shrink-0 text-[14px] font-semibold">
                    {s.variable ? (
                      <>
                        <span className="mr-1 text-[12.5px] font-normal text-ink-3">{t.insights.approx}</span>
                        <RoundMoney value={s.amount} currency={s.currency} signed className={s.amount > 0 ? 'text-green' : undefined} />
                      </>
                    ) : (
                      <Money value={s.amount} currency={s.currency} signed tone="credit" />
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          {/* Said, not linked: "Alle Verträge" in the header is the one way on. */}
          {more > 0 && (
            <p className="px-4 pb-2.5 text-[13px] leading-snug text-ink-3 sm:px-5">
              {words.more(more)}
            </p>
          )}
          {/* What the 30 days add up to — every expected booking, not only the five shown. */}
          <dl className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-t border-line bg-inset px-4 py-2.5 text-[13px] sm:px-5">
            <dt className="text-ink-2">{words.sum}</dt>
            <dd className="flex items-baseline gap-2.5 font-semibold">
              {sums.out !== 0 && (
                <span>
                  <span className="sr-only">{t.common.booking.outgoing} </span>
                  <RoundMoney value={sums.out} currency={currency} className="text-ink" />
                </span>
              )}
              {sums.in !== 0 && (
                <span>
                  <span className="sr-only">{t.common.booking.incoming} </span>
                  <RoundMoney value={sums.in} currency={currency} signed className="text-green" />
                </span>
              )}
            </dd>
          </dl>
        </>
      )}
    </Tile>
  );
}
