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

/**
 * A place in the sidebar pressed while it is the current one: back to its
 * first level. Pages that open a view of their own (Zahlungen's Verträge &
 * Abos) listen for it; the provider's own levels close in the sidebar.
 */
export const PLACE_ROOT_EVENT = 'girovo:place-root';

/**
 * Mitteilungen's "Ansehen" on a contract notice: Zahlungen with Verträge &
 * Abos in view — the desktop's view of its own opened, the phone's section
 * scrolled to. Zahlungen may not be mounted yet when it is asked for, so the
 * wish waits here until it is.
 */
export const SHOW_CONTRACTS_EVENT = 'girovo:show-contracts';
let contractsWanted = false;
export function wantContracts(): void {
  contractsWanted = true;
  window.dispatchEvent(new Event(SHOW_CONTRACTS_EVENT));
}
export function takeContractsWanted(): boolean {
  const wanted = contractsWanted;
  contractsWanted = false;
  return wanted;
}
