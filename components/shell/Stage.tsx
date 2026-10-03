'use client';

// The stage: the navy band a bank's start page opens with. It says who is
// looking and where they are before it shows a single figure, and it carries
// the Schnellzugriffe — the few things people come to do.
//
// Compact on purpose (~140px on a desktop, and the first row of tiles laps
// 48px over its lower edge): at the desktop shell's 900×600 minimum the
// account tiles must still be on screen without scrolling.

import type { ReactNode } from 'react';
import type { DashboardTab } from '@/lib/app-types';
import { useFints } from '../FintsProvider';
import { DownloadIcon, FileIcon, QrIcon, TransferIcon } from '../icons';
import { Button } from '../ui';
import type { ShellActions } from './actions';
import { firstName, greeting, useNow } from './session';

export const PAGE_TITLE_ID = 'page-title';

const TITLES: Record<DashboardTab, string> = {
  overview: 'Finanzübersicht',
  analysis: 'Umsatzanalyse',
  contracts: 'Verträge & Abos',
};

export function Stage({ actions }: { actions: ShellActions }) {
  const { tab, activeAccount, accounts } = useFints();
  // Re-read every few minutes, so a session left open over dinner does not
  // keep saying "Guten Tag".
  const now = useNow(5 * 60_000);
  const name = firstName(activeAccount?.holder || accounts[0]?.holder);

  return (
    <section aria-labelledby={PAGE_TITLE_ID} className="on-stage bg-stage">
      <div className="mx-auto w-full max-w-[1280px] px-4 pt-4 pb-[64px] sm:px-6 sm:pt-5">
        <div className="flex flex-col gap-x-8 gap-y-3.5 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="min-h-[1.4em] text-[15px] leading-snug text-stage-ink-2">
              {now != null && `${greeting(now)}${name ? `, ${name}` : ''}`}
            </p>
            <h1
              id={PAGE_TITLE_ID}
              tabIndex={-1}
              className="mt-0.5 text-[28px] leading-[1.15] font-bold text-stage-ink outline-none sm:text-[32px] desk:text-[36px]"
            >
              {TITLES[tab]}
            </h1>
          </div>
          <QuickActions actions={actions} />
        </div>
      </div>
    </section>
  );
}

// Below the desk breakpoint the pills drop to 36px and (above phone width)
// lose their glyphs, so all four still fit on one line beside the title at
// the desktop shell's 900px minimum — a second row would push the first
// tiles below the fold there. On a phone they become a 2×2 grid of equal,
// thumb-sized pills (44px) with their glyphs: all four in view at once, none
// cut off at the screen's edge.
const PILL =
  'max-sm:h-11 max-sm:w-full max-sm:min-w-0 max-sm:px-3 max-sm:text-[14px] desk:h-11 desk:px-5 desk:text-[14px]';
const glyph = (icon: ReactNode) => <span className="contents sm:max-desk:hidden">{icon}</span>;

function QuickActions({ actions: a }: { actions: ShellActions }) {
  const { singleKeyShortcuts: singleKeys } = useFints();
  const needsData = 'Erst wenn Umsätze geladen sind';
  return (
    <div
      role="group"
      aria-label="Schnellzugriffe"
      // Without Überweisen (no account allows it) the phone grid has three:
      // the last one takes the whole row rather than leaving a hole.
      className="grid grid-cols-2 gap-2 max-sm:[&>:last-child:nth-child(odd)]:col-span-2 sm:flex sm:flex-wrap"
    >
      {a.canTransfer && (
        <Button
          variant="stage-primary"
          size="sm"
          className={PILL}
          iconLeft={glyph(<TransferIcon size={17} />)}
          aria-keyshortcuts={singleKeys ? 'N' : undefined}
          onClick={a.transfer}
        >
          Überweisen
        </Button>
      )}
      <Button variant="stage" size="sm" className={PILL} iconLeft={glyph(<QrIcon size={17} />)} disabled={!a.canShare} onClick={a.share}>
        Geld anfordern
      </Button>
      <Button
        variant="stage"
        size="sm"
        className={PILL}
        iconLeft={glyph(<FileIcon size={17} />)}
        disabled={!a.canStatement}
        title={a.canStatement ? `Kontoauszug als PDF für ${a.rangeLabel}` : needsData}
        onClick={a.statement}
      >
        Kontoauszug
      </Button>
      <Button
        variant="stage"
        size="sm"
        className={PILL}
        iconLeft={glyph(<DownloadIcon size={17} />)}
        disabled={!a.canExport}
        title={a.canExport
          ? `Umsätze ${a.rangeLabel} als CSV-Datei (Excel)`
          : a.loaded ? `Keine Umsätze im Zeitraum ${a.rangeLabel}` : needsData}
        onClick={a.exportCsv}
      >
        Export
      </Button>
    </div>
  );
}
