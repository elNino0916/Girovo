// The server's side of its line to the page (mobile/worker/link.ts): what the
// server bundles (mobile/server/entry.ts, desktop/server/entry.ts) start with.
//
// The same script runs in either of two places, and finds out which here:
//
//  - in a Web Worker (the usual case): it says it is alive, waits for the
//    page's facts (Boot), then loads the route handlers and answers the
//    page's requests over the line — "loaded" once they are in, "ready" once
//    the server has started (read its files);
//  - on the page's own thread, as a <script> (mobile/worker/host.ts falls
//    back to that where no worker starts): the page put its facts and its
//    functions on globalThis.__girovoServerHost first, and they are called in
//    place, exactly as before the server had a worker.
//
// What the server code needs from the page goes through page(): a Capacitor
// plugin (mobile/worker/capacitor/), Tauri's invoke (desktop/server/entry.ts),
// the integrity check, the telemetry hub.

import { isLocale, setActiveLocale } from '../../lib/i18n/locale.ts';
import { relayVisibility } from '../server/visibility';
import { Direct, Link, packError, packResponse, unpackRequest, type Calls, type Line, type Port, type Sources, type WireRequest } from './link';

/** What the page tells the server at start. */
export type Boot = {
  /** Capacitor's platform ("android", "web"), or the Tauri shell's ("windows", "linux"). */
  platform: string;
  version: string;
  /** Capacitor.isNativePlatform() on the page (the desktop: always). */
  native: boolean;
  /** document.hidden when the server started; the worker hears of every change after. */
  hidden: boolean;
  /** The worker's console goes to the page's as well: Android's logcat only hears the page. */
  console: boolean;
};

/** What a server bundle hands back once its route handlers are in. */
export type Server = {
  ready: Promise<void>;
  handle(req: Request): Promise<Response>;
  /** What the page's own bridges ask the server directly (mobile/bridges/biometric.ts …). */
  calls?: Calls;
};

/** The page's side of a server on its own thread (mobile/worker/host.ts). */
export type LocalHost = {
  boot: Boot;
  calls: Calls;
  sources: Sources;
  attach(server: Server): void;
  failed(err: unknown): void;
};

/** Whether this script runs in a worker (no document, a postMessage of its own). */
export const inWorker: boolean =
  typeof document === 'undefined' && typeof (globalThis as { postMessage?: unknown }).postMessage === 'function';

let line: Line | null = null;
let facts: Boot | null = null;

/** The line to the page, once the server is connected to it. */
export function page(): Line {
  if (!line) throw new Error('Girovo: the server has no line to its page yet');
  return line;
}

/** The page's facts, once given. */
export function boot(): Boot {
  if (!facts) throw new Error('Girovo: the server has not been started yet');
  return facts;
}

/** Starts the server wherever this script runs; `load` brings in its route handlers. */
export function serve(load: (boot: Boot) => Promise<Server>): void {
  if (inWorker) serveInWorker(load);
  else serveOnPage(load);
}

function serveOnPage(load: (boot: Boot) => Promise<Server>): void {
  const host = (globalThis as { __girovoServerHost?: LocalHost }).__girovoServerHost;
  if (!host) {
    console.error('[server] loaded without its page (mobile/worker/host.ts)');
    return;
  }
  facts = host.boot;
  line = new Direct({ calls: host.calls, sources: host.sources });
  load(host.boot).then(
    (server) => host.attach(server),
    (err: unknown) => host.failed(err),
  );
}

function serveInWorker(load: (boot: Boot) => Promise<Server>): void {
  let server: Promise<Server> | null = null;
  const loaded = () => {
    if (!server) throw new Error('Girovo: the server has not been started yet');
    return server;
  };
  const link = new Link(globalThis as unknown as Port, {
    calls: {
      async fetch(wire: WireRequest) {
        const s = await loaded();
        // The page's language: msgs() outside a request speaks it, and handle() asks for it.
        if (isLocale(wire.locale)) setActiveLocale(wire.locale);
        return packResponse(await s.handle(unpackRequest(wire)));
      },
      async call(name: string, args: unknown[]) {
        const fn = (await loaded()).calls?.[name];
        if (typeof fn !== 'function') throw new Error(`Girovo: the server has no "${name}"`);
        return fn(...args);
      },
    },
    other(message) {
      if (message.k !== 'init' || server) return;
      server = start(message.boot as Boot);
    },
  });

  function start(given: Boot): Promise<Server> {
    facts = given;
    line = link;
    relayVisibility(given.hidden);
    link.listen('visibility', [], (hidden) => relayVisibility(hidden === true));
    if (given.console) forwardConsole(link);
    const loading = load(given);
    loading.then(
      (s) => {
        link.post({ k: 'loaded' });
        void s.ready.then(() => link.post({ k: 'ready' }));
      },
      (err: unknown) => {
        console.error('[server] could not load', err);
        link.post({ k: 'failed', error: packError(err) });
      },
    );
    return loading;
  }

  link.post({ k: 'alive' });
}

/** One console argument as text: the page's console may only take what can be cloned. */
function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function forwardConsole(link: Link): void {
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const own = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      own(...args);
      link.send('console', [level, args.map(asText).join(' ')]);
    };
  }
}
