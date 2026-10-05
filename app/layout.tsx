import type { Metadata, Viewport } from 'next';
import { Barlow, Barlow_Condensed, Google_Sans_Flex, IBM_Plex_Mono } from 'next/font/google';
import { markSvg } from '@/lib/brand-mark';
import './globals.css';

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

export const metadata: Metadata = {
  title: 'Girovo',
  description: 'Direktzugang zu deiner Bank über FinTS 3.0',
  icons: { icon: FAVICON },
};

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
// lib/theme.ts takes over from here and keeps both current.
const THEME_SCRIPT = `(function(){var d=document.documentElement,p=null,k='fints.theme';try{var s=window.electronStore;if(s&&typeof s.get==='function')p=s.get(k);}catch(e){}if(p==null){try{p=localStorage.getItem(k);}catch(e){}}if(p!=='light'&&p!=='dark')p='system';var dark=p==='dark';if(p==='system'){try{dark=window.matchMedia('(prefers-color-scheme: dark)').matches;}catch(e){dark=false;}}d.dataset.theme=dark?'dark':'light';d.dataset.themePref=p;try{if(window.electronTitleBar)window.electronTitleBar.setTheme(dark);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className={`${googleSansFlex.variable} ${barlow.variable} ${barlowCondensed.variable} ${plexMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
