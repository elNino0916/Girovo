'use client';

// Tier 1 — the masthead: whose app this is, and whose session.
//
// In the desktop shell it is also the window's title bar: the whole band is a
// drag handle except for its controls, it is exactly as tall as the OS
// caption overlay (--barbar-h follows titlebar-area-height, zoom included),
// and its right padding keeps the cluster clear of the caption buttons that
// float over its right edge (the .bar-caption-safe rule, see ./edges).
//
// On a wide window its content lines up with the page's 1280px column, so the
// "€" mark, the bank's logo below it and the page title share one left edge.
//
// The cluster labels every icon the way a German bank's start page does, and
// gives the words up in a fixed order as room runs out: first the
// secondary labels, then the rest, and on a phone the items that live
// elsewhere there (Suche is "Mehr" in the bottom bar, Darstellung moves into
// the Sitzung panel). The room is measured on the masthead itself (a
// container query), not on the window, because in the desktop shell the
// caption buttons take ~140px of the same row.

import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useFints } from '../FintsProvider';
import { ThemeMenu } from '../ThemeToggle';
import { unseenUpdate, useUpdates } from '../updates/store';
import { BellIcon, EyeIcon, EyeOffIcon, SearchIcon } from '../icons';
import { CountBadge, Dot, cx } from '../ui';
import { BrandMark } from './BrandMark';
import { MASTHEAD_EDGES } from './edges';
import { ProfileMenu } from './ProfileMenu';
import { PAGE_TITLE_ID } from './Stage';

const DRAG = { WebkitAppRegion: 'drag' } as CSSProperties;
const NO_DRAG = { WebkitAppRegion: 'no-drag' } as CSSProperties;

// Label tiers, as container widths of the masthead's content box.
// FULL: every word, incl. the shortcut hint and Darstellung. MID: the words
// that name a destination (Suche, Mitteilungen, the first name) and
// "Beträge ausblenden" — the control a screen share most depends on, so it
// keeps its words in the desktop app's default 1280px window, where the
// caption buttons leave the masthead about 1,090px. Below MID everything is
// an icon with its name as tooltip.
const LABEL_FULL = 'hidden @min-[1180px]/mast:inline';
const LABEL_MID = 'hidden @min-[900px]/mast:inline';

/**
 * An icon-only item is a circle, not a pill with a label's padding: 40px, and
 * 36px on a phone, where the wordmark needs every pixel of the row.
 */
const ITEM = 'navlink inline-flex sm:@max-[899.98px]/mast:px-[11px]! max-sm:px-[9px]!';

export function Masthead() {
  const {
    privacy, togglePrivacy, unreadCount: bankUnread, inboxOpen, setInboxOpen, setPaletteOpen, singleKeyShortcuts,
  } = useFints();
  // A newer version of the app (desktop only) waits in Mitteilungen too. The
  // number counts the bank's messages only; the app's own news is marked by
  // the dot alone, so it never reads as one more message from the bank.
  const updateSnapshot = useUpdates();
  const updateUnseen = unseenUpdate(updateSnapshot);
  const inboxName = ['Mitteilungen', bankUnread > 0 ? `${bankUnread} ungelesen` : '', updateUnseen ? 'neue App-Version' : '']
    .filter(Boolean).join(', ');
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
        Zum Inhalt springen
      </a>

      <div className="@container/mast flex h-full min-w-0 items-center gap-2 sm:gap-3">
        {/* No version here: the footer and the Sitzung panel carry it, and
            the bar's room goes to the labelled controls. */}
        <BrandMark />

        <div className="min-w-2 flex-1" />

        <div className="flex shrink-0 items-center sm:gap-0.5" style={NO_DRAG}>
          <button
            type="button"
            className={cx(ITEM, 'max-sm:hidden')}
            aria-label="Suche"
            aria-keyshortcuts="Control+K Meta+K"
            title="Suche (Strg+K)"
            onClick={() => setPaletteOpen(true)}
          >
            <SearchIcon size={18} />
            <span className={LABEL_MID}>Suche</span>
            <kbd
              aria-hidden
              className="hidden h-[22px] items-center rounded-[5px] border border-bar-line px-1.5 font-sans text-[12.5px] leading-none font-semibold text-bar-ink-2 @min-[1180px]/mast:inline-flex"
            >
              Strg K
            </kbd>
          </button>

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
              {(shownUnread > 0 || shown.update) && (
                <Dot className={cx('absolute -top-0.5 -right-0.5 ring-2 ring-bar', !shown.update && '@min-[900px]/mast:hidden')} />
              )}
            </span>
            <span className={LABEL_MID}>Mitteilungen</span>
            {shownUnread > 0 && (
              <span className={LABEL_MID}>
                <CountBadge count={shownUnread} tone="bar" />
              </span>
            )}
          </button>

          {/* The label names what a press does, so it changes with the state
              (and is not also a pressed toggle — that would announce
              "Beträge anzeigen, gedrückt"). While amounts are hidden the item
              keeps a tint, so the mode is visible from across the room. */}
          <button
            type="button"
            className={cx(ITEM, privacy && 'bg-[color-mix(in_srgb,var(--bar-ink)_14%,transparent)]')}
            aria-label={privacy ? 'Beträge anzeigen' : 'Beträge ausblenden'}
            aria-keyshortcuts={singleKeyShortcuts ? 'B' : undefined}
            title={(privacy ? 'Beträge anzeigen' : 'Beträge ausblenden') + (singleKeyShortcuts ? ' (B)' : '')}
            onClick={togglePrivacy}
          >
            {privacy ? <EyeOffIcon /> : <EyeIcon />}
            <span className={LABEL_MID}>{privacy ? 'Beträge anzeigen' : 'Beträge ausblenden'}</span>
          </button>

          <ThemeMenu className={cx(ITEM, 'max-sm:hidden')} labelClassName={LABEL_FULL} />

          <span aria-hidden className="mx-1.5 h-6 w-px bg-bar-line max-sm:hidden" />

          {/* Abmelden lives in the Sitzung panel behind this chip, with the
              session it ends — the bar stays a row of places to go. */}
          <ProfileMenu />
        </div>
      </div>
    </div>
  );
}
