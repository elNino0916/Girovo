'use client';

// "Letzte Buchung zeigen": whether the overview's account rows carry each
// account's newest booking under the name (issue #22). This device's view
// only, like the black background: kept in the shell's store, never synced.

import { useSyncExternalStore } from 'react';
import { store } from '@/lib/client-api';

// fints.*: the desktop shell's store keeps no other keys (src-tauri/src/bridge.js PREF_KEY).
const KEY = 'fints.overview.lastBooking';
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return store.get(KEY) !== '0';
  } catch {
    return true;
  }
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** On unless switched off. */
export function useLastBookingShown(): boolean {
  return useSyncExternalStore(subscribe, read, () => true);
}

export function setLastBookingShown(on: boolean): void {
  store.set(KEY, on ? '1' : '0');
  for (const l of listeners) l();
}
