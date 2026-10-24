import type { Metadata, Viewport } from 'next';
import { Barlow, Barlow_Condensed, Google_Sans_Flex, IBM_Plex_Mono } from 'next/font/google';
import { cookies, headers } from 'next/headers';
import { markSvg } from '@/lib/brand-mark';
import { DEFAULT_LOCALE, LOCALE_COOKIE, resolveLocale, type Locale } from '@/lib/i18n/locale';
import { MESSAGES } from '@/lib/i18n/messages';
import { LocaleProvider } from '@/lib/i18n/react';
import { IS_ANDROID } from '@/lib/platform';
import './globals.css';
// Girovo's look, Material 3 Expressive, on every platform — after the tokens
// it remaps; its rules are scoped to <html data-look="material">.
import './material.css';
// What only a phone adds to it, scoped to <html data-platform="android">.
import './android.css';

// Self-hosted through next/font: the files are fetched once at build time and
// served from this app's own origin, so no font request ever leaves the
// machine at runtime — which matters for something that also talks to a bank.

// The interface face: Google Sans Flex — open, round-shouldered and calm, so
// a long Verwendungszweck reads like prose rather than like a form. One
// variable file covers every weight the interface uses (400 text, 500–600
// labels and figures, 700 headlines), and the optical-size axis lets the same
// face draw a 44px balance with display proportions and a 12px caption with
// text proportions. latin-ext because bank texts carry names from all over the
// SEPA area.
const googleSansFlex = Google_Sans_Flex({
  subsets: ['latin', 'latin-ext'],
  axes: ['opsz'],
  variable: '--font-ui',
  display: 'swap',
  // next/font has no metrics on file for this face yet, so it cannot build a
  // size-adjusted fallback; name the system faces the CSS stack falls back to
  // instead. The file is served from this app's own origin, so the swap is
  // practically instant anyway.
  adjustFontFallback: false,
  fallback: ['Segoe UI', 'system-ui', 'sans-serif'],
});
// Barlow is only the fallback behind the bank monograms' condensed cut
// (BankLogo); the printed documents moved to the interface face.
const barlow = Barlow({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-barlow',
  display: 'swap',
});
// Only the generated bank monograms (BankLogo) still use the condensed cut.
const barlowCondensed = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-barlow-condensed',
  display: 'swap',
});
// What is read one character at a time: IBAN, BIC, BLZ, references.
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
});

// The G€ on the masthead's navy, inline so the tab icon costs no request.
const FAVICON = `data:image/svg+xml,${encodeURIComponent(markSvg({ plate: '#0a2c5e', ink: '#ffffff' }))}`;

/**
 * The language of this page load: the stored choice (its cookie copy,
 * lib/i18n/react.tsx), else the system's — what the browser, or the desktop
 * shell, sends as Accept-Language. Read per request, so the first frame is
 * already in the language the client will continue in.
 */
async function requestLocale(): Promise<Locale> {
  // The Android page is built ahead of time, with no request to read. It starts
  // in German and LocaleProvider switches to the stored or the phone's
  // language while the splash screen still covers it.
  if (IS_ANDROID) return DEFAULT_LOCALE;
  const [jar, head] = await Promise.all([cookies(), headers()]);
  return resolveLocale(jar.get(LOCALE_COOKIE)?.value, head.get('accept-language'));
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Girovo',
    description: MESSAGES[await requestLocale()].common.appDescription,
    icons: { icon: FAVICON },
  };
}

export const viewport: Viewport = {
  // The masthead is what sits under the browser chrome, so it — not the
  // page — is the colour the OS should tint with. Same values as --bar.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0a2c5e' },
    { media: '(prefers-color-scheme: dark)', color: '#08192b' },
  ],
  // Lets the phone bottom bar sit above the home indicator (safe-area insets).
  viewportFit: 'cover',
};

// Runs before first paint so the app never flashes the wrong theme.
//
// The stored choice is 'light' | 'dark' | 'system'; anything else, or nothing,
// means 'system'. The desktop shell keeps preferences in a file of its own
// (window.electronStore) because a packaged build starts on a fresh origin
// every launch and loses localStorage — so that is read first, and
// localStorage only when there is no shell answer at all. Every access is
// fenced: a throwing storage must cost the user their preference, never the
// page. The resolved theme goes on data-theme (what the CSS reads) and the
// choice itself on data-theme-pref (what the Darstellung control shows);
// lib/theme.ts takes over from here and keeps both current. The Android app
// has no choice of its own: it always follows the phone.
const THEME_SCRIPT = `(function(){var d=document.documentElement,p=${IS_ANDROID ? "'system'" : 'null'},k='fints.theme';if(p==null){try{var s=window.electronStore;if(s&&typeof s.get==='function')p=s.get(k);}catch(e){}}if(p==null){try{p=localStorage.getItem(k);}catch(e){}}if(p!=='light'&&p!=='dark')p='system';var dark=p==='dark';if(p==='system'){try{dark=window.matchMedia('(prefers-color-scheme: dark)').matches;}catch(e){dark=false;}}d.dataset.theme=dark?'dark':'light';d.dataset.themePref=p;try{if(window.electronTitleBar)window.electronTitleBar.setTheme(dark);}catch(e){}})();`;

// The phone's font scale reaches the page as WebView text zoom: every
// computed font size (and line height) is multiplied by it, no px or em
// length is, and text-size-adjust no longer opts out (WebView 149). An icon
// is sized in dp, as Android sizes its icons, so its glyph is set that much
// smaller (app/android.css, --text-zoom) to come out at its size in its box.
// Measured here, before first paint; a new font scale recreates the activity
// and so runs it again.
const TEXT_ZOOM_SCRIPT = `(function(){var d=document.documentElement,p=document.createElement('i');p.style.cssText='position:absolute;visibility:hidden;font-size:100px';d.appendChild(p);var z=parseFloat(getComputedStyle(p).fontSize)/100;p.remove();if(z>0&&z!==1)d.style.setProperty('--text-zoom',String(z));})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await requestLocale();
  return (
    <html lang={locale} data-look="material" data-platform={IS_ANDROID ? 'android' : undefined} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {IS_ANDROID && <script dangerouslySetInnerHTML={{ __html: TEXT_ZOOM_SCRIPT }} />}
        {/* The phone runtime: the route handlers and the Android bridges
            (mobile/runtime.ts). Loaded and run before the app's own scripts,
            so its first fetch('/api/…') already has someone to answer it. */}
        {IS_ANDROID && <script src="/mobile-runtime.js" />}
      </head>
      <body className={`${googleSansFlex.variable} ${barlow.variable} ${barlowCondensed.variable} ${plexMono.variable}`}>
        <LocaleProvider initial={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
