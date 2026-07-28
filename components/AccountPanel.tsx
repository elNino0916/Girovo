'use client';

import { useState } from 'react';
import { fmtDate, fmtIban, fmtMoney, isFutureDate, splitMoney, translateType } from '@/lib/format';
import type { SerializedAccount } from '@/lib/fints-types';
import { BankLogo } from './BankLogo';
import { useFints } from './FintsProvider';
import { Disclosure, cx } from './ui';

/**
 * An IBAN read as a name rather than a number: the country and bank half
 * recedes and the account tail stays full strength, because picking your own
 * account out of a list of four is done on the last two groups.
 */
function AccountId({ account }: { account: SerializedAccount }) {
  const formatted = fmtIban(account.iban);
  if (!formatted) return <span className="num text-[11.5px] text-ink-3">{account.accountNumber}</span>;
  const groups = formatted.split(' ');
  const head = groups.slice(0, -2).join(' ');
  const tail = groups.slice(-2).join(' ');
  return (
    <span className="iban block truncate text-[11.5px] text-ink-3">
      {head} <span className="id-tail">{tail}</span>
    </span>
  );
}

/**
 * The account switcher. One collapsible group of rows — mark and name on the
 * left, identifier beneath, balance right-aligned — which is the shape every
 * German banking front end gives a Kontenübersicht, and the shape a balance is
 * easiest to compare down a column in.
 */
export function AccountList() {
  const { accounts, activeAccount, balances, loadingAccount, selectAccount, bank, logoFiles } = useFints();
  const [open, setOpen] = useState(true);

  return (
    <div className="panel overflow-clip">
      <Disclosure
        open={open}
        onToggle={() => setOpen(!open)}
        title={<span className="section-head">Konten und Karten</span>}
      >
        {/* Horizontal on phones, where a column of full-width rows would push
            the statement itself below the fold. */}
        <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto px-3 pb-3 lg:flex-col lg:gap-0 lg:overflow-visible lg:px-0 lg:pb-2">
          {accounts.map((a) => {
            const bal = balances[a.accountNumber];
            const isLoading = loadingAccount === a.accountNumber;
            const active = activeAccount?.accountNumber === a.accountNumber;
            const negative = !!bal && bal.balance < 0;
            return (
              <button
                key={a.accountNumber}
                type="button"
                onClick={() => selectAccount(a)}
                aria-current={active}
                className={cx(
                  'flex min-w-[236px] shrink-0 snap-start items-center gap-3 rounded-[10px] px-3 py-3 text-left',
                  'transition-colors duration-150 lg:w-full lg:min-w-0 lg:rounded-none lg:px-4',
                  // The active row is named by a navy rail and navy label —
                  // one accent doing the work a second colour would do worse.
                  active
                    ? 'bg-accent-soft lg:border-l-2 lg:border-accent lg:pl-[14px]'
                    : 'hover:bg-inset lg:border-l-2 lg:border-transparent lg:pl-[14px]',
                )}
              >
                <BankLogo brand={bank?.brand || 'generic'} size="sm" file={logoFiles[bank?.brand || '']} />

                <span className="min-w-0 flex-1">
                  <span className={cx('block truncate text-[13.5px] font-semibold', active && 'text-accent')}>
                    {a.product || translateType(a.accountType)}
                  </span>
                  <AccountId account={a} />
                </span>

                <span className="shrink-0 text-right">
                  {bal ? (
                    <span className={cx('num block text-[13.5px] font-semibold', negative ? 'text-red' : 'text-green')}>
                      {fmtMoney(bal.balance, bal.currency)}
                    </span>
                  ) : (
                    <span className="block text-[11.5px] font-medium text-ink-3">
                      {isLoading ? 'lädt …' : 'öffnen'}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </Disclosure>
    </div>
  );
}

/**
 * The balance, given the room a balance deserves.
 *
 * The figure gets the panel to itself — it is the one thing this screen exists
 * to say, so it is set at display size with nothing beside it to share the eye
 * with. Everything that qualifies it (which account, whose, how much of it is
 * available, as of when) drops to a single quiet line along the bottom edge:
 * the account line every German bank writes as mark, label and right-aligned
 * value. The period filter belongs to the list of bookings and lives down there
 * with it; the action the balance leads to sits at the head of the page.
 */
export function AccountHeader() {
  const { activeAccount: a, balances } = useFints();

  if (!a) return null;
  const bal = balances[a.accountNumber];
  const money = splitMoney(bal?.balance, bal?.currency);
  const negative = !!bal && bal.balance < 0;

  // An interim report's closing balance is dated to the bank's next
  // Buchungstag, so on a weekend it sits in the future. Say which day it is
  // rather than presenting a future date as the balance's as-of date.
  const dated = bal?.date
    ? isFutureDate(bal.date)
      ? {
          label: 'Buchungstag',
          value: fmtDate(bal.date),
          title: 'Die Bank datiert diesen Saldo auf ihren nächsten Buchungstag. Er enthält bereits Buchungen mit diesem Datum.',
        }
      : { label: 'Stand', value: fmtDate(bal.date), title: undefined }
    : null;

  return (
    <section className="panel mb-5 overflow-clip">
      <div className="px-6 pt-8 pb-8 sm:px-10 sm:pt-11 sm:pb-10">
        <p className="eyebrow">Kontostand · {translateType(a.accountType)}</p>

        <p
          className={cx(
            'num mt-3 text-[38px] leading-[1] font-semibold tracking-[-0.02em] sm:mt-3.5 sm:text-[52px]',
            negative && 'text-red',
          )}
        >
          {bal ? (
            <>
              {money.euros}
              <span className={cx('text-[0.5em] font-medium', negative ? 'text-red' : 'text-ink-2')}>
                {money.cents}&nbsp;{money.suffix}
              </span>
            </>
          ) : '—'}
        </p>
      </div>

      {/* The account line: what the account is called, what identifies it — and
          the figures that qualify the balance, right-aligned. The institute's
          mark is already stated twice above this row, in the header and on the
          account it was picked from, so it is not repeated here. */}
      <div className="flex items-center gap-3.5 bg-inset px-6 py-4 sm:px-10">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] leading-snug font-semibold">
            {a.product || translateType(a.accountType)}
          </span>
          <span className="block truncate text-[11.5px] leading-snug text-ink-3">
            <span className="iban">{fmtIban(a.iban) || a.accountNumber}</span>
            {a.bic && <span className="hidden lg:inline"> · BIC {a.bic}</span>}
          </span>
        </span>

        <span className="shrink-0 text-right" title={dated?.title}>
          {bal?.availableAmount != null && (
            <span className="block text-[12.5px] leading-snug text-ink-3">
              Verfügbar{' '}
              <span className="num font-semibold text-ink-2">{fmtMoney(bal.availableAmount, bal.currency)}</span>
            </span>
          )}
          {dated && (
            <span className="num block text-[11px] leading-snug text-ink-3">
              {dated.label} {dated.value}
            </span>
          )}
        </span>
      </div>
    </section>
  );
}
