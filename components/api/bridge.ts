'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ApiClient } from '@/lib/api/types';

/** Whether this shell has the Girovo API at all (window.electronGirovoApi): the desktop app, or the design preview's fake. */
export const hasApiBridge = (): boolean => typeof window !== 'undefined' && !!window.electronGirovoApi;

/**
 * Brings Girovo's window to the front for something the user must answer (a
 * consent dialog, a transfer request, the bank's Freigabe for an app's
 * refresh): the shell's focus where it has one (phase 2), which flashes the
 * taskbar itself when Windows keeps the window behind; else the taskbar
 * button flashes until Girovo is in front.
 */
export function bringForward(): void {
  if (typeof window === 'undefined') return;
  const focus = window.electronGirovoApi?.focus;
  if (focus) {
    void focus().catch(() => window.electronWindow?.requestAttention(true));
    return;
  }
  window.electronWindow?.requestAttention(true);
}

// "Girovo API zulassen" as the shell keeps it (since 2026-11-14 the shell's
// own preference, so the pipe is there before any login): null until the
// shell has said, then true or false. One value for the page's life, asked
// once and set by the switch.
let apiOn: boolean | null = null;
let asked = false;
const onListeners = new Set<() => void>();

function setApiOnValue(next: boolean) {
  if (apiOn === next) return;
  apiOn = next;
  for (const l of onListeners) l();
}

function askShell() {
  if (asked || typeof window === 'undefined') return;
  const bridge = window.electronGirovoApi;
  if (!bridge) return;
  asked = true;
  void bridge.status().then(
    // A shell from before the switch moved there says only whether it runs.
    (s) => setApiOnValue(typeof s.on === 'boolean' ? s.on : !!s.running),
    () => setApiOnValue(false),
  );
}

const subscribeOn = (fn: () => void) => {
  onListeners.add(fn);
  askShell();
  return () => onListeners.delete(fn);
};

/** The API's switch: null while the shell has not said yet. */
export function useApiOn(): boolean | null {
  return useSyncExternalStore(subscribeOn, () => apiOn, () => null);
}

/** Turns the API on or off, as the shell will remember it at the next start too. */
export function setApiOn(on: boolean): Promise<void> {
  setApiOnValue(on);
  const bridge = typeof window === 'undefined' ? undefined : window.electronGirovoApi;
  if (!bridge) return Promise.resolve();
  return bridge.setEnabled(on).then(() => undefined, () => undefined);
}

/** Tells the shell whether the page can answer calls (logged in, the vault open); calls that waited come now. */
export function setPageReady(ready: boolean): void {
  const ready_ = typeof window === 'undefined' ? undefined : window.electronGirovoApi?.ready;
  if (ready_) void ready_(ready).catch(() => {});
}

/** The apps whose calls wait for the login, in the order they asked; empty without the bridge. */
export function useApiWaiting(): ApiClient[] {
  const [clients, setClients] = useState<ApiClient[]>([]);
  useEffect(() => {
    const bridge = window.electronGirovoApi;
    if (!bridge?.onWaiting || !bridge.waiting) return;
    let live = true;
    // The event says each change; the question covers what came before this screen.
    let heard = false;
    const off = bridge.onWaiting((w) => {
      heard = true;
      if (live) setClients(Array.isArray(w?.clients) ? w.clients : []);
    });
    void bridge.waiting().then((c) => {
      if (live && !heard) setClients(c);
    }, () => {});
    return () => {
      live = false;
      off();
    };
  }, []);
  return clients;
}
