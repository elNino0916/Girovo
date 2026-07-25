'use client';

import { useState } from 'react';
import { fmtDate, fmtIban, fmtMoney, isFutureDate, isoDate, splitMoney, translateType } from '@/lib/format';
import type { SerializedAccount } from '@/lib/fints-types';
import { useFints } from './FintsProvider';
import { Button, cx } from './ui';

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

export function AccountList() {
  const { accounts, activeAccount, balances, loadingAccount, selectAccount } = useFints();

  return (
    <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
      {accounts.map((a) => {
        const bal = balances[a.accountNumber];
        const isLoading = loadingAccount === a.accountNumber;
        const active = activeAccount?.accountNumber === a.accountNumber;
        return (
          <button
            key={a.accountNumber}
            type="button"
            onClick={() => selectAccount(a)}
            aria-current={active}
            className={cx(
              'min-w-[236px] shrink-0 snap-start rounded-[12px] border bg-surface px-3.5 py-3 text-left',
              'transition-[border-color,box-shadow] duration-150 lg:w-full lg:min-w-0',
              active ? 'border-green shadow-[0_0_0_1px_var(--green)]' : 'border-line hover:border-line-strong',
            )}
          >
            <div className="mb-1.5 flex items-center gap-2">
              <span className="eyebrow">{translateType(a.accountType)}</span>
              {a.product && (
                <span className="ml-auto max-w-[55%] truncate text-[11px] text-ink-3" title={a.product}>
                  {a.product}
                </span>
              )}
            </div>
            <div className="num truncate text-[12px] text-ink-2">
              {fmtIban(a.iban) || a.accountNumber}
            </div>
            {bal ? (
              <div className={cx('num mt-1.5 text-[17px] font-semibold', bal.balance < 0 && 'text-red')}>
                {fmtMoney(bal.balance, bal.currency)}
              </div>
            ) : (
              <div className="mt-1.5 text-[12.5px] font-medium text-ink-3">
                {isLoading ? 'Wird geladen …' : 'Zum Laden auswählen'}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function AccountHeader({ onTransfer }: { onTransfer: () => void }) {
  const { activeAccount: a, balances, refreshAccount, busy } = useFints();
  const [from, setFrom] = useState(() => isoDate(new Date(Date.now() - 90 * 86400000)));
  const [to, setTo] = useState(() => isoDate(new Date()));

  if (!a) return null;
  const bal = balances[a.accountNumber];
  const money = splitMoney(bal?.balance, bal?.currency);
  const negative = !!bal && bal.balance < 0;

  return (
    <section className="mb-4 rounded-[12px] border border-line bg-surface px-5 py-4 sm:px-6 sm:py-5">
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
        <span className="num">{fmtIban(a.iban) || a.accountNumber}</span>
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

      <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3">
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
            className="num min-w-0 flex-1 rounded-[9px] border border-line bg-surface px-2 py-1.5 text-[12.5px] text-ink-2 outline-none focus:border-green sm:flex-none"
          />
          <span className="text-ink-3">–</span>
          <input
            type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Zeitraum bis"
            className="num min-w-0 flex-1 rounded-[9px] border border-line bg-surface px-2 py-1.5 text-[12.5px] text-ink-2 outline-none focus:border-green sm:flex-none"
          />
          <Button size="sm" className="shrink-0" disabled={busy} onClick={() => refreshAccount(a, from, to)}>Laden</Button>
        </span>
      </div>
    </section>
  );
}
