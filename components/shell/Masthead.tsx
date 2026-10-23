'use client';

// The top app bar: where you are, and whose session.
//
// Material's small top app bar on every platform: the page's name on the
// left (title large), the actions on the right — icons, each named by its
// tooltip and label, with the search as a pill on a wide window (Strg K).
// The app's own mark sits at the head of the navigation rail (BottomBar).
//
// On a phone the Übersicht has no title in it: its head is Material's search
// bar — "Umsätze suchen oder fragen", the Gemini spark where Nano can
// answer, the holder's avatar at its end — and a press opens the search
// (components/CommandPalette.tsx). The other pages keep their name, with the
// search as an icon beside "Beträge ausblenden". The bell is the wide
// window's; on a phone the Mitteilungen are a row of the Sitzung panel, and
// the avatar carries their dot.
//
// In the desktop shell it is also the window's title bar: the whole band is a
// drag handle except for its controls, it is exactly as tall as the OS
// caption overlay (--barbar-h follows titlebar-area-height, zoom included),
// and its right padding keeps the actions clear of the caption buttons that
// float over its right edge (the .bar-caption-safe rule, see ./edges). On a
// wide window its content lines up with the page's 1280px column, so the
// page title and the first section share one left edge.

import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useT } from '@/lib/i18n/react';
import { IS_ANDROID } from '@/lib/platform';
import { askAllowed } from '@/lib/plus';
import { useFints } from '../FintsProvider';
import { ThemeMenu } from '../ThemeToggle';
import { useAskable } from '../insights/Ask';
import { unseenUpdate, useUpdates } from '../updates/store';
import { BackIcon, BellIcon, EyeIcon, EyeOffIcon, GeminiSparkIcon, SearchIcon } from '../icons';
import { Dot, IconButton, cx } from '../ui';
import { MASTHEAD_EDGES } from './edges';
import { PAGE_TITLE_ID } from './ids';
import { ProfileMenu } from './ProfileMenu';
import { usePhone } from './usePhone';

const DRAG = { WebkitAppRegion: 'drag' } as CSSProperties;
const NO_DRAG = { WebkitAppRegion: 'no-drag' } as CSSProperties;


/** The page's name, as Material's top app bar says where you are. */
function PageTitle({ hidden = false }: { hidden?: boolean }) {
  const { tab } = useFints();
  const t = useT();
  return (
    <h1 id={PAGE_TITLE_ID} tabIndex={-1} data-topbar-title className={cx('min-w-0 truncate outline-none', hidden && 'sr-only')}>
      {t.common.nav[tab]}
    </h1>
  );
}

/**
 * The phone's Übersicht opens on this: Material's search bar, 56dp and fully
 * round on the container-high tone, the one tinted shape at the top. The
 * whole bar is the way into the search except the avatar at its end, which
 * is the Sitzung panel's.
 */
function SearchBar() {
  const { setPaletteOpen, plus } = useFints();
  const t = useT();
  const askable = useAskable();
  const canAsk = IS_ANDROID && askable === true && askAllowed(plus.state);
  const placeholder = canAsk ? t.shell.searchBar.ask : t.shell.searchBar.plain;
  return (
    <div data-search-bar className="flex h-14 min-w-0 flex-1 items-center rounded-full bg-[var(--md-surface-container-high)] pr-1 [--dot-ring:var(--md-surface-container-high)]">
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setPaletteOpen(true)}
        className="flex h-full min-w-0 flex-1 items-center gap-3 rounded-l-full pl-4 text-left text-[16px] text-bar-ink-2 outline-offset-[-2px]"
      >
        <SearchIcon size={22} className="shrink-0 text-bar-ink" />
        <span className="min-w-0 flex-1 truncate">{placeholder}</span>
        {canAsk && <GeminiSparkIcon size={20} aria-hidden className="mr-1 shrink-0" />}
      </button>
      <ProfileMenu />
    </div>
  );
}

export function Masthead() {
  const {
    privacy, togglePrivacy, unreadCount: bankUnread, inboxOpen, setInboxOpen, setPaletteOpen, singleKeyShortcuts,
    tab, leaveSettings,
  } = useFints();
  const t = useT();
  const phone = usePhone();
  // On a phone Einstellungen is a page under another, as Android's settings
  // screens are: the way back in front of its name, and none of the places'
  // actions behind it. From 640px it is the rail's fifth place.
  const subPage = tab === 'settings';
  // The phone's Übersicht: the search bar in place of the title and actions.
  const searchHead = phone && tab === 'overview';
  // A newer version of the app (desktop only) waits in Mitteilungen too. The
  // number counts the bank's messages only; the app's own news is marked by
  // the dot alone, so it never reads as one more message from the bank.
  const updateSnapshot = useUpdates();
  const updateUnseen = unseenUpdate(updateSnapshot);
  const inboxName = [
    t.common.nav.messages,
    bankUnread > 0 ? t.shell.unread(bankUnread) : '',
    updateUnseen ? t.shell.masthead.newAppVersion : '',
  ].filter(Boolean).join(', ');
  // What a press on the privacy item does — the label changes with the state.
  const amounts = privacy ? t.common.showAmounts : t.common.hideAmounts;
  // Opening the drawer marks everything read. Were the count badge to go out
  // at that moment, the items left of it would jump sideways behind the
  // scrim; so the bell keeps showing what it showed when it was pressed, and
  // settles once the drawer has closed.
  const [shown, setShown] = useState({ unread: bankUnread, update: updateUnseen });
  if (!inboxOpen && (shown.unread !== bankUnread || shown.update !== updateUnseen)) {
    setShown({ unread: bankUnread, update: updateUnseen });
  }
  const shownUnread = shown.unread;

  return (
    <div
      data-topbar
      className={cx('on-bar relative z-40 shrink-0 bg-bar text-bar-ink', MASTHEAD_EDGES)}
      style={{ height: 'var(--barbar-h)', ...DRAG }}
    >
      {/* The page's first stop for a keyboard. It lives in here, not before
          the masthead: the desktop shell applies app-region rectangles in
          page order, later ones winning, so a no-drag link placed before
          this drag band would still drag the window when clicked. As its
          first child it comes after the band and wins. */}
      <a
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById(PAGE_TITLE_ID)?.focus();
        }}
        // not-sr-only also zeroes the padding; the pill gets it back.
        className="sr-only z-200 rounded-full bg-accent font-semibold text-accent-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:px-4! focus:py-2!"
        style={NO_DRAG}
      >
        {t.shell.masthead.skip}
      </a>

      {searchHead ? (
        <div className="flex h-full min-w-0 items-center" style={NO_DRAG}>
          <PageTitle hidden />
          <SearchBar />
        </div>
      ) : (
      <div className="@container/mast flex h-full min-w-0 items-center gap-2 sm:gap-3">
        {subPage && (
          <IconButton
            tone="bar"
            size="md"
            aria-label={t.common.back}
            onClick={leaveSettings}
            // Material's navigation icon: its glyph, not its state layer, on the bar's edge.
            className="-ml-2 sm:hidden"
            style={NO_DRAG}
          >
            <BackIcon size={22} />
          </IconButton>
        )}
        <PageTitle />

        <div className="min-w-2 flex-1" />

        <div className={cx('flex shrink-0 items-center gap-1', subPage && 'max-sm:hidden')} style={NO_DRAG}>
          {/* Search: a pill, as Material's search bar sits in a wide top app
              bar — on a phone it is "Mehr" in the navigation bar. Android has
              no Darstellung either: the phone's light and dark. */}
          {!IS_ANDROID && <button
            type="button"
            className={cx(
              'mr-1 inline-flex h-10 items-center gap-2.5 rounded-full bg-[var(--md-surface-container-high)] pr-2.5 pl-3.5 text-[14px] text-bar-ink-2',
              'transition-colors duration-150 hover:bg-[var(--md-surface-container-highest)] hover:text-bar-ink max-sm:hidden',
              '@max-[719.98px]/mast:size-10 @max-[719.98px]/mast:justify-center @max-[719.98px]/mast:px-0',
            )}
            aria-label={t.common.search}
            aria-keyshortcuts="Control+K Meta+K"
            title={`${t.common.search} (${t.shell.ctrl}+K)`}
            onClick={() => setPaletteOpen(true)}
          >
            <SearchIcon size={18} />
            <span className="w-[clamp(6rem,14vw,12rem)] text-left @max-[719.98px]/mast:hidden">{t.common.search}</span>
            <kbd
              aria-hidden
              className="inline-flex h-[22px] items-center rounded-[5px] bg-[var(--md-surface-container-lowest)] px-1.5 font-sans text-[12.5px] leading-none font-medium text-bar-ink-2 @max-[899.98px]/mast:hidden"
            >
              {`${t.shell.ctrl} K`}
            </kbd>
          </button>}

          {/* A phone's search, on the pages whose head is their name. */}
          {phone && (
            <IconButton tone="bar" size="md" aria-label={t.common.search} aria-haspopup="dialog" onClick={() => setPaletteOpen(true)}>
              <SearchIcon size={22} />
            </IconButton>
          )}

          {/* The actions: M3E's standard icon buttons, 40px round. On a phone
              the Mitteilungen are the Sitzung panel's (ProfileMenu). */}
          {!phone && <IconButton
            tone="bar"
            size="md"
            aria-label={inboxName}
            aria-haspopup="dialog"
            data-inbox-trigger
            onClick={() => setInboxOpen(true)}
          >
            <span className="relative inline-flex">
              <BellIcon />
              {/* The dot is the narrow-window form of the count (where the
                  badge shows, it would say the same thing twice) — and, at
                  every width, the mark of a new app version. */}
              {(shownUnread > 0 || shown.update) && <Dot className="absolute -top-0.5 -right-0.5 ring-2 ring-bar" />}
            </span>
          </IconButton>}

          {/* The label names what a press does, so it changes with the state
              (and is not also a pressed toggle — that would announce
              "Beträge anzeigen, gedrückt"). While amounts are hidden the item
              keeps a tint, so the mode is visible from across the room. */}
          <IconButton
            tone="bar"
            size="md"
            aria-label={amounts}
            aria-keyshortcuts={singleKeyShortcuts ? 'B' : undefined}
            title={amounts + (singleKeyShortcuts ? ' (B)' : '')}
            onClick={togglePrivacy}
            className={cx('rounded-full', privacy && 'bg-[color-mix(in_srgb,var(--bar-ink)_14%,transparent)]')}
          >
            {privacy ? <EyeOffIcon /> : <EyeIcon />}
          </IconButton>

          {!IS_ANDROID && <ThemeMenu variant="icon" className="max-sm:hidden" />}

          {/* Abmelden lives in the Sitzung panel behind this chip, with the
              session it ends — the bar stays a row of places to go. */}
          <ProfileMenu />
        </div>
      </div>
      )}
    </div>
  );
}
