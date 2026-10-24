'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, ReactNode } from 'react';
import { canReportBalance, isCardAccount, isDepot } from '@/lib/balances';
import type { BalanceHistory } from '@/lib/balance-history';
import { accountBalanceHistory } from '@/lib/history';
import { dayKey, fmtDate, fmtIban, fmtRange, isFutureDate, isoDate } from '@/lib/format';
import type { SerializedAccount, SerializedBalance } from '@/lib/fints-types';
import type { StatementInfo } from '@/lib/app-types';
import { intlLocale, type Messages } from '@/lib/i18n';
import { useT } from '@/lib/i18n/react';
import { IS_ANDROID } from '@/lib/platform';
import { useFints } from '../FintsProvider';
import { Money } from '../Money';
import { AlertTriangleIcon, ChevronIcon, EyeIcon, EyeOffIcon, InfoIcon, PencilIcon, RefreshIcon, UndoIcon } from '../icons';
import { Alert, Button, CopyButton, Field, IconButton, Input, Overlay, Sheet, Skeleton, cx } from '../ui';
import { fmtSince } from '../shell/session';
import { usePhone } from '../shell/usePhone';
import { MAX_ALIAS, accountIdent, aliasFromDraft, bankName, vaultNote } from './AccountIdentity';
import { AccountList } from './AccountList';
import { AccountGoal } from './SavingsGoal';
import { BalanceChart } from './BalanceChart';

/**
 * The bank's own balance at the end of a fetched range: the newest statement
 * block that states one. The same reading the printed Kontoauszug uses, so
 * the hero and the PDF never disagree about a past range.
 */
function closingOf(info: StatementInfo | undefined, fallbackCurrency: string): { balance: number; currency: string } | null {
  if (!info) return null;
  let best: StatementInfo['blocks'][number] | null = null;
  for (const b of info.blocks) {
    if (b.closingBalance == null) continue;
    if (!best || (b.closingDate ?? '') >= (best.closingDate ?? '')) best = b;
  }
  if (!best || best.closingBalance == null) return null;
  return { balance: best.closingBalance, currency: best.currency || fallbackCurrency };
}

/**
 * When a balance is "as of". An interim report's closing balance is dated to
 * the bank's next Buchungstag, so on a weekend it sits in the future. Say
 * which day it is rather than presenting a future date as the balance's as-of
 * date.
 */
function asOf(bal: SerializedBalance | undefined, t: Messages) {
  if (!bal?.date) return null;
  const words = t.insights.hero;
  return isFutureDate(bal.date)
    ? { text: words.bookingDay(fmtDate(bal.date)), title: words.bookingDayHint }
    : { text: words.asOf(fmtDate(bal.date)), title: undefined };
}

/** One line of the figures beside the balance: label left, amount right-aligned. */
function Figure({ label, labelClassName, title, children }: {
  label: ReactNode; labelClassName?: string; title?: string; children: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-6" title={title}>
      <dt className={cx('text-[14px] leading-snug', labelClassName ?? 'text-ink-2')}>{label}</dt>
      <dd className="text-[15px] leading-snug font-semibold text-ink">{children}</dd>
    </div>
  );
}

/** Shaped like the hero, for the moment before there is an account to show. */
function HeroSkeleton() {
  const t = useT();
  return (
    <section data-hero aria-busy="true" aria-label={t.insights.hero.loading} className="panel min-w-0 overflow-clip">
      <div className="px-5 pt-6 pb-6 sm:px-8 sm:pt-7">
        <Skeleton className="h-3.5 w-36 rounded-[4px]" />
        <Skeleton className="mt-4 h-11 w-64 max-w-full rounded-[6px]" />
        <Skeleton className="mt-3 h-3 w-28 rounded-[4px]" />
        <Skeleton className="mt-8 h-[152px] w-full rounded-[8px]" />
      </div>
    </section>
  );
}

/**
 * The balance, given the room a balance deserves — and what qualifies it.
 *
 * The figure leads, set at display size in the headline navy with the cents
 * stepped down, the way a bank's start page states it, under a label that
 * names the account it belongs to. Right under it, the day it is true for;
 * beside it the handful of figures that change what the balance means (how
 * much is actually available, the overdraft line, what is already reserved).
 * Then the verified Kontoverlauf, and finally the account line: whose
 * account, which IBAN, which BIC.
 *
 * Where there is no figure, the hero says why in its place — not fetched yet,
 * or failed with the bank's own reason — and offers the read that gets it.
 * A failure is never shown as "not fetched yet".
 *
 * A credit card speaks its own language: a Kartensaldo against a
 * Kreditrahmen, in ink rather than red — a card's balance is negative by
 * nature, so red would raise an alarm after every purchase.
 *
 * No buttons for the account's actions: Überweisen is the navigation's
 * floating button, Geld anfordern and Kontoauszug are under "Mehr", and all
 * three act on this same account. With a single account the list above stays away, and its
 * "Umbenennen" moves into the account line here.
 *
 * Past ranges: a statement fetched for a range that ended before today says
 * nothing about the balance *now*. Its closing figure is shown as "Saldo am
 * {Ende}" and is never labelled "Kontostand"; the current balance appears
 * only if a fetch up to today, or a balance enquiry, supplied it.
 */
export function AccountHero() {
  const {
    activeAccount: a, accounts, balances, statementInfo, txByAccount, pendingCache, pendingInfo, loadingAccount,
    balanceLoading, txErrors, balanceErrors, busy, privacy, togglePrivacy, isLoadedForAppliedRange, refreshAccount,
    loadBalance, accountLabel, banks, bankOf,
  } = useFints();
  // `tr`, not `t`: a booking is `t` in the filters below.
  const tr = useT();
  const words = tr.insights.hero;

  const figureRef = useRef<HTMLDivElement>(null);
  const acct = a?.accountNumber ?? '';
  const info = acct ? statementInfo[acct] : undefined;
  const txs = acct ? txByAccount[acct] : undefined;

  // Exactly this account's booked items from the one fetch the blocks came
  // from — pending items are not part of any statement and would break the
  // proof (lib/balance-history.ts) — carried back over the kept Umsätze where
  // their kept balances agree (lib/history.ts).
  const history = useMemo(() => (info && txs ? accountBalanceHistory(txs, info) : null), [info, txs]);

  // A phone shows the balance flat, under the search: the figure, Verfügbar
  // and a sparkline that opens the rest (the qualifying figures, the IBAN,
  // the Kontoverlauf) in place.
  const phone = usePhone();
  const [details, setDetails] = useState(false);
  const detailsId = useId();
  const phoneTitleId = useId();

  // No account at all (the bank listed none): the list says so; nothing to hold a place for.
  if (!a) return accounts.length ? <HeroSkeleton /> : null;
  // Renamed here when the list above stays away (a single account), and on a
  // phone always: its cards are for switching, the list's "Umbenennen" is the
  // wider window's.
  const renamable: Renamable = accounts.length === 1 && banks.length <= 1 ? 'always' : 'phone';
  // A Depot has no balance and no Kontoverlauf over FinTS: its value instead.
  if (isDepot(a)) {
    return phone ? (
      <div className="min-w-0">
        <div className="mb-3 flex min-h-12 items-center"><AccountSwitch label={accountLabel(a)} /></div>
        <DepotHero account={a} renamable={renamable} />
      </div>
    ) : <DepotHero account={a} renamable={renamable} />;
  }

  const bal = balances[acct];
  const statementLoading = loadingAccount === acct;
  const figureLoading = statementLoading || balanceLoading === acct;
  const failure = txErrors[acct] ?? balanceErrors[acct];
  const card = isCardAccount(a);
  const today = isoDate(new Date());
  const past = !!info && info.to < today;
  // A past range the kept Umsätze answered alone has no statement of its own:
  // its end balance is the one kept for that day, as the Kontoverlauf proves it.
  const keptEnd = past && info?.saved && !info.saved.fetched && history?.verified && history.to === info.to
    ? { balance: history.points[history.points.length - 1].balance, currency: history.currency }
    : null;
  const closing = past ? closingOf(info, a.currency) ?? keptEnd : null;
  const currency = bal?.currency ?? closing?.currency ?? a.currency ?? 'EUR';
  const dated = asOf(bal, tr);
  const label = accountLabel(a);
  const nowLabel = card ? words.cardBalance : tr.common.account.balance;
  const soleOfSeveral = accounts.length === 1 && banks.length > 1 && !!bankOf(a)?.bank.name;

  // What the big figure is: today's balance when known; for a past range
  // without one, that range's closing balance under its own name.
  const main: { label: string; value: number; currency: string } | null = bal
    ? { label: nowLabel, value: bal.balance, currency: bal.currency }
    : closing && info
      ? { label: words.balanceOn(fmtDate(info.to)), value: closing.balance, currency: closing.currency }
      : null;
  const negative = !!main && Math.round(main.value * 100) < 0;
  // Navy, or red for an overdrawn account. A card's negative balance is its
  // normal state: ink. With amounts hidden always navy — a colour would give
  // away what the dots hide.
  const figureColour = privacy || !negative ? 'text-headline' : card ? 'text-ink' : undefined;
  // On Android today's balance goes without its name and its date: the
  // account's name heads the figure, and a date is said only when it is not today.
  const plainNow = (main?.label ?? nowLabel) === nowLabel;
  const showDate = !(!privacy && dayKey(bal?.date) === today);

  /**
   * Fetches the figure the cheapest way that gets it: the statement while
   * the Umsätze are not loaded (one read brings both), the balance enquiry
   * once they are, or when the account has none to load. The button that
   * asked gives way to the fetch, so focus waits on the figure's place for
   * whatever arrives there — never dropped to <body>.
   */
  const fetchFigure = (via: 'auto' | 'balance' = 'auto') => {
    if (busy) return;
    figureRef.current?.focus({ preventScroll: true });
    if (via === 'auto' && a.canStatements && !(a.canBalance && isLoadedForAppliedRange(acct))) refreshAccount(a);
    else void loadBalance(a);
  };

  // Vorgemerkt: only once fetched (it can take a TAN, so it is never assumed
  // to be empty), only when something IS reserved — an amber "0,00 €" would
  // flag a state that needs no attention — and in the balance's currency only.
  const pending = (pendingCache[acct] ?? []).filter((t) => (t.currency || currency) === currency);
  const pendingSum = pending.reduce((s, t) => s + Math.round(t.amount * 100), 0) / 100;

  const figures: ReactNode[] = [];
  if (bal?.availableAmount != null) {
    figures.push(
      <Figure key="avail" label={tr.insights.available}>
        <Money value={bal.availableAmount} currency={bal.currency} tone="auto" />
      </Figure>,
    );
  }
  if (bal?.creditLimit != null && Math.round(bal.creditLimit * 100) !== 0) {
    figures.push(
      // A card's limit is a Kreditrahmen; a Dispositionsrahmen is a Girokonto's overdraft.
      <Figure key="limit" label={card ? words.creditLimit : words.overdraft}>
        <Money value={Math.abs(bal.creditLimit)} currency={bal.currency} tone="plain" />
      </Figure>,
    );
  }
  if (pending.length > 0) {
    // The list is only as fresh as its last fetch; one older than the
    // bookings beside it says so (the provider has already dropped what those
    // show as booked).
    const fetched = pendingInfo[acct];
    const stand = fetched
      ? ` · ${words.pendingAsOf(fmtSince(fetched.loadedAt), !!fetched.behindStatement)}`
      : '';
    figures.push(
      <Figure
        key="pending"
        label={tr.common.booking.pending}
        labelClassName="font-semibold text-amber"
        title={`${words.pendingCount(pending.length)}${stand}`}
      >
        <Money value={pendingSum} currency={currency} tone="plain" />
      </Figure>,
    );
  }
  if (bal && closing && info) {
    figures.push(
      <Figure key="closing" label={words.balanceOn(fmtDate(info.to))} title={words.closingHint}>
        <Money value={closing.balance} currency={closing.currency} tone={card ? 'plain' : 'auto'} />
      </Figure>,
    );
  }

  if (phone) {
    const available = bal?.availableAmount;
    const fresh = bal && info?.loadedAt ? tr.transactions.pending.asOf(fmtSince(info.loadedAt)) : null;
    // The sparkline is the way into the details: drawn only from a proven history.
    const spark = history?.verified && history.points.length > 1 ? history.points : null;
    return (
      <section aria-labelledby={phoneTitleId} className="min-w-0">
        <h2 id={phoneTitleId} className="sr-only">{words.title(label)}</h2>
        <div className="-mr-2 flex min-h-10 items-center justify-between gap-2">
          <AccountSwitch label={label} />
          <IconButton
            size="md"
            aria-label={privacy ? tr.common.showAmounts : tr.common.hideAmounts}
            onClick={togglePrivacy}
            className={cx('rounded-full', privacy && 'bg-[color-mix(in_srgb,var(--ink)_12%,transparent)]')}
          >
            {privacy ? <EyeOffIcon /> : <EyeIcon />}
          </IconButton>
        </div>

        <div className="flex items-end justify-between gap-4">
          <div ref={figureRef} tabIndex={-1} aria-busy={figureLoading || undefined} className="min-w-0 outline-none">
            {main ? (
              <>
                {!plainNow && <p className="text-[14px] leading-5 font-medium text-ink-2">{main.label}</p>}
                <p data-balance className={cx('leading-none', figureColour)}>
                  <Money
                    value={main.value}
                    currency={main.currency}
                    tone={card ? 'plain' : 'auto'}
                    split
                    className="text-[48px] leading-[56px] font-medium"
                    centsClassName="text-[0.58em]"
                  />
                </p>
                <p className="tnum mt-1 text-[14px] leading-5 text-ink-2">
                  {available != null && bal ? (
                    <>
                      {tr.insights.available}{' '}
                      <Money value={available} currency={bal.currency} tone="auto" className="font-medium text-ink" />
                    </>
                  ) : null}
                  {/* The date, or for today's figure how fresh it is (the time of the
                      read that brought it), on a line of its own under Verfügbar. */}
                  {(showDate ? dated : fresh) && (
                    <span className="block whitespace-nowrap" title={showDate ? dated?.title : undefined}>
                      {showDate ? dated?.text : fresh}
                    </span>
                  )}
                </p>
                {!bal && a.canBalance && (
                  <FetchAction
                    lead={balanceErrors[acct]
                      ? `${words.pastRange} ${words.currentFailed(card, balanceErrors[acct].message)}`
                      : words.pastRange}
                    label={balanceErrors[acct] ? tr.common.retry : words.loadCurrent(card)}
                    busy={busy}
                    loading={balanceLoading === acct}
                    run={() => fetchFigure('balance')}
                  />
                )}
              </>
            ) : figureLoading ? (
              <>
                <Skeleton className="mt-1 h-12 w-56 max-w-full rounded-[6px]" />
                <p className="mt-2 text-[14px] leading-5 text-ink-2">{words.fetchingDots}</p>
              </>
            ) : failure ? (
              <FigureNote
                problem
                title={tr.common.fetchFailed}
                action={{ label: tr.common.retry, run: () => fetchFigure() }}
                busy={busy}
              >
                {failure.message}
              </FigureNote>
            ) : canReportBalance(a) ? (
              <FigureNote title={words.noBalanceYet} action={{ label: tr.insights.loadBalance, run: () => fetchFigure() }} busy={busy} />
            ) : (
              <FigureNote title={words.noBalance}>
                {words.noBalanceHint}
              </FigureNote>
            )}
          </div>

          {(spark || figures.length > 0) && (
            // The figures behind the balance, opened in place: a press on the sparkline.
            <button
              type="button"
              aria-expanded={details}
              aria-controls={detailsId}
              aria-label={tr.insights.balanceChart.title}
              onClick={() => setDetails((d) => !d)}
              className="mb-1 grid h-12 w-[112px] shrink-0 place-items-center rounded-full outline-offset-2 transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)]"
            >
              {spark ? <Sparkline points={spark} /> : <ChevronIcon dir={details ? 'up' : 'down'} className="text-ink-2" />}
            </button>
          )}
        </div>

        <AccountGoal account={a} balance={bal?.balance ?? null} />

        {details && (
          <div id={detailsId} className="mt-4">
            {figures.length > 0 && <dl className="grid gap-y-2">{figures}</dl>}
            <AccountLine account={a} renamable={renamable} />
            <BalanceSection history={history} loading={statementLoading && !info} currency={currency} figure={!!main} />
          </div>
        )}
      </section>
    );
  }

  return (
    <HeroFrame label={label}>
      {/* A size container: whether the figures fit BESIDE the balance depends
          on the tile's own width (a two-column dashboard at 1100px gives it
          less room than a single column at 900px), not on the window's. */}
      <div className="@container px-5 pt-5 pb-6 sm:px-8 sm:pt-7 sm:pb-7">
        {/* The figure, and beside it (under it when narrow) what qualifies it. */}
        <div className="grid gap-x-10 gap-y-5 @min-[640px]:grid-cols-[minmax(0,1fr)_auto] @min-[640px]:items-end">
          <div ref={figureRef} tabIndex={-1} aria-busy={figureLoading || undefined} className="min-w-0 outline-none">
            {/* Which figure, and whose: two Girokonten must not look alike up here. */}
            <p className="text-[14px] leading-snug font-semibold text-ink-2">
              {plainNow ? label : (
                <>
                  {main?.label ?? nowLabel}
                  <span className="font-normal text-ink-3"> · {label}</span>
                </>
              )}
              {/* A phone with several banks and this one account shows no card
                  naming its bank (AccountList): the hero does. */}
              {soleOfSeveral && <span className="font-normal text-ink-3 sm:hidden"> · {bankOf(a)?.bank.name}</span>}
            </p>

            {main ? (
              <>
                <p className={cx('mt-1.5 leading-none font-bold tracking-[-0.015em]', figureColour)}>
                  <Money
                    value={main.value}
                    currency={main.currency}
                    tone={card ? 'plain' : 'auto'}
                    split
                    className="text-[40px] @min-[520px]:text-[52px]"
                    centsClassName="text-[0.5em] font-semibold"
                  />
                </p>
                {bal ? (showDate && (
                  <p className="tnum mt-2 text-[13px] leading-snug text-ink-3">
                    <span title={dated?.title}>
                      {dated?.text}
                      {dated?.title && <span className="sr-only">. {dated.title}</span>}
                    </span>
                    {/* Hidden amounts outlast a restart: whoever comes back to a
                        page of dots learns why here, and the way back. */}
                    {privacy && (
                      <>
                        {` · ${tr.insights.amountsHidden} `}
                        <button
                          type="button"
                          aria-label={tr.common.showAmounts}
                          onClick={togglePrivacy}
                          className="ml-1 font-semibold text-accent underline-offset-2 hover:underline"
                        >
                          {words.show}
                        </button>
                      </>
                    )}
                  </p>
                )) : a.canBalance ? (
                  // A past range's closing figure stands in for a balance the
                  // app does not know — the enquiry can still add it.
                  <FetchAction
                    lead={balanceErrors[acct]
                      ? `${words.pastRange} ${words.currentFailed(card, balanceErrors[acct].message)}`
                      : words.pastRange}
                    label={balanceErrors[acct] ? tr.common.retry : words.loadCurrent(card)}
                    busy={busy}
                    loading={balanceLoading === acct}
                    run={() => fetchFigure('balance')}
                  />
                ) : (
                  <p className="tnum mt-2 text-[13px] leading-snug text-ink-3">
                    {words.pastRangeHint(card)}
                  </p>
                )}
              </>
            ) : figureLoading ? (
              <>
                <Skeleton className="mt-2 h-10 w-56 max-w-full rounded-[6px] @min-[520px]:h-12" />
                <p className="mt-2 text-[13px] leading-snug text-ink-3">{words.fetchingDots}</p>
              </>
            ) : failure ? (
              <FigureNote
                problem
                title={tr.common.fetchFailed}
                action={{ label: tr.common.retry, run: () => fetchFigure() }}
                busy={busy}
              >
                {failure.message}
              </FigureNote>
            ) : canReportBalance(a) ? (
              <FigureNote title={words.noBalanceYet} action={{ label: tr.insights.loadBalance, run: () => fetchFigure() }} busy={busy} />
            ) : (
              <FigureNote title={words.noBalance}>
                {words.noBalanceHint}
              </FigureNote>
            )}
          </div>

          {figures.length > 0 && (
            <dl
              className={cx(
                'grid max-w-[440px] gap-y-2 border-t border-line pt-4',
                '@min-[640px]:max-w-none @min-[640px]:min-w-[264px] @min-[640px]:border-t-0 @min-[640px]:border-l @min-[640px]:py-1 @min-[640px]:pl-6',
              )}
            >
              {figures}
            </dl>
          )}
        </div>

        <AccountLine account={a} renamable={renamable} />
        <BalanceSection history={history} loading={statementLoading && !info} currency={currency} figure={!!main} />
      </div>

    </HeroFrame>
  );
}

/**
 * A Depot's hero: the value its holdings had at the bank's last report
 * (components/Portfolio.tsx lists them), with when that was. Until there is
 * one, this is the one place that offers the read, says it is under way, or
 * says why it failed — the Depot tile below and the account's row in the
 * list leave all of that here.
 */
function DepotHero({ account, renamable }: { account: SerializedAccount; renamable: Renamable }) {
  const { portfolios, portfolioLoading, portfolioErrors, loadPortfolio, busy, accountLabel } = useFints();
  const tr = useT();
  const words = tr.depot;
  const figureRef = useRef<HTMLDivElement>(null);
  const acct = account.accountNumber;
  const p = portfolios[acct];
  const loading = portfolioLoading === acct;
  const label = accountLabel(account);
  const failure = portfolioErrors[acct];
  // The button that asked gives way to the read: focus waits on the figure's
  // place for whatever arrives there — never dropped to <body>.
  const read = () => {
    if (busy) return;
    figureRef.current?.focus({ preventScroll: true });
    void loadPortfolio(account);
  };
  const asOf = p && (
    <p className="tnum mt-2 text-[13px] leading-snug text-ink-3">
      {words.asOf(new Intl.DateTimeFormat(intlLocale(), { hour: '2-digit', minute: '2-digit' }).format(new Date(p.readAt)))}
    </p>
  );
  return (
    <HeroFrame label={label}>
      <div className="@container px-5 pt-5 pb-6 sm:px-8 sm:pt-7 sm:pb-7">
        <div ref={figureRef} tabIndex={-1} aria-busy={loading || undefined} className="min-w-0 outline-none">
          <p className="text-[14px] leading-snug font-semibold text-ink-2">
            {words.total}
            <span className="font-normal text-ink-3"> · {label}</span>
          </p>
          {p?.totalValue != null ? (
            <>
              <p className="mt-1.5 leading-none font-bold tracking-[-0.015em] text-headline">
                <Money
                  value={p.totalValue}
                  currency={p.currency}
                  tone="plain"
                  split
                  className="text-[40px] @min-[520px]:text-[52px]"
                  centsClassName="text-[0.5em] font-semibold"
                />
              </p>
              {asOf}
            </>
          ) : loading ? (
            <Skeleton className="mt-2 h-10 w-56 max-w-full rounded-[6px] @min-[520px]:h-12" />
          ) : failure ? (
            <FigureNote problem title={tr.common.fetchFailed} action={{ label: tr.common.retry, run: read }} busy={busy}>
              {failure.message}
            </FigureNote>
          ) : p ? (
            <>
              <FigureNote title={words.noTotal} />
              {asOf}
            </>
          ) : (
            <FigureNote title={words.notRead} action={{ label: words.read, run: read }} busy={busy}>
              {words.intro}
            </FigureNote>
          )}
        </div>
        {/* The read, announced once — here, not again by the tile below. */}
        <p role="status" className="sr-only">{loading ? words.loading : ''}</p>
        <AccountLine account={account} renamable={renamable} />
      </div>
    </HeroFrame>
  );
}

/**
 * The account's name heading the phone's balance — and, where there is
 * another account or bank to go to, the way there: Material's bottom sheet
 * with the account list in its rows (components/overview/AccountList.tsx,
 * under [data-rows]), the banks apart, the Gesamtsaldo and "Anmelden" for a
 * bank not logged in. Choosing an account closes it.
 */
function AccountSwitch({ label }: { label: string }) {
  const { accounts, banks, activeAccount } = useFints();
  const t = useT();
  const [open, setOpen] = useState(false);
  const acct = activeAccount?.accountNumber;
  const shown = useRef(acct);
  useEffect(() => {
    if (shown.current !== acct) setOpen(false);
    shown.current = acct;
  }, [acct]);
  const several = accounts.length > 1 || banks.length > 1;
  if (!several) return <p className="min-w-0 truncate text-[16px] leading-6 font-medium text-ink-2">{label}</p>;
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="-ml-2 flex h-12 min-w-0 items-center gap-1 rounded-full pr-2 pl-2 text-[16px] font-medium text-ink-2 transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)]"
      >
        <span className="min-w-0 truncate">{label}</span>
        <ChevronIcon dir="down" size={16} className="shrink-0" />
      </button>
      <Overlay open={open} onClose={() => setOpen(false)} label={t.insights.accounts.title} align="bottom">
        <Sheet onClose={() => setOpen(false)}>
          <div data-rows className="-mx-1">
            <AccountList />
          </div>
        </Sheet>
      </Overlay>
    </>
  );
}

/** The Kontoverlauf as a glyph: a staircase in the primary, its last day a dot. */
function Sparkline({ points }: { points: readonly { balance: number }[] }) {
  const W = 96;
  const H = 36;
  const pad = 3;
  const values = points.map((p) => p.balance);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const x = (i: number) => pad + (i / (points.length - 1)) * (W - pad * 2);
  const y = (v: number) => pad + (1 - (v - lo) / span) * (H - pad * 2);
  let d = `M${x(0).toFixed(1)},${y(values[0]).toFixed(1)}`;
  for (let i = 1; i < values.length; i++) d += `H${x(i).toFixed(1)}V${y(values[i]).toFixed(1)}`;
  const last = values.length - 1;
  return (
    <svg aria-hidden width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
      <path d={`${d}V${H - pad}H${x(0).toFixed(1)}Z`} fill="var(--chart-area)" />
      <path d={d} fill="none" stroke="var(--chart-line)" strokeWidth={2} strokeLinejoin="round" />
      <circle cx={x(last)} cy={y(values[last])} r={3.5} fill="var(--chart-line)" />
    </svg>
  );
}

function HeroFrame({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const t = useT();
  return (
    <section data-hero className="panel min-w-0 overflow-clip" aria-labelledby={id}>
      <h2 id={id} className="sr-only">{t.insights.hero.title(label)}</h2>
      {children}
    </section>
  );
}

/**
 * In the figure's place: why there is none — and, when a read can change
 * that, the read, with the approval note beside it (the hero's one control
 * that asks the bank). Not a live region: the toast has already announced a
 * failure once.
 */
function FigureNote({
  title, problem, action, busy, children,
}: {
  title: string;
  problem?: boolean;
  action?: { label: string; run: () => void };
  busy?: boolean;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <div className="mt-2">
      <p className="flex items-center gap-2 text-[22px] leading-[1.25] font-bold text-ink">
        {problem && <AlertTriangleIcon size={22} className="shrink-0 text-red" />}
        {title}
      </p>
      {/* The reason as the bank (or the app) put it. */}
      {children && <p className="mt-1 max-w-[60ch] text-[14px] leading-snug text-ink-2">{children}</p>}
      {action && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Button size="sm" variant="secondary" iconLeft={<RefreshIcon size={16} />} disabled={busy} onClick={action.run}>
            {action.label}
          </Button>
          <span className="text-[13px] leading-snug text-ink-3">{t.common.mayNeedApproval}</span>
        </div>
      )}
    </div>
  );
}

/** The date line's place under a past range's figure: what it is, and the read that adds today's. */
function FetchAction({ lead, label, busy, loading, run }: {
  lead: string; label: string; busy: boolean; loading: boolean; run: () => void;
}) {
  const t = useT();
  return (
    <div className="mt-2 text-[13px] leading-snug text-ink-3">
      <p>{lead}</p>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
        <Button
          variant="tertiary"
          size="xs"
          className="-ml-3"
          iconLeft={<RefreshIcon size={15} />}
          busy={loading}
          disabled={busy}
          onClick={run}
        >
          {label}
        </Button>
        <span>{t.common.mayNeedApproval}</span>
      </p>
    </div>
  );
}

/** Where the balance offers renaming its account: at every width, or only on a phone. */
type Renamable = 'always' | 'phone';

/**
 * The account line, inside the balance, whose first line already names the
 * account: the number to hand to somebody else, copyable, and renaming, as an
 * icon — for the only account (no list above it) at every width, on a phone
 * for whichever is chosen. The holder is the user, and the BIC is in Geld
 * anfordern.
 */
function AccountLine({ account, renamable }: { account: SerializedAccount; renamable: Renamable }) {
  const { vaultStatus } = useFints();
  const t = useT();
  const [renaming, setRenaming] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const renameButton = useRef<HTMLElement>(null);
  const noteId = useId();

  // Focus goes back to the button that started renaming — never lost to <body>.
  const wasRenaming = useRef(false);
  useEffect(() => {
    if (!renaming && wasRenaming.current) renameButton.current?.focus();
    wasRenaming.current = renaming;
  }, [renaming]);

  // The explanation answers a click; once the vault is readable it is moot.
  useEffect(() => {
    if (vaultStatus === 'ready') setNoteOpen(false);
  }, [vaultStatus]);

  const startRenaming = () => {
    if (vaultStatus !== 'ready') setNoteOpen(true);
    else setRenaming(true);
  };

  const iban = fmtIban(account.iban);
  const ident = accountIdent(account);
  const idNode = iban ? (
    <span className="flex min-w-0 items-center gap-1">
      <span className="sr-only">IBAN </span>
      <span className="iban overflow-x-auto text-[13.5px] text-ink [scrollbar-width:none]">{iban}</span>
      <CopyButton text={iban.replace(/\s+/g, '')} label={t.common.account.copyIban} />
    </span>
  ) : ident.tail ? (
    // No IBAN (a credit card, a Depot): the number the bank reports,
    // grouped like a card prints it, the recognisable end set heavier.
    <span className="flex min-w-0 items-baseline gap-1.5 text-[13px] text-ink-3">
      <span aria-hidden className="shrink-0">{ident.kind === 'card' ? t.insights.hero.card : t.common.account.account}</span>
      <span aria-hidden className="iban flex min-w-0 text-[13.5px] text-ink-2">
        {ident.head && <span className="min-w-0 truncate">{ident.head}&nbsp;</span>}
        <span className="id-tail shrink-0">{ident.tail}</span>
      </span>
      <span className="sr-only">{ident.spoken}</span>
    </span>
  ) : null;
  const note = noteOpen && !renaming && (
    <Alert tone="info" role="status" className="mt-3" onDismiss={() => setNoteOpen(false)}>
      <span id={noteId}>{vaultNote(vaultStatus)}</span>
    </Alert>
  );

  return (
    <div className="mt-3">
      {renaming && renamable ? (
        <RenameForm account={account} onClose={() => setRenaming(false)} />
      ) : (
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1">{idNode}</span>
          {renamable && (
            <IconButton
              ref={renameButton}
              data-rename
              size="md"
              aria-label={t.insights.accounts.rename}
              aria-describedby={noteOpen ? noteId : undefined}
              onClick={startRenaming}
              className={renamable === 'phone' ? 'sm:hidden' : undefined}
            >
              <PencilIcon size={18} />
            </IconButton>
          )}
        </div>
      )}
      {note}
    </div>
  );
}

/** Renaming the only account, in place of its name. Escape or "Abbrechen" leaves it as it was. */
function RenameForm({ account, onClose }: { account: SerializedAccount; onClose: () => void }) {
  const { vault, renameAccount, toast } = useFints();
  const t = useT();
  const words = t.insights.hero;
  const saved = vault?.aliases?.[account.accountNumber] ?? null;
  const [draft, setDraft] = useState(saved ?? '');
  const input = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const custom = !!draft.trim();

  useEffect(() => {
    input.current?.focus();
  }, []);

  const save = (e: FormEvent) => {
    e.preventDefault();
    // Typing the bank's own name back in is the same as having no alias.
    const next = aliasFromDraft(account, draft);
    if (next !== saved) {
      renameAccount(account.accountNumber, next);
      toast(t.insights.accounts.namesSaved(1), 'success');
    }
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Escape') return;
    // Escape belongs to this field, not to whatever layer sits above the page.
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };

  return (
    <form onSubmit={save} noValidate aria-label={words.renameLabel}>
      <Field
        label={words.nameLabel}
        htmlFor={fieldId}
        className="max-w-[400px]"
        hint={words.nameHint}
      >
        {/* Always rendered (only hidden while there is nothing to reset):
            adding it on the first keystroke would wrap the input in a new
            element and drop the caret. */}
        <Input
          ref={input}
          value={draft}
          maxLength={MAX_ALIAS}
          placeholder={bankName(account)}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="done"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          trailing={
            <IconButton
              aria-label={t.insights.resetTo(bankName(account))}
              disabled={!custom}
              className={custom ? undefined : 'invisible'}
              onClick={() => {
                setDraft('');
                input.current?.focus();
              }}
            >
              <UndoIcon size={17} />
            </IconButton>
          }
        />
      </Field>
      {/* After the field, where Tab arrives — the primary action last. */}
      <div className="mt-3 flex justify-end gap-2 sm:justify-start">
        <Button variant="tertiary" size="sm" onClick={onClose}>{t.common.cancel}</Button>
        <Button variant="primary" size="sm" type="submit">{t.common.save}</Button>
      </div>
    </form>
  );
}

/** Kontoverlauf — or, when the bank's figures do not prove one, the reason why not. */
function BalanceSection({
  history, loading, currency, figure,
}: {
  history: BalanceHistory | null;
  loading: boolean;
  currency: string;
  /** A balance is shown above — which stays the bank's own, whatever the history. */
  figure: boolean;
}) {
  const t = useT();
  const words = t.insights.hero;
  if (loading) {
    return (
      <div className="mt-6 border-t border-line pt-5">
        <Skeleton className="h-3.5 w-28 rounded-[4px]" />
        <Skeleton className="mt-3 h-[152px] w-full rounded-[8px] sm:h-[188px]" />
      </div>
    );
  }
  if (!history) return null;

  if (!history.verified || history.points.length < 2) {
    const reason = history.verified ? words.historyTooShort : history.reason;
    return (
      <p className="mt-6 flex border-t border-line pt-5 items-start gap-2 text-[13px] leading-snug text-ink-3">
        <InfoIcon size={16} className="mt-px shrink-0" />
        <span>
          <span className="font-semibold text-ink-2">{words.noHistory}</span> {reason}
          {/* A history that does not add up says nothing against the figure above. */}
          {!history.verified && figure && ` ${words.figureStands}`}
        </span>
      </p>
    );
  }

  return (
    <figure className={IS_ANDROID ? 'mt-5' : 'mt-6 border-t border-line pt-5'}>
      {/* On Android the curve under the figure speaks for itself; its name stays for a screen reader. */}
      <figcaption className={IS_ANDROID ? 'sr-only' : 'mb-2 flex flex-wrap items-baseline justify-between gap-x-4'}>
        <span className="text-[14px] font-semibold text-ink">{t.insights.balanceChart.title}</span>
        <span className="tnum text-[13px] text-ink-3">{fmtRange(history.from, history.to)}</span>
      </figcaption>
      <BalanceChart points={history.points} currency={history.currency || currency} />
      {!IS_ANDROID && (
        <p className="mt-1 text-[12.5px] leading-snug text-ink-3">
          {words.historyCaption}
        </p>
      )}
    </figure>
  );
}
