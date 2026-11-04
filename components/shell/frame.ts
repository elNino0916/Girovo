'use client';

// The desktop's window frame ("Konten als Ebenen", the owner's pick on
// 2026-11-04 from .impeccable/mocks/decision/desktop-shell/): Google's desktop
// Material 3 Expressive instead of the phone's rail scaled up. A tinted
// window canvas holds the title bar and the sidebar; the page is a white
// sheet beside them (components/Dashboard.tsx FramedDashboard). Android keeps
// its rail at every width: the frame is the desktop's (the Electron window
// and the localhost build), from 640px.

import { useCallback, useState } from 'react';
import { store } from '@/lib/client-api';
import { IS_ANDROID } from '@/lib/platform';
import { useMediaQuery } from './useMediaQuery';

/** Whether the frame is drawn: the desktop, from 640px. */
export function useDesktopFrame(): boolean {
  const wide = useMediaQuery('(min-width: 640px)');
  return !IS_ANDROID && wide;
}

const SIDEBAR_PREF = 'fints.sidebar';

/**
 * The sidebar open — 272px with the labels, the month and the accounts — or
 * folded to a rail of icons. Open from 1100px unless the user folded it, a
 * rail on a narrower window unless they opened it; the menu button in the
 * title bar switches it, and the choice is kept (prefs, no personal data).
 */
export function useSidebarOpen(): [boolean, () => void] {
  const roomy = useMediaQuery('(min-width: 1100px)', true);
  const [pref, setPref] = useState<string | null>(() => store.get(SIDEBAR_PREF));
  const open = pref === 'open' ? true : pref === 'rail' ? false : roomy;
  const toggle = useCallback(() => {
    const next = open ? 'rail' : 'open';
    store.set(SIDEBAR_PREF, next);
    setPref(next);
  }, [open]);
  return [open, toggle];
}
