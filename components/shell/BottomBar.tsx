'use client';

// The navigation, Material 3 Expressive's on every platform: the flexible
// navigation bar on a phone and, from 640px — the desktop window, a tablet,
// an open foldable — the navigation rail down the left edge (80dp), with
// Überweisen, the one action people open a banking app for, as the
// floating action button.
//
// The places: Übersicht, Analyse, Verträge, and "Mehr" — the command
// palette, which before any typing lists the main actions (Geld anfordern,
// Kontoauszug, …), the accounts and, last, Abmelden (lib/palette.ts). The
// Umsätze are a place inside the Übersicht, not a section of their own.
//
// The bar is 64dp (M3E's flexible bar, NavigationBarTokens); the current place
// has the 56 × 32 pill behind its icon, which springs open from the middle
// when the place is chosen, and a label in the secondary colour. On a phone
// Überweisen is the extended FAB above the bar's right end, which folds to
// its icon while the page scrolls down and opens out again on the way up or
// at the top; on the rail it is the FAB at the top. Colours come from the
// --nav-* and --fab-* tokens (app/material.css). The bar is a row of the
// page's flex column rather than a fixed layer, so the scrolling page ends
// above it by construction; [data-bottombar] tells the stylesheet it exists
// (--bottombar-h), which keeps toasts above it. The rail stands beside the
// shell, which makes room for it ([data-shell]).
//
// In the desktop shell the rail's head is part of the window's title bar:
// the app's mark, at the top app bar's height, and a drag handle like it.

import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { DashboardTab } from '@/lib/app-types';
import { useT } from '@/lib/i18n/react';
import { IS_ANDROID } from '@/lib/platform';
import { useFints } from '../FintsProvider';
import { ChartIcon, HomeIcon, MoreIcon, RepeatIcon, TransferIcon } from '../icons';
import { cx } from '../ui';
import type { ShellActions } from './actions';
import { BrandPlate } from './BrandMark';

const DRAG = { WebkitAppRegion: 'drag' } as CSSProperties;

export function BottomBar({ actions }: { actions: ShellActions }) {
  const { tab, setTab, setPaletteOpen } = useFints();
  const tr = useT();
  const go = (t: DashboardTab) => () => setTab(t);
  const extended = useFabExtended();
  // The same four places in the bar and in the rail.
  const items = (
    <>
      <NavItem icon={<HomeIcon size={22} />} label={tr.common.nav.overview} current={tab === 'overview'} onClick={go('overview')} />
      <NavItem icon={<ChartIcon size={22} />} label={tr.common.nav.analysis} current={tab === 'analysis'} onClick={go('analysis')} />
      <NavItem icon={<RepeatIcon size={22} />} label={tr.shell.bottomBar.contracts} current={tab === 'contracts'} onClick={go('contracts')} />
      <NavItem icon={<MoreIcon size={22} />} label={tr.common.more} onClick={() => setPaletteOpen(true)} haspopup />
    </>
  );

  return (
    <>
      <nav
        aria-label={tr.shell.bottomBar.label}
        data-bottombar
        className="relative z-30 shrink-0 bg-[var(--nav-bg)] pb-[env(safe-area-inset-bottom)] sm:hidden"
      >
        <ul className="grid h-16 grid-cols-4">{items}</ul>
      </nav>
      <nav
        aria-label={tr.shell.bottomBar.label}
        data-rail
        className={cx(
          // The rail stands on the page's own surface, as Material's does.
          'fixed inset-y-0 left-0 z-40 hidden w-20 flex-col items-center bg-paper sm:flex',
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
          <button
            type="button"
            onClick={actions.transfer}
            aria-label={tr.shell.transfer}
            title={tr.shell.transfer}
            className={cx(
              'mb-8 grid size-14 shrink-0 place-items-center rounded-2xl bg-[var(--fab-bg)] text-[var(--fab-ink)]',
              'shadow-[0_1px_3px_rgb(0_0_0/0.3),0_4px_8px_3px_rgb(0_0_0/0.15)] transition-[border-radius] hover:rounded-[20px] dark:shadow-none',
              !IS_ANDROID && 'mt-2',
            )}
          >
            <TransferIcon size={24} strokeWidth={2} />
          </button>
        )}
        <ul className="flex w-full flex-col gap-3">{items}</ul>
      </nav>
      {actions.canTransfer && (
        <button
          type="button"
          data-fab
          onClick={actions.transfer}
          aria-label={tr.shell.transfer}
          data-extended={extended || undefined}
          className={cx(
            'fixed right-4 bottom-[calc(var(--bottombar-h)+16px)] z-30 flex h-14 items-center overflow-hidden rounded-2xl',
            'bg-[var(--fab-bg)] text-[var(--fab-ink)] shadow-[0_4px_8px_3px_rgb(0_0_0/0.15),0_1px_3px_rgb(0_0_0/0.3)] sm:hidden',
            extended ? 'gap-2 px-4' : 'w-14 justify-center gap-0 px-0',
          )}
        >
          <TransferIcon size={24} strokeWidth={2} />
          <span className={cx('text-[14px] leading-5 font-semibold whitespace-nowrap', !extended && 'sr-only')}>{tr.shell.transfer}</span>
        </button>
      )}
    </>
  );
}

function NavItem({
  icon, label, current, onClick, haspopup,
}: { icon: ReactNode; label: string; current?: boolean; onClick: () => void; haspopup?: boolean }) {
  return (
    <li className="flex">
      <button
        type="button"
        onClick={onClick}
        aria-current={current ? 'page' : undefined}
        aria-haspopup={haspopup ? 'dialog' : undefined}
        data-nav-item
        className="group row-focus flex flex-1 flex-col items-center justify-start gap-1 pt-1.5 outline-none"
      >
        <span aria-hidden className="relative grid h-8 w-14 place-items-center">
          {/* The pill: drawn always, opened by the spring when the place is chosen. */}
          <span data-nav-indicator className="absolute inset-0 rounded-full bg-[var(--nav-indicator)]" />
          <span className={cx('relative', current ? 'text-[var(--nav-active)]' : 'text-[var(--nav-ink)]')}>{icon}</span>
        </span>
        <span className={cx('text-[12px] leading-4 font-medium tracking-[0.5px]', current ? 'text-[var(--nav-label-active)]' : 'text-[var(--nav-ink)]')}>
          {label}
        </span>
      </button>
    </li>
  );
}

/** Whether the FAB shows its label: at the top of the page and while scrolling up; folded while scrolling down. */
function useFabExtended(): boolean {
  const [extended, setExtended] = useState(true);
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('[data-scroll-root]');
    if (!root) return;
    let last = root.scrollTop;
    const onScroll = () => {
      const now = root.scrollTop;
      if (now < 24) setExtended(true);
      else if (Math.abs(now - last) > 6) setExtended(now < last);
      last = now;
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => root.removeEventListener('scroll', onScroll);
  }, []);
  return extended;
}
