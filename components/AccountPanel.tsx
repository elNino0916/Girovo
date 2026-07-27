'use client';

import { useState } from 'react';
import { fmtDate, fmtIban, fmtMoney, isFutureDate, isoDate, splitMoney, translateType } from '@/lib/format';
import type { SerializedAccount } from '@/lib/fints-types';
import { BankLogo } from './BankLogo';
import { useFints } from './FintsProvider';
import { Button, Disclosure, cx } from './ui';

/**
 * The capabilities an account has, named by the FinTS segment that grants them.
 * These codes are the honest explanation for a greyed-out action: the bank
 * simply doesn't advertise that segment for this account.
 */
function segments(a: SerializedAccount): { code: string; label: string }[] {
  const out: { code: string; label: string }[] = [];
  if (a.canStatements) out.push({ code: 'HKKAZ', label: 'Umsätze' });
  if (a.canPending) out.push({ code: 'HKVMK', label: 'Vorgemerkte Umsätze' });
  if (a.canTransfer) out.push({ code: 'HKCCS', label: 'Überweisung' });
  if (a.canInstant) out.push({ code: 'HKIPZ', label: 'Echtzeitüberweisung' });
  return out;
}

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
        <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto px-3 pb-3 lg:flex-col lg:gap-0 lg:overflow-visible lg:px-0 lg:pb-1">
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
                  'flex min-w-[232px] shrink-0 snap-start items-center gap-3 rounded-[10px] px-3 py-2.5 text-left',
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

export function AccountHeader({ onTransfer }: { onTransfer: () => void }) {
  const { activeAccount: a, balances, refreshAccount, busy, printStatement } = useFints();
  const [from, setFrom] = useState(() => isoDate(new Date(Date.now() - 90 * 86400000)));
  const [to, setTo] = useState(() => isoDate(new Date()));

  if (!a) return null;
  const bal = balances[a.accountNumber];
  const money = splitMoney(bal?.balance, bal?.currency);
  const negative = !!bal && bal.balance < 0;

  return (
    <section className="panel mb-5 px-5 py-5 sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="eyebrow">{translateType(a.accountType)} · Kontostand</p>
          <p className="text-sm font-semibold">{a.holder || a.product || ''}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          {a.canTransfer && <Button variant="primary" size="sm" onClick={onTransfer}>Überweisen</Button>}
          <Button size="sm" disabled={busy} onClick={() => refreshAccount(a, from, to)} title="Umsätze neu laden">
            Aktualisieren
          </Button>
        </div>
      </div>

      <p className={cx('num mt-2.5 text-[40px] leading-[1.1] font-semibold tracking-tight sm:text-[46px]', negative && 'text-red')}>
        {bal ? (
          <>
            {money.euros}
            <span className={cx('text-[0.6em]', negative ? 'text-red' : 'text-ink-2')}>
              {money.cents}&nbsp;{money.suffix}
            </span>
          </>
        ) : '—'}
      </p>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12.5px] text-ink-3">
        <span className="iban">{fmtIban(a.iban) || a.accountNumber}</span>
        {a.bic && <span>BIC <b className="num font-semibold text-ink-2">{a.bic}</b></span>}
        {bal?.availableAmount != null && (
          <span>Verfügbar <b className="num font-semibold text-ink-2">{fmtMoney(bal.availableAmount, bal.currency)}</b></span>
        )}
        {bal?.date && (
          isFutureDate(bal.date) ? (
            // An interim report's closing balance is dated to the bank's next
            // Buchungstag, so on a weekend it sits in the future. Say so rather
            // than presenting a future day as the balance's as-of date.
            <span title="Die Bank datiert diesen Saldo auf ihren nächsten Buchungstag. Er enthält bereits Buchungen mit diesem Datum.">
              Buchungstag <b className="num font-semibold text-ink-2">{fmtDate(bal.date)}</b>
            </span>
          ) : (
            <span>Stand <b className="num font-semibold text-ink-2">{fmtDate(bal.date)}</b></span>
          )
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3.5">
        <span className="flex flex-wrap gap-x-3 gap-y-1">
          {segments(a).map((s) => (
            <span key={s.code} className="segcode" title={s.label}>{s.code}</span>
          ))}
        </span>
        {/* Full width on phones so the two date fields can shrink instead of
            pushing the page into a horizontal scroll. */}
        <span className="ml-auto flex w-full flex-wrap items-center gap-1.5 sm:w-auto">
          <input
            type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Zeitraum von"
            className="num min-w-0 flex-1 rounded-[9px] border border-line bg-surface px-2 py-1.5 text-[12.5px] text-ink-2 outline-none focus:border-accent sm:flex-none"
          />
          <span className="text-ink-3">–</span>
          <input
            type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Zeitraum bis"
            className="num min-w-0 flex-1 rounded-[9px] border border-line bg-surface px-2 py-1.5 text-[12.5px] text-ink-2 outline-none focus:border-accent sm:flex-none"
          />
          <Button size="sm" className="shrink-0" disabled={busy} onClick={() => refreshAccount(a, from, to)}>Laden</Button>
          <Button
            size="sm"
            className="shrink-0"
            onClick={() => printStatement(from, to)}
            title="Kontoauszug für den gewählten Zeitraum als PDF speichern"
          >
            Kontoauszug (PDF)
          </Button>
        </span>
      </div>
    </section>
  );
}
