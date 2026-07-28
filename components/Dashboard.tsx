'use client';

import { useEffect, useState } from 'react';
import pkg from '../package.json';
import { fmtDate, properName } from '@/lib/format';
import { BankLogo } from './BankLogo';
import { useFints } from './FintsProvider';
import { AccountList, AccountHeader } from './AccountPanel';
import { Transactions } from './Transactions';
import { TransferSheet } from './TransferSheet';
import { ThemeToggle } from './ThemeToggle';
import { Button, PowerIcon, ShieldIcon } from './ui';

/** The hour of day, said the way a counter clerk would say it. */
function greeting(at: Date | null): string {
  const h = (at ?? new Date()).getHours();
  if (h < 11) return 'Guten Morgen';
  if (h < 18) return 'Guten Tag';
  return 'Guten Abend';
}

/**
 * The shell: a navy masthead, the institute bar beneath it, then the page.
 *
 * The masthead is the app's own identity — wordmark left, session cluster right
 * — and the tier under it says which institute this session is talking to, so
 * the bank's mark never competes with the app's. The page proper opens the way
 * a bank's start page does: it says where you are and who you are before it
 * shows you a number.
 */
export function Dashboard() {
  const { bank, logoFiles, activeAccount, deviceRemembered, forgetDevice, logout } = useFints();
  const [transferFor, setTransferFor] = useState<string | null>(null);

  // Read after mount: this session began in this window, and a clock rendered
  // on the server would be reporting a different one.
  const [openedAt, setOpenedAt] = useState<Date | null>(null);
  useEffect(() => setOpenedAt(new Date()), []);

  const holder = properName(activeAccount?.holder || '');
  const bankLogo = <BankLogo brand={bank?.brand || 'generic'} size="sm" file={logoFiles[bank?.brand || '']} />;

  return (
    <div className="flex h-dvh flex-col">
      {/* Not a scroll container: the page below scrolls on its own (see the
          wrapper further down), so the OS-drawn scrollbar never runs through
          this row — it would otherwise cut across the WCO caption buttons. */}
      <header className="shrink-0 z-40">
        {/* Tier 1 — the masthead: whose app this is, and whose session. Also the
            title bar in the desktop shell: draggable except for its controls.
            bar-caption-safe keeps its content clear of the OS caption buttons
            the Window Controls Overlay API floats over the right edge (see
            electron/main.cjs and --caption-inset in globals.css); it collapses
            to the bar's normal padding outside the desktop shell. */}
        <div
          className="on-bar bar-caption-safe flex items-center gap-3 bg-bar pl-4 text-bar-ink sm:pl-6"
          style={{
            height: 'var(--barbar-h)',
            WebkitAppRegion: 'drag',
          } as React.CSSProperties}
        >
          <span className="flex items-center gap-2.5">
            {/* The app's own mark, so the wordmark reads as a masthead rather
                than as a line of text that happens to sit top left. */}
            <span
              aria-hidden
              className="num grid size-8 shrink-0 place-items-center rounded-[9px] bg-[color-mix(in_srgb,var(--bar-ink)_14%,transparent)] text-[15px] font-semibold"
            >
              €
            </span>
            <span className="font-display text-[19px] leading-none font-semibold tracking-tight">
              Sooskasse<span className="text-bar-ink-2">-FinTS</span>
            </span>
            <span className="num hidden self-end pb-px text-[11px] leading-none text-bar-ink-2 sm:inline">
              v{pkg.version}
            </span>
          </span>

          <div className="flex-1" />

          <div
            className="flex items-center gap-0.5 sm:gap-1"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <ThemeToggle labelled />
            <span aria-hidden className="mx-1.5 hidden h-5 w-px bg-[color-mix(in_srgb,var(--bar-ink)_20%,transparent)] sm:block" />
            <Button variant="bar" size="sm" className="rounded-full px-3.5" onClick={() => void logout()}>
              <PowerIcon />
              Abmelden
            </Button>
          </div>
        </div>

        {/* Tier 2 — the connected institute and the state of this device. */}
        <div
          className="flex items-center gap-3 border-b border-line bg-surface px-4 sm:px-6"
          style={{ height: 'var(--subbar-h)' }}
        >
          {bankLogo}
          <div className="flex min-w-0 items-baseline gap-2.5">
            <span className="truncate text-[14.5px] font-semibold">{bank?.name || 'Keine Bank verbunden'}</span>
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

      {/* Everything below the title bar scrolls on its own — this is the box
          whose scrollbar the OS actually draws, kept clear of the row above. */}
      <div className="flex-1 overflow-y-auto flex flex-col">
        {/* The page's own opening: what this screen is, what can be done from it,
            and who is looking at it — stated before the first figure. */}
        <div className="mx-auto w-full max-w-[1240px] px-4 pt-7 sm:px-6 sm:pt-9">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <h1 className="font-display text-[30px] leading-none font-semibold tracking-tight sm:text-[35px]">
              Finanzübersicht
            </h1>

            {/* The one primary action on the page, at the head of the page it
                acts on — the balance below it is what it draws from. */}
            {activeAccount?.canTransfer && (
              <Button
                variant="primary"
                className="rounded-full"
                onClick={() => setTransferFor(activeAccount?.accountNumber ?? null)}
              >
                Überweisung
                <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden>
                  <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              </Button>
            )}
          </div>

          <p className="mt-5 text-[17px] leading-snug font-semibold sm:text-[18px]">
            {greeting(openedAt)}{holder ? `, ${holder}` : ''}
          </p>
        </div>

        <div className="mx-auto grid w-full max-w-[1240px] flex-1 gap-5 px-4 pt-6 pb-14 sm:px-6 lg:grid-cols-[312px_minmax(0,1fr)] lg:gap-7">
          {/* The account switcher only. */}
          <aside className="min-w-0">
            <AccountList />
          </aside>

          <main className="min-w-0">
            <AccountHeader />
            <Transactions />
          </main>
        </div>

        {/* The closing edge of the page. Nothing new is stated here — the
            institute, the legal row and when this session started, which is the
            shape every German bank closes an online-banking page with. */}
        <footer className="mt-auto border-t border-line bg-surface">
          <div className="mx-auto w-full max-w-[1240px] px-4 py-8 sm:px-6">
            <div className="flex flex-col items-center gap-3.5 text-center">
              <p className="text-[12px] text-ink-3">
                Angemeldet seit:{' '}
                <span className="num">
                  {openedAt
                    ? `${fmtDate(openedAt)}, ${openedAt.getHours()}:${String(openedAt.getMinutes()).padStart(2, '0')} Uhr`
                    : '—'}
                </span>
              </p>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 border-t border-line pt-4 text-[11.5px] text-ink-3 sm:justify-between">
              <span className="font-semibold text-ink-2">Sooskasse-FinTS · Direktzugang über FinTS 3.0</span>
              <span className="flex items-center gap-1.5">
                <ShieldIcon size={12} />
                Direkte Verbindung von diesem Rechner zu {bank?.name || 'deiner Bank'}
              </span>
            </div>
          </div>
        </footer>
      </div>

      {transferFor !== null && (
        <TransferSheet preselect={transferFor} onClose={() => setTransferFor(null)} />
      )}
    </div>
  );
}
