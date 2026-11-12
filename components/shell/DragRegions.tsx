'use client';

// The window's drag areas in the Tauri desktop app on Windows, kept up to date.
//
// wry turns on WebView2's non-client regions: every box with app-region: drag
// becomes a band that moves the window, every no-drag box inside it a hole.
// Chromium works that set out again when an element's app-region changes,
// but not reliably when elements merely appear, go or move. Seen on the
// owner's window on 2026-11-12: after signing in, the title bar still dragged
// where the login screen's bar and brand field had been, over the search
// field, and not at all left of the Girovo AI button, where the login's
// buttons had been.
//
// So whenever a drag or no-drag box changes (a screen replaces another, the
// sidebar folds, a dialog's scrim comes or goes, the window is resized), the
// app-region of one hidden 1px box outside the window flips and flips back.
// That makes Chromium work out the whole set from the page as it is now.

import { useEffect } from 'react';
import type { CSSProperties } from 'react';

const NUDGE: CSSProperties = {
  position: 'fixed', left: -8, top: -8, width: 1, height: 1, pointerEvents: 'none', WebkitAppRegion: 'no-drag',
} as CSSProperties;

/** Where every box with an app-region of its own is, as one string: what the window's drag areas are made of. */
function layoutKey(): string {
  let key = '';
  for (const el of document.querySelectorAll<HTMLElement>('[style*="app-region"]')) {
    if (el.dataset.dragNudge !== undefined) continue;
    const r = el.getBoundingClientRect();
    key += `${el.style.getPropertyValue('app-region') || el.style.getPropertyValue('-webkit-app-region')}:${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)};`;
  }
  return key;
}

export function DragRegions() {
  useEffect(() => {
    // Windows only: the page draws the caption buttons there (CaptionButtons).
    if (!window.electronCaption) return;
    const nudge = document.querySelector<HTMLElement>('[data-drag-nudge]');
    if (!nudge) return;
    let last = '';
    let frame = 0;
    const check = () => {
      frame = 0;
      const key = layoutKey();
      if (key === last) return;
      last = key;
      nudge.style.setProperty('app-region', 'drag');
      // Read back, so the flip is a style change of its own before it flips back.
      void nudge.getBoundingClientRect();
      requestAnimationFrame(() => nudge.style.setProperty('app-region', 'no-drag'));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    schedule();
    // A screen or layer coming or going, a box changing its size or place.
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    window.addEventListener('resize', schedule);
    // Transitions (the sidebar folding) end after the last mutation.
    document.addEventListener('transitionend', schedule, true);
    document.addEventListener('animationend', schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
      window.removeEventListener('resize', schedule);
      document.removeEventListener('transitionend', schedule, true);
      document.removeEventListener('animationend', schedule, true);
    };
  }, []);
  return <div data-drag-nudge aria-hidden style={NUDGE} />;
}
