'use client';

import { useState } from 'react';
import { BankLogo } from './BankLogo';
import { useFints } from './FintsProvider';
import { AccountList, AccountHeader } from './AccountPanel';
import { Transactions } from './Transactions';
import { TransferSheet } from './TransferSheet';
import { ThemeToggle } from './ThemeToggle';
import { Button, ShieldIcon } from './ui';

export function Dashboard() {
  const { bank, logoFiles, accounts, activeAccount, deviceRemembered, forgetDevice, logout } = useFints();
  const [transferFor, setTransferFor] = useState<string | null>(null);
  const canTransfer = accounts.some((a) => a.canTransfer);

  return (
    <>
      <header
        className="sticky top-0 z-40 flex items-center gap-3 border-b border-line bg-surface px-4 sm:px-5"
        style={{ height: 'var(--topbar-h)' }}
      >
        <BankLogo brand={bank?.brand || 'generic'} size="sm" file={logoFiles[bank?.brand || '']} />
        <div className="min-w-0">
          <div className="truncate text-[14.5px] font-semibold">{bank?.name || 'Sooskasse-FinTS'}</div>
          <div className="num text-[11px] text-ink-3">{bank?.blz ? `BLZ ${bank.blz}` : ''}</div>
        </div>

        <div className="flex-1" />

        {deviceRemembered && (
          <>
            <span
              title="Dieses Gerät ist gemerkt — die Bank fragt seltener nach einer TAN."
              className="hidden items-center gap-1.5 rounded-full bg-green-soft px-2.5 py-1 text-[11.5px] font-semibold text-green sm:inline-flex"
            >
              <ShieldIcon size={13} check />
              Gerät gemerkt
            </span>
            <Button size="sm" onClick={() => void forgetDevice()}>Gerät vergessen</Button>
          </>
        )}
        <ThemeToggle />
        <Button size="sm" onClick={() => void logout()}>Abmelden</Button>
      </header>

      <div className="mx-auto grid max-w-[1200px] gap-5 px-4 pt-5 pb-16 sm:px-5 lg:grid-cols-[304px_minmax(0,1fr)] lg:gap-6">
        <aside className="flex min-w-0 flex-col gap-2.5">
          <p className="eyebrow hidden px-0.5 lg:block">Konten</p>
          <AccountList />
          {canTransfer && (
            <Button
              variant="primary"
              block
              className="mt-1 hidden lg:inline-flex"
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

      {transferFor !== null && (
        <TransferSheet preselect={transferFor} onClose={() => setTransferFor(null)} />
      )}
    </>
  );
}
