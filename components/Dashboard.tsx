'use client';

import { useState } from 'react';
import { BankLogo } from './BankLogo';
import { useFints } from './FintsProvider';
import { AccountList, AccountHeader } from './AccountPanel';
import { Transactions } from './Transactions';
import { TransferSheet } from './TransferSheet';
import { ThemeToggle } from './ThemeToggle';
import { Button, ShieldIcon } from './ui';

/**
 * The shell: a navy identity bar, an account bar beneath it, then the page.
 *
 * The two rows carry different questions — "which app and whose session" up
 * top, "which institute am I connected to" below — so the bank's own mark
 * never competes with the app's, and the session controls stay in one corner
 * instead of being mixed in among the bank's details.
 */
export function Dashboard() {
  const { bank, logoFiles, accounts, activeAccount, deviceRemembered, forgetDevice, logout } = useFints();
  const [transferFor, setTransferFor] = useState<string | null>(null);
  const canTransfer = accounts.some((a) => a.canTransfer);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40">
        {/* Row 1 — identity and session. */}
        <div
          className="on-bar flex items-center gap-3 bg-bar px-4 text-bar-ink sm:px-6"
          style={{ height: 'var(--barbar-h)' }}
        >
          <span className="font-display text-[17px] leading-none font-semibold tracking-tight">
            Sooskasse<span className="text-bar-ink-2">-FinTS</span>
          </span>

          <div className="flex-1" />

          <ThemeToggle tone="bar" />
          <Button variant="bar" size="sm" onClick={() => void logout()}>Abmelden</Button>
        </div>

        {/* Row 2 — the connected institute and the state of this device. */}
        <div
          className="flex items-center gap-3 border-b border-line bg-surface px-4 sm:px-6"
          style={{ height: 'var(--subbar-h)' }}
        >
          <BankLogo brand={bank?.brand || 'generic'} size="sm" file={logoFiles[bank?.brand || '']} />
          <div className="flex min-w-0 items-baseline gap-2.5">
            <span className="truncate text-[14px] font-semibold">{bank?.name || 'Keine Bank verbunden'}</span>
            {bank?.blz && <span className="num hidden text-[11.5px] text-ink-3 sm:inline">BLZ {bank.blz}</span>}
          </div>

          <div className="flex-1" />

          {deviceRemembered && (
            <>
              <span
                title="Dieses Gerät ist gemerkt — die Bank fragt seltener nach einer TAN."
                className="hidden items-center gap-1.5 text-[12px] font-semibold text-accent sm:inline-flex"
              >
                <ShieldIcon size={13} check />
                Gerät gemerkt
              </span>
              <Button size="sm" variant="quiet" onClick={() => void forgetDevice()}>Gerät vergessen</Button>
            </>
          )}
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[1240px] flex-1 gap-5 px-4 pt-6 pb-14 sm:px-6 lg:grid-cols-[312px_minmax(0,1fr)] lg:gap-7">
        <aside className="flex min-w-0 flex-col gap-3">
          <AccountList />
          {canTransfer && (
            <Button
              variant="primary"
              block
              className="hidden lg:inline-flex"
              onClick={() => setTransferFor(activeAccount?.accountNumber ?? null)}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden>
                <path d="M4 12h14m0 0l-5-5m5 5l-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Neue Überweisung
            </Button>
          )}
        </aside>

        <main className="min-w-0">
          <AccountHeader onTransfer={() => setTransferFor(activeAccount?.accountNumber ?? null)} />
          <Transactions />
        </main>
      </div>

      {/* The closing edge of the page. Nothing new is stated here — it repeats
          what the connection already is, which is what a footer is for. */}
      <footer className="border-t border-line px-4 py-5 sm:px-6">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-5 gap-y-1.5 text-[12px] text-ink-3">
          <span className="font-semibold text-ink-2">Sooskasse-FinTS</span>
          <span>Direktzugang über FinTS 3.0</span>
          <span className="ml-auto flex items-center gap-1.5">
            <ShieldIcon size={13} />
            Direkte Verbindung von diesem Rechner zu {bank?.name || 'deiner Bank'}
          </span>
        </div>
      </footer>

      {transferFor !== null && (
        <TransferSheet preselect={transferFor} onClose={() => setTransferFor(null)} />
      )}
    </div>
  );
}
