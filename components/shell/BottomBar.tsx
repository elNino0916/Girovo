'use client';

// The navigation, Material 3 Expressive's on every platform: the flexible
// navigation bar on a phone and, from 640px — the desktop window, a tablet,
// an open foldable — the navigation rail down the left edge (96dp).
//
// Three places: Übersicht (the accounts and their Umsätze), Zahlungen
// (Überweisen, Geld anfordern, the people paid lately, Verträge & Abos and
// the bank's orders) and Analyse. "Mehr" is gone: the search — the head of
// the phone's Übersicht, a search icon on the other pages, Strg K — lists
// the actions, the accounts, the settings and the Umsätze (lib/palette.ts).
// Nothing floats over the page on a phone: Überweisen is the first button
// of Zahlungen, and the search finds it too.
//
// All of it is M3E's (@m3e/web): the bar is its navigation bar (64dp,
// compact: the icon over the label), every place its nav item — the 56 × 32
// pill behind the current place's icon springs open when the place is
// chosen. The rail keeps Überweisen as its FAB in primary-container at the
// top, where it covers nothing. The rail is Girovo's own column of M3E's
// nav items, as M3E's compact rail lays them out, because it ends in a fifth
// place at its foot — Einstellungen (components/settings) — and on the
// desktop begins in the window's title bar. Which place is current is the
// app's state, never the item's own: M3E's flip on a click is cancelled.
// The bar is a row of the page's flex column rather than a fixed layer, so
// the scrolling page ends above it by construction; [data-bottombar] tells
// the stylesheet it exists (--bottombar-h), which keeps toasts above it. The
// rail stands beside the shell, which makes room for it ([data-shell]).
//
// In the desktop shell the rail's head is part of the window's title bar:
// the app's mark, at the top app bar's height, and a drag handle like it.

import { M3eFab } from '@m3e/react/fab';
import { M3eNavBar, M3eNavItem } from '@m3e/react/nav-bar';
import type { CSSProperties, ReactNode } from 'react';
import type { DashboardTab } from '@/lib/app-types';
import { useT } from '@/lib/i18n/react';
import { IS_ANDROID } from '@/lib/platform';
import { useFints } from '../FintsProvider';
import { ChartIcon, GearIcon, HomeIcon, TransferIcon } from '../icons';
import { cx } from '../ui';
import type { ShellActions } from './actions';
import { BrandPlate } from './BrandMark';

const DRAG = { WebkitAppRegion: 'drag' } as CSSProperties;

export function BottomBar({ actions }: { actions: ShellActions }) {
  const { tab, setTab, openSettings } = useFints();
  const tr = useT();
  const go = (t: DashboardTab) => () => setTab(t);
  // Einstellungen is no place of the phone's bar but a page under one (the
  // top app bar's way back): the bar does not stand beneath it.
  const subPage = tab === 'settings';
  // The same three places in the bar and in the rail: what you have, paying,
  // and where the money goes. The search (the Übersicht's head, the search
  // icon elsewhere, Strg K) took the place of "Mehr".
  const items = (
    <>
      {/* The current place's icon filled, as Android draws it. */}
      <NavItem icon={<HomeIcon size={24} filled={tab === 'overview'} />} label={tr.common.nav.overview} current={tab === 'overview'} onClick={go('overview')} />
      <NavItem icon={<TransferIcon size={24} filled={tab === 'contracts'} />} label={tr.shell.bottomBar.contracts} current={tab === 'contracts'} onClick={go('contracts')} />
      <NavItem icon={<ChartIcon size={24} filled={tab === 'analysis'} />} label={tr.common.nav.analysis} current={tab === 'analysis'} onClick={go('analysis')} />
    </>
  );

  return (
    <>
      {!subPage && (
        <div data-bottombar className="relative z-30 shrink-0 bg-[var(--nav-bg)] pb-[env(safe-area-inset-bottom)] sm:hidden">
          <M3eNavBar mode="compact" aria-label={tr.shell.bottomBar.label} className="block h-16">
            {items}
          </M3eNavBar>
        </div>
      )}
      <nav
        aria-label={tr.shell.bottomBar.label}
        data-rail
        className={cx(
          // The rail stands on the page's own surface, as Material's does.
          'fixed inset-y-0 left-0 z-40 hidden w-24 flex-col items-center bg-paper sm:flex',
          IS_ANDROID && 'pt-[calc(env(safe-area-inset-top)+16px)]',
        )}
      >
        {/* The desktop: the app's mark, in the title bar's strip. */}
        {!IS_ANDROID && (
          <div className="grid h-[var(--barbar-h)] w-full shrink-0 place-items-center" style={DRAG}>
            <BrandPlate />
          </div>
        )}
        {actions.canTransfer && (
          // In the rail the FAB sits flat on its surface, as M3E's rail sets it.
          <M3eFab
            variant="primary-container"
            size="small"
            lowered
            aria-label={tr.shell.transfer}
            title={tr.shell.transfer}
            onClick={actions.transfer}
            className={cx('mb-8 shrink-0', !IS_ANDROID && 'mt-2')}
          >
            <TransferIcon size={24} strokeWidth={2} />
          </M3eFab>
        )}
        <div className="flex w-full flex-col gap-3">{items}</div>
        {/* Einstellungen at the rail's foot, as Material puts it: set once,
            so out of the way of the places used every day. On a phone it is
            the Sitzung panel's and the search's ("Mehr"). */}
        <div className="mt-auto flex w-full flex-col pt-3 pb-[calc(env(safe-area-inset-bottom)+16px)]">
          <NavItem icon={<GearIcon size={24} />} label={tr.common.nav.settings} current={tab === 'settings'} onClick={() => openSettings()} />
        </div>
      </nav>
    </>
  );
}

/** Which place is current is the app's to say: M3E would select an item on its own click. */
const keepPlace = (e: Event) => e.preventDefault();

function NavItem({
  icon, label, current, onClick,
}: { icon: ReactNode; label: string; current?: boolean; onClick: () => void }) {
  return (
    <M3eNavItem
      // Selected, M3E marks it aria-current itself.
      selected={!!current}
      data-nav-item
      onBeforeInput={keepPlace}
      onClick={onClick}
    >
      <span slot="icon" className="inline-flex">{icon}</span>
      {label}
    </M3eNavItem>
  );
}
