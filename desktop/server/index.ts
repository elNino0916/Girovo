// The desktop server: Girovo's route handlers (app/api/**/route.ts),
// unchanged, running inside the Tauri window's page — the Android app's way
// (mobile/server/index.ts), which this follows step for step. The page's
// fetch('/api/…') is answered here (mobile/server/fetch.ts), the bank is
// reached through the shell (src-tauri/src/http.rs), and the files are the
// ones the Electron shell kept, in the same folder (src-tauri/src/files.rs).
//
// Unlike the phone there is no integrity gate (a PC has no attestation to
// ask) and no Gemini Nano: the e5 model answers the category guesses, as it
// did beside the Electron shell's Node server.

import '../../mobile/server/assets';
import { App } from '@capacitor/app';
import { ROUTES } from 'girovo:routes';
import { describeError } from '../../lib/bank-fetch.ts';
import { activeLocale } from '../../lib/i18n/locale.ts';
import type { AsyncLocalStorage } from '../../mobile/shims/async-hooks';
import { flush, mountData } from '../../mobile/shims/fs';
import { installFetch } from '../../mobile/server/fetch';
import { installFolders } from './folders';
import { mountModel } from './model';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function boot(): Promise<void> {
  installFolders();
  // The model's files beside the saved ones; a model that cannot be mounted only goes unused.
  const model = mountModel().catch((err) => console.error('[server] category model', err));
  await mountData('fints-state');
  await model;
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
  const route = (ROUTES as Record<string, Record<string, (r: Request) => Promise<Response>>>)[url.pathname];
  if (!route) return json(404, { error: 'Not found' });
  const handler = route[req.method.toUpperCase()];
  if (!handler) return json(405, { error: 'Method not allowed' });

  // What Next adds to a request, and what the browser would send: the page's
  // language (lib/i18n/server.ts answers in it).
  Object.defineProperty(req, 'nextUrl', { value: url });
  req.headers.set('accept-language', activeLocale());

  try {
    return await handler(req);
  } catch (err) {
    // What wrap() (lib/api.ts) answers; the handlers without it end up here.
    console.error(`[server] ${url.pathname}`, err);
    return json(500, { error: describeError(err) });
  }
}

installFetch(handle);

// What has been written is on disk before the window hides or the page goes.
void App.addListener('pause', () => {
  void flush();
});
