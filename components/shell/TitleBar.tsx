'use client';

// The frame's title bar (components/shell/frame.ts): the window's own,
// standing on the canvas. Over the sidebar the menu button that folds it,
// the G€ plate and the wordmark; over the sheet the search, a pill at the
// sheet's left edge that is the field itself (FrameSearch, Strg K); then the
// bell, "Beträge ausblenden", the Darstellung and the avatar, clear of the
// caption buttons the OS draws at
// the right edge (--caption-inset). The whole band drags the window except
// its controls, and it is exactly as tall as the caption overlay
// (--barbar-h), as the top app bar it replaces was (Masthead).

import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useT } from '@/lib/i18n/react';
import { useFints } from '../FintsProvider';
import { ThemeMenu } from '../ThemeToggle';
import { useContractNotices } from '../insights/contract-notices';
import { unseenUpdate, useUpdates } from '../updates/store';
import { BellIcon, AiMarkIcon, Icon } from '../icons';
import { Dot, IconButton, cx } from '../ui';
import { BrandName, BrandPlate } from './BrandMark';
import { FrameSearch } from './FrameSearch';
import { PAGE_TITLE_ID } from './ids';
import { PrivacyToggle } from './PrivacyToggle';
import { useCanAsk } from '../insights/ask-gate';
import { closeAsk, openAsk, useAskThread } from '../insights/ask-thread-store';
import { ProfileMenu } from './ProfileMenu';

const DRAG = { WebkitAppRegion: 'drag' } as CSSProperties;
const NO_DRAG = { WebkitAppRegion: 'no-drag' } as CSSProperties;

export function TitleBar({ sidebarOpen, onMenu }: { sidebarOpen: boolean; onMenu: () => void }) {
  const { unreadCount, inboxOpen, setInboxOpen, singleKeyShortcuts } = useFints();
  const t = useT();
  const updateUnseen = unseenUpdate(useUpdates());
  // A contract's price rise or notice period not yet seen in Mitteilungen: the dot, no number (as in Masthead).
  const contractUnseen = useContractNotices().unseen.length > 0;
  const inboxName = [
    t.common.nav.messages,
    unreadCount > 0 ? t.shell.unread(unreadCount) : '',
    updateUnseen ? t.shell.masthead.newAppVersion : '',
    contractUnseen ? t.shell.masthead.newContractNews : '',
  ].filter(Boolean).join(', ');
  // The bell keeps what it showed when it was pressed until its drawer closes (as in Masthead).
  const [shown, setShown] = useState({ unread: unreadCount, update: updateUnseen, contract: contractUnseen });
  if (!inboxOpen && (shown.unread !== unreadCount || shown.update !== updateUnseen || shown.contract !== contractUnseen)) {
    setShown({ unread: unreadCount, update: updateUnseen, contract: contractUnseen });
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
            <BrandName className="ml-2.5 text-[18px] leading-6 font-medium" />
          </>
        )}
      </div>

      {/* The search, at the sheet's left edge: the field itself (FrameSearch). */}
      <FrameSearch />

      <div className="min-w-4 flex-1" />

      <div className="flex shrink-0 items-center gap-0.5" style={NO_DRAG}>
        <AskToggle />
        <IconButton tone="bar" size="md" aria-label={inboxName} aria-haspopup="dialog" data-inbox-trigger onClick={() => setInboxOpen(true)}>
          <span className="relative inline-flex">
            <BellIcon />
            {(shown.unread > 0 || shown.update || shown.contract) && <Dot className="absolute top-0.5 -right-0.5 ring-2 ring-bar" />}
          </span>
        </IconButton>
        <PrivacyToggle bar shortcut={singleKeyShortcuts} />
        <ThemeMenu variant="icon" />
        <ProfileMenu />
      </div>
    </div>
  );
}

/** Girovo Next: "Fragen" beside the page, opened and closed from the title bar (the last conversation, or an empty one). */
function AskToggle() {
  const t = useT();
  const canAsk = useCanAsk();
  const ask = useAskThread();
  if (!canAsk) return null;
  return (
    <IconButton tone="bar" size="md" aria-label={t.ask.thread.title} aria-pressed={ask.open} onClick={() => (ask.open ? closeAsk() : openAsk())}>
      <AiMarkIcon size={20} />
    </IconButton>
  );
}
