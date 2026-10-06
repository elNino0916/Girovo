// The interface languages, and which one is speaking right now.
//
// German is the source: every text is written in German first
// (lib/i18n/messages), and English must say the same. What a bank sends —
// its messages, its answers, a Verwendungszweck — is never translated; it is
// shown as the bank wrote it.
//
// The choice is stored in three places that each serve one reader: the
// preference file (`fints.locale`, lib/client-api.ts's store) for the page,
// a cookie for the server that renders the first frame and answers the API
// (lib/i18n/server.ts), and electron/main.cjs reads the preference for the
// shell's own dialogs and the update window. Without a choice, the system's
// language decides: German for German, English for anything else.
//
// Pure and dependency-free, like lib/categories.ts: shared by the browser, the
// server and the `node --test` suite.

export type Locale = 'de' | 'en';

export const LOCALES: readonly Locale[] = ['de', 'en'];
export const DEFAULT_LOCALE: Locale = 'de';

/** The preference key (lib/client-api.ts's store, electron/main.cjs's prefs file). */
export const LOCALE_PREF = 'fints.locale';
/** The cookie the server reads the choice from. */
export const LOCALE_COOKIE = 'girovo-locale';

/** Each language named in itself, so a reader stuck in the other one still finds theirs. */
export const LOCALE_NAMES: Record<Locale, string> = { de: 'Deutsch', en: 'English' };

export const isLocale = (v: unknown): v is Locale => v === 'de' || v === 'en';

/**
 * The language for an Accept-Language header or a system locale ("de-AT",
 * "en-US,en;q=0.9"): German when German comes first, English for anything
 * else — a French or Turkish system reads English more readily than German.
 * Nothing at all means German.
 */
export function pickLocale(acceptLanguage: string | null | undefined): Locale {
  const first = String(acceptLanguage ?? '').split(',')[0]?.trim().toLowerCase() ?? '';
  if (!first || first === '*') return DEFAULT_LOCALE;
  return first === 'de' || first.startsWith('de-') ? 'de' : 'en';
}

/** The stored choice, else the system's language. */
export function resolveLocale(stored: string | null | undefined, acceptLanguage: string | null | undefined): Locale {
  return isLocale(stored) ? stored : pickLocale(acceptLanguage);
}

/**
 * The Intl locale behind each language: German conventions in German
 * ("1.234,56 €", "05.10.2026"), British ones in English ("€1,234.56",
 * "05/10/2026") — the English of a euro country's neighbour, day before month.
 */
export const INTL_LOCALES: Record<Locale, string> = { de: 'de-DE', en: 'en-GB' };

// ---------------------------------------------------------------------------
// The language speaking right now
//
// In the page, LocaleProvider (lib/i18n/react.tsx) sets it while it renders,
// so every helper its children call — a formatter, a label table — reads the
// same language they render in. On the server, an API request runs inside
// its own scope (lib/i18n/server.ts registers it), so concurrent requests
// never share one. Anywhere else — a test, a script — it is German.
//
// Pinned to globalThis like the other process state: a hot reload must not
// leave one copy of this module speaking German while another speaks English.
// ---------------------------------------------------------------------------

type Speaker = { active: Locale; scoped: (() => Locale | undefined) | null };
const g = globalThis as typeof globalThis & { __girovoLocale?: Speaker };
const speaker: Speaker = (g.__girovoLocale ??= { active: DEFAULT_LOCALE, scoped: null });

/** LocaleProvider's: the language the page renders in from now on. */
export function setActiveLocale(locale: Locale): void {
  speaker.active = locale;
}

/** lib/i18n/server.ts's: where a request's own language can be found. */
export function registerScopedLocale(get: () => Locale | undefined): void {
  speaker.scoped = get;
}

/** The language speaking right now: a request's own, else the page's. */
export function activeLocale(): Locale {
  return speaker.scoped?.() ?? speaker.active;
}

/** The Intl locale of the language speaking right now. */
export function intlLocale(): string {
  return INTL_LOCALES[activeLocale()];
}
