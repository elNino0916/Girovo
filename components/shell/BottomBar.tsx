'use client';

// The phone's bottom bar: the three sections within thumb reach, the one
// action people open a banking app for in the middle, and "Mehr" for
// everything else: the command palette, which before any typing lists the
// main actions, the accounts and, last, Abmelden (lib/palette.ts).
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

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { DashboardTab } from '@/lib/app-types';
import { useT } from '@/lib/i18n/react';
import { IS_ANDROID } from '@/lib/platform';
import { useFints } from '../FintsProvider';
import { ChartIcon, HomeIcon, MoreIcon, RepeatIcon, TransferIcon } from '../icons';
import { cx } from '../ui';
import type { ShellActions } from './actions';

export function BottomBar({ actions }: { actions: ShellActions }) {
  if (IS_ANDROID) return <NavigationBar actions={actions} />;
  return <WebBottomBar actions={actions} />;
}

function WebBottomBar({ actions }: { actions: ShellActions }) {
  const { tab, setTab, setPaletteOpen } = useFints();
  const tr = useT();
  // (The Dashboard scrolls a newly chosen section to its top.)
  const go = (t: DashboardTab) => () => setTab(t);

  return (
    <nav
      aria-label={tr.shell.bottomBar.label}
      data-bottombar
      className="relative z-30 shrink-0 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_16px_-10px_rgb(10_30_60/0.18)] sm:hidden dark:shadow-none"
    >
      <ul className={cx('grid h-16', actions.canTransfer ? 'grid-cols-5' : 'grid-cols-4')}>
        <BarItem icon={<HomeIcon size={22} />} label={tr.common.nav.overview} current={tab === 'overview'} onClick={go('overview')} />
        <BarItem icon={<ChartIcon size={22} />} label={tr.common.nav.analysis} current={tab === 'analysis'} onClick={go('analysis')} />
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
              <span className="text-[12.5px] leading-none font-semibold text-ink">{tr.shell.transfer}</span>
            </button>
          </li>
        )}
        <BarItem icon={<RepeatIcon size={22} />} label={tr.shell.bottomBar.contracts} current={tab === 'contracts'} onClick={go('contracts')} />
        <BarItem
          icon={<MoreIcon size={22} />}
          label={tr.common.more}
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
          'row-focus relative flex flex-1 flex-col items-center justify-center gap-1 text-[12.5px] leading-none font-semibold transition-colors duration-150',
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

// ---------------------------------------------------------------------------
// The Android app's navigation: Material 3 Expressive's flexible navigation
// bar and, for the one action people open a banking app for, its extended
// floating action button.
//
// The same places as the bar above — Übersicht, Analyse, Verträge, Mehr. The
// bar is 64dp (M3E's flexible bar, NavigationBarTokens); the current place has
// the 56 × 32 pill behind its icon, which springs open from the middle when
// the place is chosen, and a label in the secondary colour. Überweisen leaves
// the row for the extended FAB above its right end, which folds to its icon
// while the page scrolls down and opens out again on the way up or at the
// top. Colours come from the --nav-* and --fab-* tokens (app/android.css):
// Material You's roles, or Girovo's palette.
//
// From 640px — a tablet, an open foldable, a phone on its side — Material's
// navigation rail takes over down the left edge (80dp), with Überweisen as
// the FAB at its top; the shell makes room for it ([data-shell]).

function NavigationBar({ actions }: { actions: ShellActions }) {
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
        className="fixed inset-y-0 left-0 z-40 hidden w-20 flex-col items-center bg-[var(--nav-bg)] pt-[calc(env(safe-area-inset-top)+16px)] sm:flex"
      >
        {actions.canTransfer && (
          <button
            type="button"
            onClick={actions.transfer}
            aria-label={tr.shell.transfer}
            title={tr.shell.transfer}
            className="mb-8 grid size-14 shrink-0 place-items-center rounded-2xl bg-[var(--fab-bg)] text-[var(--fab-ink)] shadow-[0_1px_3px_rgb(0_0_0/0.3),0_4px_8px_3px_rgb(0_0_0/0.15)]"
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
