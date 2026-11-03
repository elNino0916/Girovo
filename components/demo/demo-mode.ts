'use client';

// Whether the page runs Girovo without a bank (6.0): the login screen's
// "Ohne Bank ausprobieren" starts it, the banner's "Demo beenden" and the
// demo's own logout end it (components/demo/DemoProvider.tsx). Held in memory
// only: a reload is back at the real login, and nothing of the demo is kept.

import { useSyncExternalStore } from 'react';

let demo = false;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (demo === next) return;
  demo = next;
  for (const l of listeners) l();
}

export const startDemo = () => set(true);
export const endDemo = () => set(false);

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Whether the demo is running. */
export function useDemo(): boolean {
  return useSyncExternalStore(subscribe, () => demo, () => false);
}
