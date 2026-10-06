// The language of a request, on the server.
//
// An API request answers in the language of the page that sent it: the
// cookie the page writes with every change of language (lib/i18n/react.tsx),
// else the browser's Accept-Language — which in the desktop shell is the
// system's language. lib/api.ts's wrap() runs every route inside its own
// scope, so msgs() (lib/i18n/index.ts) speaks the request's language anywhere
// down the call — in a route, in describeError, in a bank answer — and two
// requests never share one.

import { AsyncLocalStorage } from 'node:async_hooks';
import { DEFAULT_LOCALE, LOCALE_COOKIE, registerScopedLocale, resolveLocale, type Locale } from './locale.ts';

// Pinned to globalThis like lib/bank-fetch.ts's scope: a hot reload must not
// leave a route running in one store while msgs() reads another.
const g = globalThis as typeof globalThis & { __girovoRequestLocale?: AsyncLocalStorage<Locale> };
const scope: AsyncLocalStorage<Locale> = (g.__girovoRequestLocale ??= new AsyncLocalStorage<Locale>());
registerScopedLocale(() => scope.getStore());

/** One cookie's value from a Cookie header, or null. */
export function cookieValue(header: string | null | undefined, name: string): string | null {
  for (const part of String(header ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    if (part.slice(0, at).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(at + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/** The language a request asks for: its cookie, else its Accept-Language. */
export function localeOf(req: unknown): Locale {
  if (!(req instanceof Request)) return DEFAULT_LOCALE;
  return resolveLocale(cookieValue(req.headers.get('cookie'), LOCALE_COOKIE), req.headers.get('accept-language'));
}

/** Runs `fn` speaking `req`'s language. */
export function withRequestLocale<T>(req: unknown, fn: () => T): T {
  return scope.run(localeOf(req), fn);
}

/** Runs `fn` speaking `locale` — for a test, or work started outside a request. */
export function withLocale<T>(locale: Locale, fn: () => T): T {
  return scope.run(locale, fn);
}
