'use client';

// The phone's bottom bar: the three sections within thumb reach, the one
// action people open a banking app for in the middle, and "Mehr" for
// everything else (it opens the command palette, which lists it all).
// It mirrors the institute bar's sections and nothing else: the Umsätze are
// a place inside the Übersicht (the Übersicht's own "Zu den Umsätzen" and
// the palette's "Umsätze durchsuchen" go there), not a section with a
// "you are here" of its own.
//
// It is a row of the page's flex column rather than a fixed layer, so the
// scrolling page ends above it by construction. [data-bottombar] tells the
// stylesheet it exists (--bottombar-h), which is what keeps toasts above it.
// Its shadows are the light theme's only: at night a surface lifts by tone
// and its 1px edge (the hairline on top), never by a shadow.

import type { ReactNode } from 'react';
import type { DashboardTab } from '@/lib/app-types';
import { useFints } from '../FintsProvider';
import { ChartIcon, HomeIcon, MoreIcon, RepeatIcon, TransferIcon } from '../icons';
import { cx } from '../ui';
import type { ShellActions } from './actions';

export function BottomBar({ actions }: { actions: ShellActions }) {
  const { tab, setTab, setPaletteOpen } = useFints();
  // (The Dashboard scrolls a newly chosen section to its top.)
  const go = (t: DashboardTab) => () => setTab(t);

  return (
    <nav
      aria-label="Hauptnavigation"
      data-bottombar
      className="relative z-30 shrink-0 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_16px_-10px_rgb(10_30_60/0.18)] sm:hidden dark:shadow-none"
    >
      <ul className={cx('grid h-16', actions.canTransfer ? 'grid-cols-5' : 'grid-cols-4')}>
        <BarItem icon={<HomeIcon size={22} />} label="Übersicht" current={tab === 'overview'} onClick={go('overview')} />
        <BarItem icon={<ChartIcon size={22} />} label="Analyse" current={tab === 'analysis'} onClick={go('analysis')} />
        {actions.canTransfer && (
          <li className="flex justify-center">
            <button
              type="button"
              onClick={actions.transfer}
              className="group flex min-w-0 flex-col items-center gap-1 pt-0 outline-none"
            >
              {/* The round button sits proud of the bar, ringed in the bar's own
                  surface so it reads as cut out of it rather than stuck on. */}
              <span
                aria-hidden
                className="-mt-5 grid size-[52px] place-items-center rounded-full bg-accent text-accent-ink shadow-[0_4px_10px_-2px_rgb(10_30_60/0.35)] ring-4 ring-surface transition-colors duration-150 group-hover:bg-accent-hover group-active:bg-accent-press group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-focus dark:shadow-none"
              >
                {/* The transfer's own glyph, as on every other Überweisen —
                    the "€" is the app's mark, not an action. */}
                <TransferIcon size={24} strokeWidth={2.1} />
              </span>
              {/* Ink, not blue: blue under the bar marks where you ARE; the round
                  button already says what it does. */}
              <span className="text-[12px] leading-none font-semibold text-ink">Überweisen</span>
            </button>
          </li>
        )}
        <BarItem icon={<RepeatIcon size={22} />} label="Verträge" current={tab === 'contracts'} onClick={go('contracts')} />
        <BarItem
          icon={<MoreIcon size={22} />}
          label="Mehr"
          onClick={() => setPaletteOpen(true)}
          haspopup
        />
      </ul>
    </nav>
  );
}

function BarItem({
  icon, label, current, onClick, haspopup,
}: { icon: ReactNode; label: string; current?: boolean; onClick: () => void; haspopup?: boolean }) {
  return (
    <li className="flex">
      <button
        type="button"
        onClick={onClick}
        aria-current={current ? 'page' : undefined}
        aria-haspopup={haspopup ? 'dialog' : undefined}
        className={cx(
          'row-focus relative flex flex-1 flex-col items-center justify-center gap-1 text-[12px] leading-none font-semibold transition-colors duration-150',
          current ? 'text-accent' : 'text-ink-2 active:text-ink',
        )}
      >
        {current && <span aria-hidden className="absolute inset-x-[30%] top-0 h-[3px] rounded-b-full bg-accent" />}
        {icon}
        {label}
      </button>
    </li>
  );
}
