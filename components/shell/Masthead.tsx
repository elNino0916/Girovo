'use client';

// The top app bar: where you are, and whose session.
//
// Material's small top app bar on every platform: the page's name on the
// left (title large), the actions on the right — icons, each named by its
// tooltip and label, with the search as a pill on a wide window (Strg K).
// The app's own mark sits at the head of the navigation rail (BottomBar).
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
import { useFints } from '../FintsProvider';
import { ThemeMenu } from '../ThemeToggle';
import { unseenUpdate, useUpdates } from '../updates/store';
import { BellIcon, EyeIcon, EyeOffIcon, SearchIcon } from '../icons';
import { Dot, cx } from '../ui';
import { MASTHEAD_EDGES } from './edges';
import { PAGE_TITLE_ID } from './ids';
import { ProfileMenu } from './ProfileMenu';

const DRAG = { WebkitAppRegion: 'drag' } as CSSProperties;
const NO_DRAG = { WebkitAppRegion: 'no-drag' } as CSSProperties;

/** An action: Material's standard icon button, 40px round (48px on a phone, app/android.css). */
const ITEM = 'navlink inline-flex size-10 justify-center px-0!';

/** The page's name, as Material's top app bar says where you are. */
function PageTitle() {
  const { tab } = useFints();
  const t = useT();
  return (
    <h1 id={PAGE_TITLE_ID} tabIndex={-1} data-topbar-title className="min-w-0 truncate outline-none">
      {t.common.nav[tab]}
    </h1>
  );
}

export function Masthead() {
  const {
    privacy, togglePrivacy, unreadCount: bankUnread, inboxOpen, setInboxOpen, setPaletteOpen, singleKeyShortcuts,
  } = useFints();
  const t = useT();
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

      <div className="@container/mast flex h-full min-w-0 items-center gap-2 sm:gap-3">
        <PageTitle />

        <div className="min-w-2 flex-1" />

        <div className="flex shrink-0 items-center gap-1" style={NO_DRAG}>
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

          <button
            type="button"
            className={cx(ITEM, 'group')}
            aria-label={inboxName}
            aria-haspopup="dialog"
            title={inboxName}
            data-inbox-trigger
            onClick={() => setInboxOpen(true)}
          >
            <span className="relative text-bar-ink-2 transition-colors duration-150 group-hover:text-bar-ink">
              <BellIcon />
              {/* The dot is the narrow-window form of the count (where the
                  badge shows, it would say the same thing twice) — and, at
                  every width, the mark of a new app version. */}
              {(shownUnread > 0 || shown.update) && <Dot className="absolute -top-0.5 -right-0.5 ring-2 ring-bar" />}
            </span>
          </button>

          {/* The label names what a press does, so it changes with the state
              (and is not also a pressed toggle — that would announce
              "Beträge anzeigen, gedrückt"). While amounts are hidden the item
              keeps a tint, so the mode is visible from across the room. */}
          <button
            type="button"
            className={cx(ITEM, privacy && 'bg-[color-mix(in_srgb,var(--bar-ink)_14%,transparent)]')}
            aria-label={amounts}
            aria-keyshortcuts={singleKeyShortcuts ? 'B' : undefined}
            title={amounts + (singleKeyShortcuts ? ' (B)' : '')}
            onClick={togglePrivacy}
          >
            {privacy ? <EyeOffIcon /> : <EyeIcon />}
          </button>

          {!IS_ANDROID && <ThemeMenu className={cx(ITEM, 'max-sm:hidden')} labelClassName="sr-only" />}

          {/* Abmelden lives in the Sitzung panel behind this chip, with the
              session it ends — the bar stays a row of places to go. */}
          <ProfileMenu />
        </div>
      </div>
    </div>
  );
}
