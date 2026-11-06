// @capacitor/core for the phone server's bundle (scripts/build-mobile.mjs
// aliases it here): the server runs in a worker, and Capacitor's bridge is
// only on the page. A plugin here is a stand-in whose every method is the
// page's plugin of that name, called across the line (mobile/worker/link.ts;
// mobile/bridges/server.ts calls it there) — and on the page's own thread,
// where the server falls back to, the very same plugin called in place.

import { boot, page } from '../server';

export type PluginListenerHandle = { remove: () => Promise<void> };

export const Capacitor = {
  isNativePlatform: (): boolean => boot().native,
  getPlatform: (): string => boot().platform,
};

/** The page's plugin `name`, method by method. */
export function registerPlugin<T>(name: string): T {
  // This side's own listeners: removeAllListeners must not take the page's own.
  const subscriptions = new Set<() => void>();
  return new Proxy({} as Record<string, unknown>, {
    get(_target, prop) {
      // Never a thenable: a plugin may be the value a promise resolves with.
      if (typeof prop !== 'string' || prop === 'then') return undefined;
      if (prop === 'addListener') {
        return (event: string, fn: (payload: unknown) => void): Promise<PluginListenerHandle> => {
          const off = page().listen('plugin', [name, event], fn);
          const stop = () => {
            subscriptions.delete(stop);
            off();
          };
          subscriptions.add(stop);
          return Promise.resolve({ remove: async () => stop() });
        };
      }
      if (prop === 'removeAllListeners') {
        return async () => {
          for (const stop of [...subscriptions]) stop();
        };
      }
      return (...args: unknown[]) => page().call('plugin', [name, prop, args]);
    },
  }) as T;
}
