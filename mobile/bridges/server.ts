// The phone server, from the page: mobile-server.js in a worker beside the
// page (mobile/worker/host.ts), and the page's fetch('/api/…') answered by it.
//
// What the server asks of the page comes here: Capacitor's plugins (its
// bridge is only on the page) — Filesystem for the saved files, GirovoHttp
// for the bank, App's "pause", GirovoNano, GirovoBackground, GirovoSync … —
// the integrity check (the user's choice is in the page's storage) and the
// telemetry hub (mobile/bridges/telemetry.ts).

import { App } from '@capacitor/app';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { Filesystem } from '@capacitor/filesystem';
import * as native from '../native';
import { installFetch } from '../server/fetch';
import { startServer, type ServerHandle } from '../worker/host';
import { integrity } from './integrity';

type Plugin = Record<string, (...args: unknown[]) => unknown> & {
  addListener(event: string, fn: (payload: unknown) => void): Promise<PluginListenerHandle>;
};

/** Every plugin the server may reach, by the name it registers (mobile/worker/capacitor/core.ts). */
const PLUGINS: Record<string, Plugin> = {
  ...(Object.fromEntries(Object.entries(native).filter(([name]) => name.startsWith('Girovo'))) as unknown as Record<string, Plugin>),
  Filesystem: Filesystem as unknown as Plugin,
  App: App as unknown as Plugin,
};

function plugin(name: string): Plugin {
  const found = PLUGINS[name];
  if (!found) throw new Error(`Girovo: the server cannot reach the plugin ${name}`);
  return found;
}

type Sink = (message: Record<string, unknown>) => void;

export function startPhoneServer(): ServerHandle {
  const server = startServer({
    script: '/mobile-server.js',
    boot: {
      platform: Capacitor.getPlatform(),
      version: '',
      native: Capacitor.isNativePlatform(),
      // The worker's console reaches logcat only through the page's.
      console: Capacitor.isNativePlatform(),
    },
    calls: {
      plugin: (name: string, method: string, args: unknown[]) => {
        const p = plugin(name);
        return p[method](...args);
      },
      integrity: () => integrity(),
      telemetry: (message: Record<string, unknown>) => (globalThis as { __girovoTelemetrySink?: Sink }).__girovoTelemetrySink?.(message),
    },
    sources: {
      plugin: (emit, name: string, event: string) => {
        const handle = plugin(name).addListener(event, emit);
        return () => void handle.then((h) => h.remove());
      },
    },
  });
  installFetch(server.handle);
  return server;
}
