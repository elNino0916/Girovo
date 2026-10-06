'use client';

// The shell: masthead, institute bar, and the page beneath them.
//
// The two header tiers never scroll. Everything under them scrolls in its
// own container ([data-scroll-root]) — that is the box whose scrollbar the OS
// draws, kept clear of the desktop shell's caption buttons, and the box the
// overlays lock while they are open. Sticky things inside the page (day
// headers in Umsätze, the right column) stick to its top edge.
//
// The page opens the way a bank's start page does: a navy stage that says
// where you are and who you are, then the tiles, the first row lapping over
// the stage's lower edge. On the Übersicht the tiles sit in a 2:1 grid —
// accounts, balance and bookings on the wide side, the smaller summaries
// beside them — and fold into one column in reading order on a narrow screen.

import { useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { useT } from '@/lib/i18n/react';
import { useFints } from './FintsProvider';
import { AccountHero, AccountList, MonthSummary } from './AccountPanel';
import { PendingPanel, Transactions } from './Transactions';
import { Analysis } from './Analysis';
import { Contracts, UpcomingPayments } from './Contracts';
import { TransferSheet } from './TransferSheet';
import { ShareAccount } from './ShareAccount';
import { Inbox } from './Inbox';
import { CommandPalette } from './CommandPalette';
import { SessionGuard } from './SessionGuard';
import { ShortcutsHelp } from './ShortcutsHelp';
import { ChevronIcon } from './icons';
import { Button, TabPanel, cx } from './ui';
import { useShellActions } from './shell/actions';
import { useGlobalShortcuts } from './shell/useShortcuts';
import { Masthead } from './shell/Masthead';
import { DASH_TABS_ID, InstituteBar } from './shell/InstituteBar';
import { Stage } from './shell/Stage';
import { Footer } from './shell/Footer';
import { BottomBar } from './shell/BottomBar';
import { MessagesTeaser } from './shell/MessagesTeaser';
import { MerchantLogoConsent } from './MerchantLogoConsent';
import { UsageConsentTile } from './telemetry/UsageConsent';
import { trackUsage } from './telemetry/usage';

export function Dashboard() {
  const { tab, transferOpen, shareOpen } = useFints();
  const actions = useShellActions();
  useGlobalShortcuts(actions);
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
    <div ref={rootRef} className="flex h-dvh flex-col bg-paper">
      {/* "Zum Inhalt springen" is the masthead's first child — see Masthead. */}
      <header className="shrink-0">
        <Masthead />
        <InstituteBar />
      </header>

      <div ref={scrollRef} data-scroll-root className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="flex min-h-full flex-col">
          <Stage actions={actions} />

          <main id="main" className="relative mx-auto -mt-12 w-full max-w-[1280px] px-4 pb-10 sm:px-6 sm:pb-14">
            <TabPanel idBase={DASH_TABS_ID} id="overview" active={tab === 'overview'}>
              <Overview scrollRef={scrollRef} />
            </TabPanel>
            <TabPanel idBase={DASH_TABS_ID} id="analysis" active={tab === 'analysis'}>
              <Analysis />
            </TabPanel>
            <TabPanel idBase={DASH_TABS_ID} id="contracts" active={tab === 'contracts'}>
              <Contracts />
            </TabPanel>
          </main>

          <Footer />
        </div>
      </div>

      <BottomBar actions={actions} />

      {transferOpen && <TransferSheet />}
      {shareOpen && <ShareAccount />}
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
      {activeAccount && <ToTransactions />}
      <div
        ref={sideRef}
        // Pinned beside the bookings while they scroll (sticky only applies
        // on the two-column layout; the `top` is inert without it).
        style={{ top: stickyTop }}
        className="flex min-w-0 flex-col gap-4 sm:gap-6 desk:sticky desk:col-start-2 desk:row-[1/-1]"
      >
        <Slot><MerchantLogoConsent /></Slot>
        <Slot><UsageConsentTile /></Slot>
        {/* On request (HKVMK), or once the bank sent a list with the Umsätze. */}
        {activeAccount && (activeAccount.canPending || pendingCache[activeAccount.accountNumber]) && (
          <Slot><PendingPanel /></Slot>
        )}
        <Slot><MonthSummary /></Slot>
        <Slot><UpcomingPayments /></Slot>
        <Slot><MessagesTeaser /></Slot>
      </div>
      <Slot name="transactions" className="desk:col-start-1"><Transactions /></Slot>
    </div>
  );
}

/** A grid cell. Empty tiles (a component that renders nothing) leave no gap behind. */
function Slot({ name, className, children }: { name?: string; className?: string; children: ReactNode }) {
  return <div data-slot={name} className={cx('min-w-0 empty:hidden', className)}>{children}</div>;
}

/**
 * Below the desk breakpoint the summaries stand between the balance and the
 * bookings. This goes past them in one press — the same jump as the palette's
 * "Umsätze durchsuchen" and "/", landing on the Umsätze heading, so the next
 * Tab is in the filters. On desk the bookings sit right under the balance.
 */
function ToTransactions() {
  const { showTransactions } = useFints();
  const t = useT();
  return (
    <div className="-my-1 sm:-my-2 desk:hidden">
      <Button
        variant="tertiary"
        size="sm"
        className="-ml-3"
        iconRight={<ChevronIcon dir="down" size={15} />}
        onClick={() => showTransactions()}
      >
        {t.shell.dashboard.toTransactions}
      </Button>
    </div>
  );
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
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [root, scroller]);
}
