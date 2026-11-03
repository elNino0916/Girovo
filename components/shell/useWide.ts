'use client';

// Whether the window is wide enough for the Übersicht side by side (6.0):
// from 1280px — Tailwind's `xl`, which the account page's head keys on too —
// every account stands in a pane beside the open account's page, once there
// is more than one account (components/Dashboard.tsx SplitOverview). For
// what CSS alone cannot switch: which of two layouts renders at all.

import { hasOverview } from '@/lib/account-overview';
import { useFints } from '../FintsProvider';
import { useMediaQuery } from './useMediaQuery';

export function useWide(): boolean {
  return useMediaQuery('(min-width: 1280px)');
}

/** The Übersicht side by side: a wide window, the Übersicht, more than one account or bank. */
export function useSplitOverview(): boolean {
  const { tab, accounts, banks } = useFints();
  const wide = useWide();
  return wide && tab === 'overview' && hasOverview(accounts, banks);
}
