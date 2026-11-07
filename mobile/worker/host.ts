// The page's side of the in-page server (mobile/worker/link.ts): starts the
// route handlers in a Web Worker of their own and answers the page's
// fetch('/api/…') through it (mobile/server/fetch.ts installFetch). The
// Android runtime (mobile/bridges/server.ts) and the desktop's
// (desktop/host.ts) hand it what the server may ask of the page: their
// shell's functions and event sources.
//
// Where no worker starts — a WebView without them, a script its loader will
// not hand a worker, an error while the handlers load — the server runs on
// the page's own thread instead, as it always did: the same script as a
// <script>, its calls to the page made in place. Tried in this order:
//
//   1. a worker from the script's URL
//   2. a worker from the script's bytes, fetched by the page (a loader that
//      serves the page but not a worker: Android's asset loader, a custom
//      scheme)
//   3. the page's own thread
//
// A worker that has said it is alive but whose route handlers have not
// loaded within START_LIMIT_MS is ended before the next try, so two servers
// never hold the same files. Once loaded, the worker is the server for good:
// a start that cannot read its files still answers, as before.
//
// localStorage `girovo.server.thread` = `page` skips the worker (a way out
// should one misbehave on some device).

import { activeLocale } from '../../lib/i18n/locale.ts';
import { Link, packRequest, unpackError, unpackResponse, type Calls, type Sources, type WireResponse } from './link';
import type { Boot, LocalHost, Server } from './server';

export type HostOptions = {
  /** The server bundle, from the page's origin: /desktop-server.js, /mobile-server.js. */
  script: string;
  boot: Omit<Boot, 'hidden'>;
  calls: Calls;
  sources: Sources;
};

export type Thread = 'worker' | 'page';

export type ServerHandle = {
  /** Resolves once the server has started — or never will; requests then fail as unreachable. */
  ready: Promise<void>;
  /** Where it runs, once that is settled. */
  thread: Promise<Thread | null>;
  handle(req: Request): Promise<Response>;
  /** One of the server's own functions (Server.calls), for the page's bridges. */
  call<T = unknown>(name: string, ...args: unknown[]): Promise<T>;
};

type Transport = {
  thread: Thread;
  handle(req: Request): Promise<Response>;
  call(name: string, args: unknown[]): Promise<unknown>;
};

/** From a worker's start to its route handlers loaded: a slow phone parses a few MB of script in well under this. */
const START_LIMIT_MS = 15_000;

/** What every page offers its server: its visibility (mobile/server/visibility.ts), its console. */
const SOURCES: Sources = {
  visibility(emit) {
    const on = () => emit(document.hidden);
    on();
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  },
};

const CALLS: Calls = {
  console(level: 'log' | 'info' | 'warn' | 'error' | 'debug', text: string) {
    (console[level] ?? console.log)(`[worker] ${text}`);
  },
};

let current: ServerHandle | null = null;

function pageAsked(): boolean {
  try {
    return localStorage.getItem('girovo.server.thread') === 'page';
  } catch {
    return false;
  }
}

const describe = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function startServer(options: HostOptions): ServerHandle {
  const opts: HostOptions = { ...options, calls: { ...CALLS, ...options.calls }, sources: { ...SOURCES, ...options.sources } };
  let readyNow!: () => void;
  const ready = new Promise<void>((resolve) => (readyNow = resolve));

  const transport = (async (): Promise<Transport> => {
    if (!pageAsked()) {
      const tries: [string, () => Promise<string>][] = [
        ['url', async () => opts.script],
        ['bytes', () => scriptBytes(opts.script)],
      ];
      for (const [how, where] of tries) {
        try {
          return await inWorker(opts, where, readyNow);
        } catch (err) {
          console.warn(`[server] no worker (${how}): ${describe(err)}`);
        }
      }
    }
    return onPage(opts, readyNow);
  })();
  transport.then(
    (t) => console.info(`[server] runs ${t.thread === 'worker' ? 'in a worker' : "on the page's thread"}`),
    (err: unknown) => {
      console.error('[server] did not start', err);
      readyNow();
    },
  );

  current = {
    ready,
    thread: transport.then((t) => t.thread, () => null),
    handle: async (req) => (await transport).handle(req),
    call: async <T>(name: string, ...args: unknown[]) => (await (await transport).call(name, args)) as T,
  };
  return current;
}

/** One of the server's own functions, for a bridge on the page (mobile/bridges/biometric.ts …). */
export function serverCall<T = unknown>(name: string, ...args: unknown[]): Promise<T> {
  if (!current) return Promise.reject(new Error('Girovo: the server has not been started'));
  return current.call<T>(name, ...args);
}

/** The script as a blob: URL, from the page's own fetch. */
async function scriptBytes(script: string): Promise<string> {
  const res = await fetch(script);
  if (!res.ok) throw new Error(`${script}: ${res.status}`);
  return URL.createObjectURL(new Blob([await res.arrayBuffer()], { type: 'text/javascript' }));
}

async function inWorker(opts: HostOptions, where: () => Promise<string>, readyNow: () => void): Promise<Transport> {
  if (typeof Worker !== 'function') throw new Error('this WebView has no workers');
  const url = await where();
  const worker = new Worker(url, { name: 'girovo-server' });
  const letGo = () => {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  };

  return new Promise<Transport>((resolve, reject) => {
    let settled = false;
    const fail = (why: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // What the worker had subscribed to on the page (visibility, the App
      // plugin's pause) stops with it.
      link.close();
      worker.terminate();
      letGo();
      reject(why);
    };
    const timer = setTimeout(() => fail(new Error(`its route handlers did not load within ${START_LIMIT_MS / 1000} s`)), START_LIMIT_MS);
    worker.addEventListener('error', (e) => {
      if (settled) return; // after the start, an uncaught error is the worker's own, in its console
      e.preventDefault();
      fail(new Error(e.message || `${opts.script} did not start`));
    });

    const link = new Link(worker, {
      calls: opts.calls,
      sources: opts.sources,
      other(message) {
        switch (message.k) {
          case 'alive':
            letGo();
            link.post({ k: 'init', boot: { ...opts.boot, hidden: document.hidden } satisfies Boot });
            return;
          case 'loaded':
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(transport);
            return;
          case 'failed':
            fail(unpackError(message.error));
            return;
          case 'ready':
            readyNow();
            return;
        }
      },
    });

    const transport: Transport = {
      thread: 'worker',
      async handle(req) {
        const wire = await packRequest(req, activeLocale());
        return unpackResponse(await link.call<WireResponse>('fetch', [wire.value], wire.transfer));
      },
      call: (name, args) => link.call('call', [name, args]),
    };
  });
}

function onPage(opts: HostOptions, readyNow: () => void): Promise<Transport> {
  return new Promise<Transport>((resolve, reject) => {
    const host: LocalHost = {
      boot: { ...opts.boot, hidden: document.hidden },
      calls: opts.calls,
      sources: opts.sources,
      attach(server: Server) {
        void server.ready.then(readyNow, readyNow);
        resolve({
          thread: 'page',
          handle: (req) => server.handle(req),
          async call(name, args) {
            const fn = server.calls?.[name];
            if (typeof fn !== 'function') throw new Error(`Girovo: the server has no "${name}"`);
            return fn(...args);
          },
        });
      },
      failed: reject,
    };
    (globalThis as { __girovoServerHost?: LocalHost }).__girovoServerHost = host;
    const script = document.createElement('script');
    script.src = opts.script;
    script.onerror = () => reject(new Error(`${opts.script} did not load`));
    // Loaded, but thrown before it reached serve() (a page the shell handed out
    // for a missing file, a syntax error): it never attaches — say so, and
    // requests fail as unreachable instead of waiting for ever.
    script.onload = () => {
      if (!host.reached) reject(new Error(`${opts.script} did not start`));
    };
    document.head.appendChild(script);
  });
}
