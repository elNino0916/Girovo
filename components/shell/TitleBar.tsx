'use client';

// The frame's title bar (components/shell/frame.ts): the window's own,
// standing on the canvas. Over the sidebar the menu button that folds it,
// the G€ plate and the wordmark; over the sheet the search, a pill at the
// sheet's left edge (Strg K); then the bell, "Beträge ausblenden", the
// Darstellung and the avatar, clear of the caption buttons the OS draws at
// the right edge (--caption-inset). The whole band drags the window except
// its controls, and it is exactly as tall as the caption overlay
// (--barbar-h), as the top app bar it replaces was (Masthead).

import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useT } from '@/lib/i18n/react';
import { useFints } from '../FintsProvider';
import { ThemeMenu } from '../ThemeToggle';
import { unseenUpdate, useUpdates } from '../updates/store';
import { BellIcon, Icon, SearchIcon } from '../icons';
import { Dot, IconButton, cx } from '../ui';
import { BrandPlate } from './BrandMark';
import { PAGE_TITLE_ID } from './ids';
import { PrivacyToggle } from './PrivacyToggle';
import { ProfileMenu } from './ProfileMenu';

const DRAG = { WebkitAppRegion: 'drag' } as CSSProperties;
const NO_DRAG = { WebkitAppRegion: 'no-drag' } as CSSProperties;

export function TitleBar({ sidebarOpen, onMenu }: { sidebarOpen: boolean; onMenu: () => void }) {
  const { unreadCount, inboxOpen, setInboxOpen, setPaletteOpen, singleKeyShortcuts } = useFints();
  const t = useT();
  const updateUnseen = unseenUpdate(useUpdates());
  const inboxName = [
    t.common.nav.messages,
    unreadCount > 0 ? t.shell.unread(unreadCount) : '',
    updateUnseen ? t.shell.masthead.newAppVersion : '',
  ].filter(Boolean).join(', ');
  // The bell keeps what it showed when it was pressed until its drawer closes (as in Masthead).
  const [shown, setShown] = useState({ unread: unreadCount, update: updateUnseen });
  if (!inboxOpen && (shown.unread !== unreadCount || shown.update !== updateUnseen)) {
    setShown({ unread: unreadCount, update: updateUnseen });
  }

  return (
    <div
      data-topbar
      data-frame-bar
      className="on-bar relative z-40 flex shrink-0 items-center pr-[calc(8px_+_var(--caption-inset))] text-bar-ink"
      style={{ height: 'var(--barbar-h)', ...DRAG }}
    >
      <a
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById(PAGE_TITLE_ID)?.focus();
        }}
        className="sr-only z-200 rounded-full bg-accent font-semibold text-accent-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:px-4! focus:py-2!"
        style={NO_DRAG}
      >
        {t.shell.masthead.skip}
      </a>

      {/* Over the sidebar: the way to fold it, and the app's mark. */}
      <div className={cx('flex h-full w-[var(--frame-side)] shrink-0 items-center gap-1 transition-[width] duration-200', sidebarOpen ? 'pl-2' : 'justify-center')}>
        <IconButton
          tone="bar"
          size="md"
          aria-label={t.shell.frame.menu}
          aria-expanded={sidebarOpen}
          onClick={onMenu}
          style={NO_DRAG}
        >
          <Icon ms="menu" size={24}>{null}</Icon>
        </IconButton>
        {/* Folded to a rail, the menu alone: the mark comes back with the sidebar. */}
        {sidebarOpen && (
          <>
            <BrandPlate size={28} className="ml-1" />
            <span className="ml-2.5 truncate text-[18px] leading-6 font-bold tracking-[-0.01em]">Girovo</span>
          </>
        )}
      </div>

      {/* The search, at the sheet's left edge. */}
      <button
        type="button"
        aria-haspopup="dialog"
        aria-keyshortcuts="Control+K Meta+K"
        onClick={() => setPaletteOpen(true)}
        className={cx(
          'flex h-11 w-[min(640px,100%)] min-w-0 shrink items-center gap-3.5 rounded-full bg-[var(--md-surface-container-high)] pr-2 pl-4 text-left text-bar-ink-2',
          'transition-colors duration-150 hover:bg-[var(--md-surface-container-highest)]',
        )}
        style={NO_DRAG}
      >
        <SearchIcon size={20} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-[16px] leading-6">{t.shell.searchBar.plain}</span>
        <kbd
          aria-hidden
          className="inline-flex h-[22px] shrink-0 items-center rounded-[6px] px-1.5 font-sans text-[12px] leading-none font-medium text-bar-ink-2 shadow-[inset_0_0_0_1px_var(--md-outline-variant)]"
        >
          {`${t.shell.ctrl} K`}
        </kbd>
      </button>

      <div className="min-w-4 flex-1" />

      <div className="flex shrink-0 items-center gap-0.5" style={NO_DRAG}>
        <IconButton tone="bar" size="md" aria-label={inboxName} aria-haspopup="dialog" data-inbox-trigger onClick={() => setInboxOpen(true)}>
          <span className="relative inline-flex">
            <BellIcon />
            {(shown.unread > 0 || shown.update) && <Dot className="absolute -top-0.5 -right-0.5 ring-2 ring-bar" />}
          </span>
        </IconButton>
        <PrivacyToggle bar shortcut={singleKeyShortcuts} />
        <ThemeMenu variant="icon" />
        <ProfileMenu />
      </div>
    </div>
  );
}
