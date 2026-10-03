'use client';

import { useId, useMemo } from 'react';
import type { ReactNode } from 'react';
import { buildBalanceHistory } from '@/lib/balance-history';
import { fmtDate, fmtIban, fmtRange, isFutureDate, isoDate, properName, translateType } from '@/lib/format';
import type { SerializedBalance } from '@/lib/fints-types';
import type { StatementInfo } from '@/lib/app-types';
import { useFints } from '../FintsProvider';
import { Money } from '../Money';
import { InfoIcon } from '../icons';
import { CopyButton, Skeleton, cx } from '../ui';
import { fmtSince } from '../shell/session';
import { AccountGlyph, accountIdent } from './AccountIdentity';
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
function asOf(bal: SerializedBalance | undefined) {
  if (!bal?.date) return null;
  return isFutureDate(bal.date)
    ? {
        text: `Buchungstag ${fmtDate(bal.date)}`,
        title: 'Die Bank datiert diesen Saldo auf ihren nächsten Buchungstag. Er enthält bereits Buchungen mit diesem Datum.',
      }
    : { text: `Stand ${fmtDate(bal.date)}`, title: undefined };
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
  return (
    <section aria-busy="true" aria-label="Kontostand wird geladen" className="panel min-w-0 overflow-clip">
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
 * stepped down, the way a bank's start page states it. Right under it, the
 * day it is true for; beside it the handful of figures that change what the
 * balance means (how much is actually available, the overdraft line, what is
 * already reserved). Then the verified Kontoverlauf, and finally the account
 * line: whose account, which IBAN, which BIC.
 *
 * No buttons of its own: Überweisen, Geld anfordern and Kontoauszug are the
 * stage's Schnellzugriffe right above, and act on this same account — a
 * second row of them here would only be the same three things twice.
 *
 * Past ranges: a statement fetched for a range that ended before today says
 * nothing about the balance *now*. Its closing figure is shown as "Saldo am
 * {Ende}" and is never labelled "Kontostand"; the current balance appears
 * only if an earlier fetch up to today supplied it.
 */
export function AccountHero() {
  const {
    activeAccount: a, balances, statementInfo, txByAccount, pendingCache, pendingInfo, loadingAccount, accountLabel,
  } = useFints();

  const acct = a?.accountNumber ?? '';
  const info = acct ? statementInfo[acct] : undefined;
  const txs = acct ? txByAccount[acct] : undefined;

  // Exactly this account's booked items from the one fetch the blocks came
  // from — pending items are not part of any statement and would break the
  // proof (lib/balance-history.ts).
  const history = useMemo(
    () => (info && txs ? buildBalanceHistory({ txs, blocks: info.blocks, range: { from: info.from, to: info.to } }) : null),
    [info, txs],
  );

  if (!a) return <HeroSkeleton />;

  const bal = balances[acct];
  const loading = loadingAccount === acct;
  const today = isoDate(new Date());
  const past = !!info && info.to < today;
  const closing = past ? closingOf(info, a.currency) : null;
  const currency = bal?.currency ?? closing?.currency ?? a.currency ?? 'EUR';
  const dated = asOf(bal);
  const kind = translateType(a.accountType);

  // What the big figure is: today's balance when known; for a past range
  // without one, that range's closing balance under its own name.
  const main: { label: string; value: number; currency: string } | null = bal
    ? { label: 'Kontostand', value: bal.balance, currency: bal.currency }
    : closing && info
      ? { label: `Saldo am ${fmtDate(info.to)}`, value: closing.balance, currency: closing.currency }
      : null;
  const negative = !!main && Math.round(main.value * 100) < 0;

  // Vorgemerkt: only once fetched (it can take a TAN, so it is never assumed
  // to be empty), only when something IS reserved — an amber "0,00 €" would
  // flag a state that needs no attention — and in the balance's currency only.
  const pending = (pendingCache[acct] ?? []).filter((t) => (t.currency || currency) === currency);
  const pendingSum = pending.reduce((s, t) => s + Math.round(t.amount * 100), 0) / 100;

  const figures: ReactNode[] = [];
  if (bal?.availableAmount != null) {
    figures.push(
      <Figure key="avail" label="Verfügbar">
        <Money value={bal.availableAmount} currency={bal.currency} tone="auto" />
      </Figure>,
    );
  }
  if (bal?.creditLimit != null && Math.round(bal.creditLimit * 100) !== 0) {
    figures.push(
      <Figure key="limit" label="Dispositionsrahmen">
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
      ? ` · Stand ${fmtSince(fetched.loadedAt)}${fetched.behindStatement ? ', vor dem letzten Umsatzabruf' : ''}`
      : '';
    figures.push(
      <Figure
        key="pending"
        label="Vorgemerkt"
        labelClassName="font-semibold text-amber"
        title={`${pending.length === 1 ? '1 vorgemerkter Umsatz' : `${pending.length} vorgemerkte Umsätze`}${stand}`}
      >
        <Money value={pendingSum} currency={currency} tone="plain" />
      </Figure>,
    );
  }
  if (bal && closing && info) {
    figures.push(
      <Figure key="closing" label={`Saldo am ${fmtDate(info.to)}`} title="Endsaldo des geladenen Zeitraums laut deiner Bank">
        <Money value={closing.balance} currency={closing.currency} tone="auto" />
      </Figure>,
    );
  }

  const iban = fmtIban(a.iban);
  const ident = accountIdent(a);
  const holder = properName(a.holder);
  const label = accountLabel(a);

  return (
    <HeroFrame label={label}>
      {/* A size container: whether the figures fit BESIDE the balance depends
          on the tile's own width (a two-column dashboard at 1100px gives it
          less room than a single column at 900px), not on the window's. */}
      <div className="@container px-5 pt-5 pb-6 sm:px-8 sm:pt-7 sm:pb-7">
        {/* The figure, and beside it (under it when narrow) what qualifies it. */}
        <div className="grid gap-x-10 gap-y-5 @min-[640px]:grid-cols-[minmax(0,1fr)_auto] @min-[640px]:items-end">
          <div className="min-w-0">
            <p className="text-[14px] leading-snug font-semibold text-ink-2">
              {main?.label ?? 'Kontostand'}
              {kind !== 'Konto' && <span className="font-normal text-ink-3"> · {kind}</span>}
            </p>

            {main ? (
              <p className={cx('mt-1.5 leading-none font-bold tracking-[-0.015em]', !negative && 'text-headline')}>
                <Money
                  value={main.value}
                  currency={main.currency}
                  tone="auto"
                  split
                  className="text-[40px] @min-[520px]:text-[52px]"
                  centsClassName="text-[0.5em] font-semibold"
                />
              </p>
            ) : loading ? (
              <span className="mt-2 block">
                <Skeleton className="h-10 w-56 max-w-full rounded-[6px] @min-[520px]:h-12" />
                <span className="sr-only">Kontostand wird abgerufen</span>
              </span>
            ) : (
              <p className="mt-1.5 text-[40px] leading-none font-bold text-ink-3 @min-[520px]:text-[52px]">–</p>
            )}

            <p className="tnum mt-2 text-[13px] leading-snug text-ink-3">
              {bal ? (
                <span title={dated?.title}>
                  {dated?.text}
                  {dated?.title && <span className="sr-only">. {dated.title}</span>}
                </span>
              ) : main ? (
                // A past range's closing figure, standing in for a balance the
                // app does not know: say why there is no "Kontostand".
                'Zeitraum endet vor heute – den aktuellen Kontostand zeigt ein Abruf bis heute.'
              ) : loading ? (
                'Saldo wird abgerufen …'
              ) : (
                'Noch kein Saldo abgerufen'
              )}
            </p>
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

        <BalanceSection history={history} loading={loading && !info} currency={currency} />
      </div>

      {/* The account line: what the account is called, whose it is, and the
          identifiers to hand to somebody else — each copyable. */}
      <div className="flex flex-col gap-3 border-t border-line bg-inset px-5 py-4 sm:flex-row sm:items-center sm:gap-4 sm:px-8">
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <AccountGlyph account={a} size={36} className="hidden sm:grid" />
          <span className="min-w-0">
            <span className="block truncate text-[15px] leading-snug font-semibold">{label}</span>
            {holder && <span className="block truncate text-[13px] leading-snug text-ink-3">{holder}</span>}
          </span>
        </span>

        <span className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 sm:justify-end">
          {iban ? (
            <span className="flex min-w-0 items-center gap-1">
              <span className="sr-only">IBAN </span>
              <span className="iban overflow-x-auto text-[13.5px] text-ink [scrollbar-width:none]">{iban}</span>
              <CopyButton text={iban.replace(/\s+/g, '')} label="IBAN kopieren" />
            </span>
          ) : ident.tail ? (
            // No IBAN (a credit card, a Depot): the number the bank reports,
            // grouped like a card prints it, the recognisable end set heavier.
            <span className="flex min-w-0 items-baseline gap-1.5 text-[13px] text-ink-3">
              <span aria-hidden className="shrink-0">{ident.kind === 'card' ? 'Karte' : 'Konto'}</span>
              <span aria-hidden className="iban flex min-w-0 text-[13.5px] text-ink-2">
                {ident.head && <span className="min-w-0 truncate">{ident.head}&nbsp;</span>}
                <span className="id-tail shrink-0">{ident.tail}</span>
              </span>
              <span className="sr-only">{ident.spoken}</span>
            </span>
          ) : null}
          {a.bic && (
            <span className="text-[13px] text-ink-3">
              BIC <span className="iban text-ink-2">{a.bic}</span>
            </span>
          )}
        </span>
      </div>
    </HeroFrame>
  );
}

function HeroFrame({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="panel min-w-0 overflow-clip" aria-labelledby={id}>
      <h2 id={id} className="sr-only">Konto {label}</h2>
      {children}
    </section>
  );
}

/** Kontoverlauf — or, when the bank's figures do not prove one, the reason why not. */
function BalanceSection({
  history, loading, currency,
}: {
  history: ReturnType<typeof buildBalanceHistory> | null;
  loading: boolean;
  currency: string;
}) {
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
    const reason = history.verified ? 'Der geladene Zeitraum ist zu kurz.' : history.reason;
    return (
      <p className="mt-6 flex border-t border-line pt-5 items-start gap-2 text-[13px] leading-snug text-ink-3">
        <InfoIcon size={16} className="mt-px shrink-0" />
        <span>
          <span className="font-semibold text-ink-2">Kein Kontoverlauf.</span> {reason}
        </span>
      </p>
    );
  }

  return (
    <figure className="mt-6 border-t border-line pt-5">
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4">
        <span className="text-[14px] font-semibold text-ink">Kontoverlauf</span>
        <span className="tnum text-[13px] text-ink-3">{fmtRange(history.from, history.to)}</span>
      </figcaption>
      <BalanceChart points={history.points} currency={history.currency || currency} />
      <p className="mt-1 text-[12.5px] leading-snug text-ink-3">
        Tagesendsaldo nach Buchungstag, nachgerechnet aus{' '}
        {history.blocks === 1 ? 'dem Kontoauszug' : `${history.blocks} Kontoauszügen`} deiner Bank.
      </p>
    </figure>
  );
}
