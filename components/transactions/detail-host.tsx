'use client';

// One Umsatzdetails drawer for the whole overview.
//
// Overlays render in place (never portalled — they must stay inside the
// print:hidden wrapper), and the Vorgemerkt panel lives in the sidebar, which
// the layout makes sticky. A sticky element is its own stacking context, so a
// drawer rendered from inside it could only ever stack within the sidebar and
// would slide under the masthead. The drawer is therefore hosted by the
// Umsätze tile in the main column; the panel only asks for it. Should the
// panel ever stand without that tile, it hosts the drawer itself.

import { useEffect, useSyncExternalStore } from 'react';
import type { SerializedTransaction } from '@/lib/fints-types';
import { rowKey } from './model';
import { TxDetail } from './TxDetail';

type Shown = { tx: SerializedTransaction; pending: boolean } | null;

let shown: Shown = null;
let hosts = 0;
let primaryHosts = 0;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Opens the drawer on a booking — `pending` for a Vormerkposten. */
export function openTxDetail(tx: SerializedTransaction, pending = false): void {
  shown = { tx, pending };
  emit();
}

export function closeTxDetail(): void {
  if (!shown) return;
  shown = null;
  emit();
}

export function TxDetailHost({ fallback = false }: { fallback?: boolean }) {
  const current = useSyncExternalStore(subscribe, () => shown, () => null);
  const primaries = useSyncExternalStore(subscribe, () => primaryHosts, () => 0);

  useEffect(() => {
    hosts++;
    if (!fallback) primaryHosts++;
    emit();
    return () => {
      hosts--;
      if (!fallback) primaryHosts--;
      // The last host gone (a logout, an account without Umsätze): nothing
      // may reopen later on a booking from a session that has ended.
      if (hosts === 0) shown = null;
      emit();
    };
  }, [fallback]);

  if (!current || (fallback && primaries > 0)) return null;
  // Keyed by the booking, so the drawer's own state (the category choice)
  // never carries over to the next one.
  return <TxDetail key={rowKey(current.tx)} tx={current.tx} pending={current.pending} onClose={closeTxDetail} />;
}
