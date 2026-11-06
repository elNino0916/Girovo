'use client';

// The frame's search (components/shell/frame.ts): the title bar's pill is the
// field itself, not a button that opens a dialog. A press on it, Strg K, "/"
// or the filter bar's search chip put the caret in it, and what it finds drops
// under it as Material's docked search view: the pill grows into one
// container on Container High, the results under a hairline, the page left
// where it is, with no scrim. The search is the palette's (usePalette in
// components/CommandPalette.tsx): Aktionen, Konten, Umsätze, in that order.
//
// Esc, a choice, a press elsewhere or Tab away close it, and the caret goes
// back to where it was before the search took it. While the window is in the
// background it stays open, as a field does.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, FocusEvent, KeyboardEvent } from 'react';
import { useT } from '@/lib/i18n/react';
import { PaletteKeys, PaletteResults, usePalette } from '../CommandPalette';
import { useFints } from '../FintsProvider';
import { CloseIcon, SearchIcon } from '../icons';
import { IconButton, cx } from '../ui';

const NO_DRAG = { WebkitAppRegion: 'no-drag' } as CSSProperties;

export function FrameSearch() {
  const { paletteOpen: open, setPaletteOpen } = useFints();
  const t = useT();
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Where focus was before the search took it. */
  const returnTo = useRef<HTMLElement | null>(null);

  /** Ends the search; the caret goes back where it was, if it is still in the field. */
  const close = () => {
    setPaletteOpen(false);
    const back = returnTo.current;
    returnTo.current = null;
    if (document.activeElement !== inputRef.current) return;
    if (back?.isConnected) back.focus({ preventScroll: true });
    else inputRef.current?.blur();
  };
  const p = usePalette({ onClose: close, steerFromStart: true });

  // Closed, it starts empty the next time, however it was closed (a choice
  // elsewhere, such as a Mitteilung's link, closes it through the provider).
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    // And from its first row: Enter must never run what was lit last time.
    if (!open) {
      p.setQuery('');
      p.setActive(0);
    }
  }

  // Opened by a key or another control: the caret goes into the field.
  useEffect(() => {
    if (!open) return;
    const el = document.activeElement;
    if (el === inputRef.current) return;
    returnTo.current = el instanceof HTMLElement && el !== document.body ? el : null;
    inputRef.current?.focus();
  }, [open]);

  const onFocus = (e: FocusEvent<HTMLInputElement>) => {
    if (open) return;
    const from = e.relatedTarget;
    returnTo.current = from instanceof HTMLElement && !wrapRef.current?.contains(from) ? from : null;
    setPaletteOpen(true);
  };

  // Focus left for something else on the page: the search is done. Not when
  // the window itself lost focus, and not for the clear button inside.
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!open || !document.hasFocus()) return;
    if (e.relatedTarget instanceof Node && wrapRef.current?.contains(e.relatedTarget)) return;
    setPaletteOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    // Closed while the caret stayed (a choice elsewhere closed it): an arrow opens it again.
    if (!open) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setPaletteOpen(true);
      }
      return;
    }
    p.onKeyDown(e);
  };

  return (
    <div
      ref={wrapRef}
      data-frame-search
      className="relative h-11 w-[min(640px,100%)] min-w-0 shrink"
      style={NO_DRAG}
      onBlur={onBlur}
    >
      {open && (
        // The docked view: one container from the field down, the field its top.
        // A press inside keeps the caret in the field.
        <div
          className="anim-pop absolute inset-x-0 top-0 flex max-h-[min(640px,calc(100dvh-24px))] flex-col overflow-hidden rounded-[22px] bg-[var(--md-surface-container-high)] pt-11 text-ink shadow-[var(--shadow-pop)] [--raised:var(--md-surface-container-high)]"
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-[var(--md-outline-variant)] py-2 [scrollbar-color:var(--md-outline-variant)_transparent] [scrollbar-width:thin]">
            <PaletteResults p={p} />
          </div>
          <PaletteKeys className="border-t border-[var(--md-outline-variant)]" />
        </div>
      )}

      <div
        className={cx(
          'relative flex h-11 items-center gap-3.5 rounded-full pr-2 pl-4 text-bar-ink-2',
          !open && 'bg-[var(--md-surface-container-high)] transition-colors duration-150 hover:bg-[var(--md-surface-container-highest)]',
        )}
        onMouseDown={(e) => {
          // A press beside the text (the glyph, the padding) still means the field.
          if (e.target !== inputRef.current && !(e.target as HTMLElement).closest('button, [data-icon-button]')) {
            e.preventDefault();
            inputRef.current?.focus();
          }
        }}
      >
        <SearchIcon size={20} className="shrink-0" />
        <input
          ref={inputRef}
          {...p.field}
          // The bar is the field: no outline of its own (app/material.css).
          data-bare
          // Its name is the words it shows, so "Umsätze und mehr suchen" said aloud finds it.
          aria-label={t.shell.searchBar.plain}
          aria-expanded={open}
          aria-controls={open ? p.listId : undefined}
          aria-activedescendant={open ? p.field['aria-activedescendant'] : undefined}
          aria-keyshortcuts="Control+K Meta+K"
          placeholder={t.shell.searchBar.ask}
          onFocus={onFocus}
          onClick={() => { if (!open) setPaletteOpen(true); }}
          onChange={(e) => {
            p.field.onChange(e);
            if (!open) setPaletteOpen(true);
          }}
          onKeyDown={onKeyDown}
          className="h-full min-w-0 flex-1 bg-transparent text-[16px] leading-6 text-bar-ink outline-none placeholder:text-bar-ink-2"
        />
        {p.query ? (
          <IconButton
            tone="bar"
            size="sm"
            aria-label={t.transactions.filter.clear}
            onClick={() => {
              p.setQuery('');
              inputRef.current?.focus();
            }}
          >
            <CloseIcon size={20} />
          </IconButton>
        ) : (
          !open && (
            <kbd
              aria-hidden
              className="inline-flex h-[22px] shrink-0 items-center rounded-[6px] px-1.5 font-sans text-[12px] leading-none font-medium text-bar-ink-2 shadow-[inset_0_0_0_1px_var(--md-outline-variant)]"
            >
              {`${t.shell.ctrl} K`}
            </kbd>
          )
        )}
      </div>
    </div>
  );
}
