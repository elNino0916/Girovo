'use client';

// The shell: an app's, on every platform (DESIGN.md, Material 3 Expressive) —
// one top app bar that names the page (Masthead), the page beneath it, and
// the navigation: Material's bar on a phone, its rail down the left edge from
// 640px (BottomBar), with Überweisen as its floating action button. The bank
// is in the Sitzung panel and, with several, on the accounts; Geld anfordern
// and Kontoauszug are under "Mehr" (the palette) and on the balance.
//
// The top app bar never scrolls. Everything under it scrolls in its own
// container ([data-scroll-root]) — that is the box whose scrollbar the OS
// draws, kept clear of the desktop shell's caption buttons, and the box the
// overlays lock while they are open. Sticky things inside the page (day
// headers in Umsätze, the side pane) stick to its top edge.
//
// The page is flat and list-first: sections stand on the page itself. The
// Übersicht is the phone's at every width, search first, in one column
// (Overview below).

import { useEffect, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import { IS_ANDROID } from '@/lib/platform';
import { PlusScreen } from './android/Plus';
import { isDepot } from '@/lib/balances';
import { useFints } from './FintsProvider';
import { AccountHero } from './AccountPanel';
import { MonthFigures } from './overview/MonthFigures';
import { Transactions } from './Transactions';
import { Portfolio } from './Portfolio';
import { Analysis } from './Analysis';
import { Contracts } from './Contracts';
import { Settings } from './settings/Settings';
import { TransferSheet } from './TransferSheet';
import { AddBankSheet } from './AddBank';
import { ShareAccount } from './ShareAccount';
import { Inbox } from './Inbox';
import { CommandPalette } from './CommandPalette';
import { SessionGuard } from './SessionGuard';
import { ShortcutsHelp } from './ShortcutsHelp';
import { cx } from './ui';
import { useShellActions } from './shell/actions';
import { useGlobalShortcuts } from './shell/useShortcuts';
import { Masthead } from './shell/Masthead';
import { BottomBar } from './shell/BottomBar';
import { MerchantLogoConsent } from './MerchantLogoConsent';
import { UsageConsentTile } from './telemetry/UsageConsent';
import { trackUsage } from './telemetry/usage';
import { PullToRefresh } from './android/PullToRefresh';
import { useLaunches } from './android/useLaunches';

export function Dashboard() {
  const { tab, transferOpen, shareOpen } = useFints();
  const actions = useShellActions();
  useGlobalShortcuts(actions);
  // Android: a shortcut on the icon, or an invoice shared with the app.
  useLaunches(actions);
  const scrollRef = useRef<HTMLDivElement>(null);

  // A tab is a new page: it starts at its top.
  const firstTab = useRef(true);
  useEffect(() => {
    if (firstTab.current) {
      firstTab.current = false;
      return;
    }
    scrollRef.current?.scrollTo({ top: 0 });
  }, [tab]);

  // Usage (with the user's yes): which of the three pages is in use.
  useEffect(() => trackUsage('screen_viewed', { screen: tab }), [tab]);

  const rootRef = useRef<HTMLDivElement>(null);
  useScrollbarWidth(rootRef, scrollRef);

  return (
    <div ref={rootRef} data-shell className="flex h-dvh flex-col bg-paper">
      {/* "Zum Inhalt springen" is the masthead's first child — see Masthead. */}
      <header className="shrink-0">
        <Masthead />
      </header>

      <div ref={scrollRef} data-scroll-root className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {/* One page at a time, named by the top app bar's title (its h1). */}
        <main
          id="main"
          className={cx(
            'relative mx-auto w-full px-4 pt-2 pb-6 sm:pb-12',
            // The Übersicht is one column under the search bar, as wide as it (Masthead, SEARCH_EDGES).
            tab === 'overview' ? 'max-w-[960px]' : 'max-w-[1280px] sm:px-6',
            // No navigation bar under Einstellungen on a phone: the page's end clears the gesture bar itself.
            tab === 'settings' && 'max-sm:pb-[calc(env(safe-area-inset-bottom,0px)+32px)]',
          )}
        >
          {/* Keyed by the place, so each opens with Material's fade-through (app/android.css). */}
          <div key={tab} data-place>
            {tab === 'overview' && <Overview />}
            {tab === 'analysis' && <Analysis />}
            {tab === 'contracts' && <Contracts />}
            {tab === 'settings' && <Settings />}
          </div>
        </main>
      </div>

      <BottomBar actions={actions} />
      {IS_ANDROID && <PullToRefresh scrollRef={scrollRef} />}

      {transferOpen && <TransferSheet />}
      {shareOpen && <ShareAccount />}
      {IS_ANDROID && <PlusScreen />}
      <AddBankSheet />
      <Inbox />
      <CommandPalette />
      <SessionGuard />
      <ShortcutsHelp />
    </div>
  );
}

/**
 * The Übersicht: one column, search first — the phone's (owner, 2026-10-23),
 * every width's since the desktop followed it ("Suche oben", 2026-10-24).
 * The search bar is the top bar (Masthead). Under it the balance, set flat,
 * with the account's name as the way to the others (a sheet with the
 * account list, the Gesamtsaldo and the banks); on a wide window a quiet line
 * of the month's figures; then the chips and the bookings, which start on
 * the first screen.
 *
 * What stood beside them once has a place of its own: the Vorgemerkt behind
 * their chip, the Mitteilungen behind the avatar, what is due and the
 * forecast in Zahlungen, the month in Analyse. A consent that asks once
 * (company logos, usage data) stands between the balance and the bookings
 * while it asks. The markup is the reading order.
 */
function Overview() {
  const { activeAccount } = useFints();
  const depot = !!activeAccount && isDepot(activeAccount);

  return (
    <div className="flex flex-col gap-3 sm:gap-6">
      <Slot name="hero"><AccountHero /></Slot>
      {/* A Depot has no Umsätze to add up. */}
      {!depot && <Slot className="max-sm:hidden"><MonthFigures /></Slot>}
      <Slot><MerchantLogoConsent /></Slot>
      <Slot><UsageConsentTile /></Slot>
      {/* A Depot has no Umsätze over FinTS: its holdings take their place. */}
      <Slot name="transactions">
        {depot ? <Portfolio /> : <Transactions />}
      </Slot>
    </div>
  );
}

/** A grid cell. Empty tiles (a component that renders nothing) leave no gap behind. */
function Slot({ name, className, children }: { name?: string; className?: string; children: ReactNode }) {
  return <div data-slot={name} className={cx('min-w-0 empty:hidden', className)}>{children}</div>;
}

/**
 * Publishes the scroller's scrollbar width as `--sbw` on the shell root.
 *
 * The page column is centred in what is left of the scroller beside its
 * scrollbar (15px on Windows, 0 with overlay scrollbars), while the two
 * header tiers above it span the whole window — so without this the
 * masthead's "€" and the page title would sit half a scrollbar apart. The
 * header tiers subtract the width again (see Masthead's EDGES and the
 * InstituteBar's right padding). Written straight to the style, not React
 * state: it changes whenever the page grows past the window or shrinks back,
 * and nothing else needs to re-render for that.
 */
function useScrollbarWidth(root: RefObject<HTMLElement | null>, scroller: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const target = root.current;
    const el = scroller.current;
    if (!target || !el || typeof ResizeObserver === 'undefined') return;
    // What the page column cannot use at the scroller's right edge: the
    // scrollbar, or — while an overlay locks the page — the padding that
    // stands in for it (lockPageScroll in ui.tsx), so the header holds still
    // when a dialog opens. A scrollbar coming or going changes the scroller's
    // content box, which is what the (default content-box) observer reports;
    // the lock swapping one for the other leaves it, and the value, as is.
    const measure = () => {
      const pad = parseFloat(getComputedStyle(el).paddingRight) || 0;
      target.style.setProperty('--sbw', `${Math.max(0, el.offsetWidth - el.clientWidth + pad)}px`);
    };
    // In the next frame, as in useScrollEdges (ui.tsx): written inside the
    // observer's callback, --sbw would move the layout within the same
    // delivery — a "ResizeObserver loop" on every zoom step.
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    ro.observe(el);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [root, scroller]);
}
