'use client';

// The page's language, for components.
//
//   const t = useT();
//   <h2>{t.transfer.title}</h2>
//
// LocaleProvider sits in app/layout.tsx around everything. It starts in the
// language the server rendered the first frame in (the cookie, else the
// system's language — lib/i18n/server.ts), so the first client render matches
// the server's. A change re-renders every component that reads useT(): no
// reload, and the session, an open form and the scroll position stay as they
// are.

import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { store } from '../client-api';
import { MESSAGES, type Messages } from './messages/index.ts';
import { LOCALE_COOKIE, LOCALE_PREF, activeLocale, isLocale, setActiveLocale, type Locale } from './locale.ts';

type LocaleState = { locale: Locale; setLocale: (next: Locale) => void };

const LocaleContext = createContext<LocaleState | null>(null);

/** Ten years: the cookie is a copy of a preference, not a session. */
const COOKIE_MAX_AGE = 10 * 365 * 24 * 60 * 60;

/** The copy the server reads: the first frame of the next start, and every API answer. */
function writeCookie(locale: Locale): void {
  try {
    document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Strict`;
  } catch {
    /* a refused cookie costs the next start its first frame's language, nothing more */
  }
}

export function LocaleProvider({ initial, children }: { initial: Locale; children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initial);
  // While this renders — before any child does — so every helper the children
  // call (a formatter, a label table) speaks the language they render in.
  setActiveLocale(locale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // The preference is the choice; the cookie only a copy of it. When the copy
  // was missing (cleared, or a browser that never had it), the server rendered
  // the system's language — the stored choice takes over now and the copy is
  // written again.
  useEffect(() => {
    const stored = store.get(LOCALE_PREF);
    if (!isLocale(stored)) return;
    writeCookie(stored);
    if (stored !== initial) setLocaleState(stored);
  }, [initial]);

  const setLocale = useCallback((next: Locale) => {
    store.set(LOCALE_PREF, next);
    writeCookie(next);
    setLocaleState(next);
  }, []);

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** The page's language and the way to change it. */
export function useLocale(): LocaleState {
  const ctx = useContext(LocaleContext);
  // Outside the provider (a test harness), the language speaking right now, unchangeable.
  return ctx ?? { locale: activeLocale(), setLocale: () => {} };
}

/** The texts in the page's language. A component that reads them renders again when it changes. */
export function useT(): Messages {
  return MESSAGES[useLocale().locale];
}

/**
 * A text with markup in it — a message that returns its pieces, words and
 * elements in the language's own order — rendered without React asking for
 * keys:
 *
 *   {rich(t.shell.closeHint((key) => <Kbd>{key}</Kbd>))}
 *
 * Each piece gets a keyed Fragment by its place. (Children.toArray keys them
 * too, but React 19 still warns about an element that sat in the array
 * unkeyed; a Fragment adds nothing to the HTML.)
 */
export function rich(parts: ReactNode[]): ReactNode {
  return parts.map((part, i) => <Fragment key={i}>{part}</Fragment>);
}
