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
import { hasOverview } from '@/lib/account-overview';
import { isDepot } from '@/lib/balances';
import { useFints } from './FintsProvider';
import { AccountHero } from './AccountPanel';
import { AccountsOverview } from './overview/AccountsOverview';
import { MonthFigures } from './overview/MonthFigures';
import { Transactions } from './Transactions';
import { Portfolio } from './Portfolio';
import { Analysis } from './Analysis';
import { Contracts } from './Contracts';
import { OrdersPage } from './BankOrders';
import { Settings } from './settings/Settings';
import { TransferSheet } from './TransferSheet';
import { AddBankSheet } from './AddBank';
import { ShareAccount } from './ShareAccount';
import { LinkedUnlockDialog } from './settings/LinkedUnlock';
import { BackgroundDialog } from './settings/BackgroundChecks';
import { ForgetDeviceDialog, LogoutConfirmDialog } from './shell/ProfileMenu';
import { SplitRequests } from './transactions/SplitRequests';
import { Inbox } from './Inbox';
import { CommandPalette } from './CommandPalette';
import { SessionGuard } from './SessionGuard';
import { ShortcutsHelp } from './ShortcutsHelp';
import { cx } from './ui';
import { useShellActions } from './shell/actions';
import { PAGE_TITLE_ID } from './shell/ids';
import { useSplitOverview } from './shell/useWide';
import { useT } from '@/lib/i18n/react';
import { useGlobalShortcuts } from './shell/useShortcuts';
import { Masthead } from './shell/Masthead';
import { BottomBar } from './shell/BottomBar';
import { MerchantLogoConsent } from './MerchantLogoConsent';
import { UsageConsentTile } from './telemetry/UsageConsent';
import { trackUsage } from './telemetry/usage';
import { PullToRefresh } from './android/PullToRefresh';
import { useLaunches } from './android/useLaunches';

export function Dashboard() {
  const {
    tab, transferOpen, shareOpen, shareAll, accounts, banks, accountOpen, ordersOpen, forgetDeviceOpen, setForgetDeviceOpen,
  } = useFints();
  const actions = useShellActions();
  useGlobalShortcuts(actions);
  // Android: a shortcut on the icon, or an invoice shared with the app.
  useLaunches(actions);
  const scrollRef = useRef<HTMLDivElement>(null);
  // The Übersicht starts on every account once there is more than one
  // (issue #19); an account's page is a level below it — or, from 1280px,
  // beside it (SplitOverview).
  const split = useSplitOverview();
  const allAccounts = tab === 'overview' && !split && !accountOpen && hasOverview(accounts, banks);
  // Zahlungen has a level below too: the bank's orders (6.0).
  const orders = tab === 'contracts' && ordersOpen;
  const place = split ? 'split' : allAccounts ? 'accounts' : orders ? 'orders' : tab;

  // A tab is a new page, and so is each level of the Übersicht: it starts at
  // its top. Focus the control that led here had is gone with the old page:
  // it goes to the page's name, never to <body> (the overview puts it back on
  // the account's row itself).
  const firstTab = useRef(true);
  useEffect(() => {
    if (firstTab.current) {
      firstTab.current = false;
      return;
    }
    scrollRef.current?.scrollTo({ top: 0 });
    if (!document.activeElement || document.activeElement === document.body) {
      document.getElementById(PAGE_TITLE_ID)?.focus({ preventScroll: true });
    }
  }, [place]);

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
            // The Übersicht is one column under the search bar, as wide as it (Masthead, SEARCH_EDGES) —
            // the wider column of the two panes side by side (SPLIT_SEARCH_EDGES).
            tab === 'overview' ? (split ? 'max-w-[1360px] sm:px-6' : 'max-w-[960px]') : 'max-w-[1280px] sm:px-6',
            // No navigation bar under Einstellungen on a phone: the page's end clears the gesture bar itself.
            tab === 'settings' && 'max-sm:pb-[calc(env(safe-area-inset-bottom,0px)+32px)]',
          )}
        >
          {/* Keyed by the place, so each opens with Material's fade-through (app/android.css). */}
          <div key={place} data-place>
            {tab === 'overview' && (split ? <SplitOverview /> : allAccounts ? <AccountsOverview /> : <Overview />)}
            {tab === 'analysis' && <Analysis />}
            {tab === 'contracts' && (orders ? <OrdersPage /> : <Contracts />)}
            {tab === 'settings' && <Settings />}
          </div>
        </main>
      </div>

      <BottomBar actions={actions} />
      {IS_ANDROID && <PullToRefresh scrollRef={scrollRef} />}

      {transferOpen && <TransferSheet />}
      {shareOpen && <ShareAccount />}
      {shareAll && <SplitRequests />}
      {IS_ANDROID && <PlusScreen />}
      <AddBankSheet />
      {/* The dialogs the provider opens from anywhere (a toast's action, the
          palette, Einstellungen), mounted where every width and page keeps
          them: the masthead's actions are hidden or dropped on a phone-width
          page, and an open layer there would make the page inert unseen. */}
      <ForgetDeviceDialog open={forgetDeviceOpen} onClose={() => setForgetDeviceOpen(false)} />
      <LogoutConfirmDialog />
      <LinkedUnlockDialog />
      <BackgroundDialog />
      <Inbox />
      <CommandPalette />
      <SessionGuard />
      <ShortcutsHelp />
    </div>
  );
}

/**
 * An account's page, the Übersicht itself with a single account: one column,
 * search first — the phone's (owner, 2026-10-23), every width's since the
 * desktop followed it ("Suche oben", 2026-10-24). The search bar is the top
 * bar (Masthead; on a phone, under every account, the account's own top bar
 * with the way back). Under it the balance, set flat; on a wide window a
 * quiet line of the month's figures; then the chips and the bookings, which
 * start on the first screen. With more than one account, every account is a
 * level above (components/overview/AccountsOverview.tsx).
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

/**
 * The Übersicht side by side (6.0, the owner's pick from the mock
 * .impeccable/mocks/issue-19/desktop-nebeneinander.png): from 1280px with
 * more than one account, every account in a pane on the left — sticky, with
 * its own scroll, the open one marked — and that account's page beside it.
 * A press on a row changes the page beside; there is nothing to go back to.
 */
function SplitOverview() {
  const t = useT();
  return (
    <div className="grid grid-cols-[420px_minmax(0,1fr)] gap-x-10">
      <aside
        aria-label={t.insights.accounts.title}
        // Bled out by the rows' 16px so the scroll box does not clip them, and back in by as much.
        className="sticky top-0 -ml-4 max-h-[calc(100dvh_-_var(--barbar-h))] min-w-0 self-start overflow-y-auto overscroll-contain border-r border-line pr-6 pb-6 pl-4 [scrollbar-width:thin]"
      >
        <AccountsOverview pane />
      </aside>
      <div className="min-w-0">
        <Overview />
      </div>
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
    // stands in for it (lockPageScroll in ui/layers.ts), so the header holds still
    // when a dialog opens. A scrollbar coming or going changes the scroller's
    // content box, which is what the (default content-box) observer reports;
    // the lock swapping one for the other leaves it, and the value, as is.
    const measure = () => {
      const pad = parseFloat(getComputedStyle(el).paddingRight) || 0;
      target.style.setProperty('--sbw', `${Math.max(0, el.offsetWidth - el.clientWidth + pad)}px`);
    };
    // In the next frame, as in useScrollEdges (ui/overlay.tsx): written inside the
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
