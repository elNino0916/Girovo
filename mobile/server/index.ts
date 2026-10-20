// The phone server: Girovo's route handlers (app/api/**/route.ts), unchanged,
// running inside the app's WebView instead of a Node process.
//
// The desktop app is a Next.js server the Electron window talks to over
// localhost. A phone has no such process, so scripts/build-mobile.mjs bundles
// the same handlers — and lib-fints with them — for the WebView, with the Node
// modules they import replaced by mobile/shims/*. The page's fetch('/api/…')
// is answered here (mobile/server/fetch.ts), and the bank is reached through
// the app's native HTTP stack. Nothing about a session leaves the phone except
// the FinTS messages to the bank — the same promise the desktop makes.
//
// Order matters: ./assets puts banks-data.json and config.json in place before
// the route modules, which read them while they load.

import './assets';
import { App } from '@capacitor/app';
import { ROUTES } from 'girovo:routes';
import { bankPolicy, describeError } from '../../lib/bank-fetch.ts';
import { activeLocale } from '../../lib/i18n/locale.ts';
import type { AsyncLocalStorage } from '../shims/async-hooks';
import { flush, mountData } from '../shims/fs';
import { installFetch } from './fetch';
import { startNano } from './categories';

// The bank's minute to start answering is timed by the native HTTP stack
// (HttpPlugin.java): a timer in the page stops while the app is in the
// background — the user approving in their bank's app — and would fire late
// on the way back, ending a request the bank had answered.
bankPolicy.firstByteMs = Infinity;

/** Whether this phone has Gemini Nano, asked once at start (mobile/server/categories.ts). */
const nano = startNano();

/** What a route needs done before it runs. */
const BEFORE: Record<string, () => Promise<unknown>> = {
  '/api/category-guesses': () => nano,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function boot(): Promise<void> {
  await mountData('fints-state');
  // A login the user calls off must end the bank request it is waiting on,
  // several awaits after withBankSignal set the signal (mobile/shims/async-hooks.ts).
  type BankScope = { signal?: AbortSignal; bankCall?: boolean; inPolicy?: boolean };
  const bankScope = (globalThis as { __girovoBankScope?: AsyncLocalStorage<BankScope> }).__girovoBankScope;
  if (bankScope) bankScope.keepAcrossAwait = (s) => Boolean(s?.signal) && !s.bankCall && !s.inPolicy;
}

// A start that cannot read the saved files still answers: without them the
// app is a first start (no remembered device, no vault), never a dead one.
export const ready = boot().catch((err) => {
  console.error('[server] start', err);
});

export async function handle(req: Request): Promise<Response> {
  await ready;
  const url = new URL(req.url);
  const route = ROUTES[url.pathname];
  if (!route) return json(404, { error: 'Not found' });
  const method = req.method.toUpperCase() as keyof typeof route;
  const handler = route[method];
  if (!handler) return json(405, { error: 'Method not allowed' });

  // What Next adds to a request, and what the browser would send: the page's
  // language (lib/i18n/server.ts answers in it).
  Object.defineProperty(req, 'nextUrl', { value: url });
  req.headers.set('accept-language', activeLocale());

  try {
    await BEFORE[url.pathname]?.();
    return await handler(req);
  } catch (err) {
    // What wrap() (lib/api.ts) answers; the handlers without it end up here.
    console.error(`[server] ${url.pathname}`, err);
    return json(500, { error: describeError(err) });
  }
}

installFetch(handle);

// What has been written is on disk before Android may end the app in the background.
void App.addListener('pause', () => {
  void flush();
});
