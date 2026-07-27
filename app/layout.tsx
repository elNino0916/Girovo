import type { Metadata, Viewport } from 'next';
import { Barlow, Barlow_Condensed, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

// Self-hosted through next/font: no CDN request leaves the machine this app
// runs on, which matters for something that also talks to a bank.
const barlow = Barlow({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-barlow',
  display: 'swap',
});
const barlowCondensed = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-barlow-condensed',
  display: 'swap',
});
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
});

const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='24' fill='%2312457e'/%3E%3Ctext x='50' y='68' font-size='52' font-family='monospace' font-weight='600' fill='white' text-anchor='middle'%3E%E2%82%AC%3C/text%3E%3C/svg%3E";

export const metadata: Metadata = {
  title: 'Sooskasse-FinTS',
  description: 'Direktzugang zu deiner Bank über FinTS 3.0',
  icons: { icon: FAVICON },
};

export const viewport: Viewport = {
  // The identity bar is what sits under the browser chrome, so it — not the
  // page — is the colour the OS should tint with.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#12304f' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0d0f' },
  ],
};

// Runs before first paint so the app never flashes the wrong theme.
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('fints.theme');if(!t)t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='light';}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className={`${barlow.variable} ${barlowCondensed.variable} ${plexMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
