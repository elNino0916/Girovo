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
import { BellIcon, EyeIcon, EyeOffIcon, LogoutIcon, SearchIcon } from '../icons';
import { Button, CountBadge, Dot, IconButton, cx } from '../ui';
import { BrandMark } from './BrandMark';
import { MASTHEAD_EDGES } from './edges';
import { ProfileMenu } from './ProfileMenu';
import { PAGE_TITLE_ID } from './Stage';

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '';
const DRAG = { WebkitAppRegion: 'drag' } as CSSProperties;
const NO_DRAG = { WebkitAppRegion: 'no-drag' } as CSSProperties;

// Label tiers, as container widths of the masthead's content box.
// FULL: every word, incl. the shortcut hint. MID: the words that name a
// destination (Suche, Mitteilungen, the first name); the two toggles keep
// their glyph and tooltip. Below MID everything but Abmelden is an icon.
const LABEL_FULL = 'hidden @min-[1180px]/mast:inline';
const LABEL_MID = 'hidden @min-[900px]/mast:inline';

/**
 * An icon-only item is a circle, not a pill with a label's padding: 40px, and
 * 36px on a phone, where the wordmark needs every pixel of the row.
 */
const ITEM = 'navlink inline-flex sm:@max-[899.98px]/mast:px-[11px]! max-sm:px-[9px]!';

export function Masthead() {
  const {
    privacy, togglePrivacy, unreadCount, inboxOpen, setInboxOpen, setPaletteOpen, logout, singleKeyShortcuts,
  } = useFints();
  const inboxName = unreadCount > 0 ? `Mitteilungen, ${unreadCount} ungelesen` : 'Mitteilungen';
  // Opening the drawer marks everything read. Were the count badge to go out
  // at that moment, the items left of it would jump sideways behind the
  // scrim; so the bell keeps showing what it showed when it was pressed, and
  // settles once the drawer has closed.
  const [shownUnread, setShownUnread] = useState(unreadCount);
  if (!inboxOpen && shownUnread !== unreadCount) setShownUnread(unreadCount);

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
        {/* The version is the first thing to go when room runs out: it
            truncates ("3.1.3-dev.1…", full string in its tooltip), and on a
            narrow masthead it leaves altogether. */}
        <BrandMark version={APP_VERSION} versionClassName="hidden @min-[660px]/mast:block" />

        <div className="min-w-2 flex-1" />

        <div className="flex shrink-0 items-center sm:gap-0.5" style={NO_DRAG}>
          <button
            type="button"
            className={cx(ITEM, 'max-sm:hidden')}
            aria-label="Suche und Befehle"
            aria-keyshortcuts="Control+K Meta+K"
            title="Suche und Befehle (Strg+K)"
            onClick={() => setPaletteOpen(true)}
          >
            <SearchIcon size={18} />
            <span className={LABEL_MID}>Suche</span>
            <kbd
              aria-hidden
              className="hidden h-[22px] items-center rounded-[5px] border border-bar-line px-1.5 font-sans text-[12px] leading-none font-semibold text-bar-ink-2 @min-[1180px]/mast:inline-flex"
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
              {/* The dot is the narrow-window form of the count: where the
                  count badge shows, the dot would only say the same thing twice. */}
              {shownUnread > 0 && (
                <Dot className="absolute -top-0.5 -right-0.5 ring-2 ring-bar @min-[900px]/mast:hidden" />
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
            <span className={LABEL_FULL}>{privacy ? 'Beträge anzeigen' : 'Beträge ausblenden'}</span>
          </button>

          <ThemeMenu className={cx(ITEM, 'max-sm:hidden')} labelClassName={LABEL_FULL} />

          <span aria-hidden className="mx-1.5 h-6 w-px bg-bar-line max-sm:hidden" />

          <ProfileMenu />

          {/* The one action that keeps its word longest — down to a narrow
              window; on a phone it is the glyph alone. */}
          <span className="ml-1.5 hidden @min-[640px]/mast:inline-flex">
            <Button variant="bar" size="sm" iconLeft={<LogoutIcon size={16} />} onClick={() => void logout('user')}>
              Abmelden
            </Button>
          </span>
          <IconButton tone="bar" size="md" aria-label="Abmelden" className="@min-[640px]/mast:hidden" onClick={() => void logout('user')}>
            <LogoutIcon />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
