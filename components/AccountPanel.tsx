'use client';

import { useState } from 'react';
import { fmtDate, fmtIban, fmtMoney, isFutureDate, splitMoney, translateType } from '@/lib/format';
import type { SerializedAccount } from '@/lib/fints-types';
import { BankLogo } from './BankLogo';
import { useFints } from './FintsProvider';
import { Button, Disclosure, cx } from './ui';

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
 * This block answers exactly one question — how much is in this account right
 * now — so nothing else competes inside it: the period filter belongs to the
 * list of bookings and lives down there with it, and the single action the
 * balance leads to is the one button on the panel.
 */
export function AccountHeader({ onTransfer }: { onTransfer: () => void }) {
  const { activeAccount: a, balances } = useFints();

  if (!a) return null;
  const bal = balances[a.accountNumber];
  const money = splitMoney(bal?.balance, bal?.currency);
  const negative = !!bal && bal.balance < 0;

  // The footnotes to the figure: written once here so the row below stays a
  // plain grid rather than a run of conditionals.
  const meta: { label: string; value: string; title?: string }[] = [];
  if (a.iban || a.accountNumber) meta.push({ label: 'IBAN', value: fmtIban(a.iban) || a.accountNumber });
  if (a.bic) meta.push({ label: 'BIC', value: a.bic });
  if (bal?.availableAmount != null) {
    meta.push({ label: 'Verfügbar', value: fmtMoney(bal.availableAmount, bal.currency) });
  }
  if (bal?.date) {
    meta.push(
      isFutureDate(bal.date)
        // An interim report's closing balance is dated to the bank's next
        // Buchungstag, so on a weekend it sits in the future. Say so rather
        // than presenting a future day as the balance's as-of date.
        ? {
            label: 'Buchungstag',
            value: fmtDate(bal.date),
            title: 'Die Bank datiert diesen Saldo auf ihren nächsten Buchungstag. Er enthält bereits Buchungen mit diesem Datum.',
          }
        : { label: 'Stand', value: fmtDate(bal.date) },
    );
  }

  return (
    <section className="panel mb-5 px-5 pt-6 pb-5 sm:px-8 sm:pt-8 sm:pb-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
        <div className="min-w-0">
          <p className="eyebrow">{translateType(a.accountType)} · Kontostand</p>
          {(a.holder || a.product) && (
            <p className="mt-1 truncate text-[15px] font-semibold">{a.holder || a.product}</p>
          )}

          <p
            className={cx(
              'num mt-4 text-[44px] leading-[1.05] font-semibold tracking-[-0.02em] sm:text-[56px]',
              negative && 'text-red',
            )}
          >
            {bal ? (
              <>
                {money.euros}
                <span className={cx('text-[0.52em] font-medium', negative ? 'text-red' : 'text-ink-2')}>
                  {money.cents}&nbsp;{money.suffix}
                </span>
              </>
            ) : '—'}
          </p>
        </div>

        {/* The one primary action on the page. */}
        {a.canTransfer && (
          <Button variant="primary" className="shrink-0 self-start" onClick={onTransfer}>
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden>
              <path d="M4 12h14m0 0l-5-5m5 5l-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Überweisen
          </Button>
        )}
      </div>

      <dl className="mt-7 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-4 sm:grid-cols-4">
        {meta.map((m) => (
          <div key={m.label} className="min-w-0" title={m.title}>
            <dt className="eyebrow">{m.label}</dt>
            <dd className={cx('mt-0.5 truncate text-[13px] font-medium text-ink-2', m.label === 'IBAN' ? 'iban' : 'num')}>
              {m.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
