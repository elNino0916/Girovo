// @capacitor/core for the desktop runtime (scripts/build-desktop.mjs aliases
// it here): the shared phone server code asks whether it runs natively —
// on the desktop it does, through the Tauri shell — and registers its plugins,
// whose desktop counterparts are in desktop/native.ts.

export type PluginListenerHandle = { remove: () => Promise<void> };

export const Capacitor = {
  isNativePlatform: (): boolean => true,
  getPlatform: (): string => 'desktop',
};

/** A plugin the desktop does not have: every call says so. */
export function registerPlugin<T>(name: string): T {
  return new Proxy({}, {
    get: (_target, method) => () => Promise.reject(new Error(`${name}.${String(method)} is not available on the desktop`)),
  }) as T;
}
