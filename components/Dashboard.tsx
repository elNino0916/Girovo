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
// The page is flat and list-first: sections stand on the page itself, and
// the one container is the balance. On a wide window the Übersicht has two
// panes — the balance and the bookings, and beside them the small summaries
// in a pane of their own; below that it is the phone's: the balance,
// Vorgemerkt and the bookings.

import { useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { useT } from '@/lib/i18n/react';
import { IS_ANDROID } from '@/lib/platform';
import { isDepot } from '@/lib/balances';
import { useFints } from './FintsProvider';
import { AccountHero, AccountList, MonthSummary } from './AccountPanel';
import { PendingPanel, Transactions } from './Transactions';
import { Portfolio } from './Portfolio';
import { Analysis } from './Analysis';
import { Contracts, UpcomingPayments } from './Contracts';
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
import { MessagesTeaser } from './shell/MessagesTeaser';
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
        <main id="main" className="relative mx-auto w-full max-w-[1280px] px-4 pt-2 pb-6 sm:px-6 sm:pb-12">
          {tab === 'overview' && <Overview scrollRef={scrollRef} />}
          {tab === 'analysis' && <Analysis />}
          {tab === 'contracts' && <Contracts />}
          {tab === 'settings' && <Settings />}
        </main>
      </div>

      <BottomBar actions={actions} />
      {IS_ANDROID && <PullToRefresh scrollRef={scrollRef} />}

      {transferOpen && <TransferSheet />}
      {shareOpen && <ShareAccount />}
      <AddBankSheet />
      <Inbox />
      <CommandPalette />
      <SessionGuard />
      <ShortcutsHelp />
    </div>
  );
}

/**
 * The Übersicht grid.
 *
 * The markup is the reading order — Konten und Karten, Kontostand, the small
 * summaries (Vorgemerkt, Monatsbilanz, Demnächst fällig, Mitteilungen), then
 * Umsätze — so the eye, Tab and a screen reader go the same way at every
 * width. Below the desk breakpoint that is simply one column: the bookings
 * are a long list, and anything after them would never be seen on a phone.
 *
 * From desk it is two columns (2:1). The summaries' wrapper is placed in the
 * second column across every row and stays pinned beside the bookings; the
 * other three fill the first column in order. Placement, not CSS `order`, and
 * nothing remounts (and loses its state) when the window crosses the
 * breakpoint. The rows are `auto auto 1fr`, so a side column taller than the
 * list and the hero (Umsätze still loading, or none) grows the last row,
 * never the first two. With a single account the list renders nothing, and
 * the grid drops to two rows rather than keep a gap where it would be.
 */
function Overview({ scrollRef }: { scrollRef: RefObject<HTMLDivElement | null> }) {
  const { activeAccount, pendingCache } = useFints();
  const depot = !!activeAccount && isDepot(activeAccount);
  const sideRef = useRef<HTMLDivElement>(null);
  const stickyTop = useStickyTop(sideRef, scrollRef);

  return (
    <div
      className={cx(
        'flex flex-col gap-4 sm:gap-6',
        'desk:grid desk:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)] desk:grid-rows-[auto_auto_1fr] desk:items-start',
        'desk:has-[>[data-slot=accounts]:empty]:grid-rows-[auto_1fr]',
      )}
    >
      <Slot name="accounts" className="desk:col-start-1"><AccountList /></Slot>
      <Slot name="hero" className="desk:col-start-1"><AccountHero /></Slot>
      <div
        ref={sideRef}
        // The side pane: pinned beside the bookings while they scroll (sticky
        // only applies on the two-pane layout; the `top` is inert without it).
        data-side
        style={{ top: stickyTop }}
        className="flex min-w-0 flex-col gap-4 sm:gap-6 desk:sticky desk:col-start-2 desk:row-[1/-1]"
      >
        <Slot><MerchantLogoConsent /></Slot>
        <Slot><UsageConsentTile /></Slot>
        {/* On request (HKVMK), or once the bank sent a list with the Umsätze. */}
        {activeAccount && (activeAccount.canPending || pendingCache[activeAccount.accountNumber]) && (
          <Slot><PendingPanel /></Slot>
        )}
        {/* A phone's Übersicht — and a window too narrow for the side pane —
            is the balance and the bookings: the month's figures are the
            Analyse's, what is due the Verträge's, the bank's messages the
            bell's. The side pane of a wide window has room for them — except
            the two made of Umsätze while a Depot is chosen: it has none, so
            they could only say so. */}
        {!IS_ANDROID && (
          <>
            {!depot && <Slot className="max-desk:hidden"><MonthSummary /></Slot>}
            {!depot && <Slot className="max-desk:hidden"><UpcomingPayments /></Slot>}
            <Slot className="max-desk:hidden"><MessagesTeaser /></Slot>
          </>
        )}
      </div>
      {/* A Depot has no Umsätze over FinTS: its holdings take their place. */}
      <Slot name="transactions" className="desk:col-start-1">
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
 * The `top` for a sticky column: 16px when it fits in the scroller's visible
 * height, otherwise negative by the overflow — so a column taller than the
 * window scrolls with the page until its END is in view and only then stays.
 * Pinning a tall column at its top would hide its last tiles until the page
 * ran out. Re-measured whenever the column or the scroller changes size.
 */
function useStickyTop(
  el: RefObject<HTMLElement | null>,
  scroller: RefObject<HTMLElement | null>,
): number {
  const [top, setTop] = useState(GAP);
  useEffect(() => {
    const target = el.current;
    const root = scroller.current;
    if (!target || !root || typeof ResizeObserver === 'undefined') return;
    const measure = () => setTop(Math.min(GAP, root.clientHeight - target.offsetHeight - GAP));
    const ro = new ResizeObserver(measure);
    ro.observe(target);
    ro.observe(root);
    measure();
    return () => ro.disconnect();
  }, [el, scroller]);
  return top;
}

const GAP = 16;

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
