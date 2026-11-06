// Whether the app is in the background, for the server code (mobile/server/fetch.ts):
// on the page that is the document's own visibility; in the server's worker,
// which has no document, it is the page's, sent across as it changes
// (mobile/worker/server.ts relays it).

const hasDocument = typeof document !== 'undefined';

let relayed = false;
const listeners = new Set<() => void>();

/** Whether the app is in the background now. */
export function appHidden(): boolean {
  return hasDocument ? document.hidden : relayed;
}

/** Calls `fn` on every change; returns how to stop. */
export function onAppVisibility(fn: () => void): () => void {
  if (hasDocument) {
    document.addEventListener('visibilitychange', fn);
    return () => document.removeEventListener('visibilitychange', fn);
  }
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** The page's visibility, as the worker hears of it. */
export function relayVisibility(hidden: boolean): void {
  if (hasDocument || relayed === hidden) return;
  relayed = hidden;
  for (const fn of [...listeners]) fn();
}
