'use client';

// Girovo without a bank (6.0): the design preview's stand-in for
// <FintsProvider> (app/design-preview/mock.tsx) behind the real app. Its bank,
// accounts and Umsätze are made up, approvals and transfers are simulated, and
// nothing of a login persists — privacy mode and the idle limit stay in
// memory, the vault and the kept Umsätze never touch the real ones, and the
// login form keeps its hands off the real login's name, fingerprint and
// Windows Hello (components/auth/Credentials.tsx). The app's own settings —
// theme, language, update channel — are the app's: changed here, they stay.
// Loaded only when the demo starts (app/page.tsx), so the real app never
// carries it.
//
// The demo ends where a session would: "Abmelden", the idle limit, or the
// banner's "Demo beenden". Its login screen is never shown — that would be a
// login to a bank that does not exist.

import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { useT } from '@/lib/i18n/react';
import { MockFintsProvider } from '@/app/design-preview/mock';
import { useFints } from '../FintsProvider';
import { Button } from '../ui';
import { endDemo } from './demo-mode';

export default function DemoProvider({ children }: { children: ReactNode }) {
  return (
    // A second bank beside the first, the vault's budgets, notes and kept
    // balances: the overview as someone with a few accounts sees it. Never the
    // screenshot helper's still frames, which the mock turns on under Electron.
    <MockFintsProvider preset="default" still={false} secondBank="linked" budgets personal kept>
      <DemoWatch />
      {children}
      <DemoBanner />
    </MockFintsProvider>
  );
}

/** Back to the real login once the demo's session ends, however it ends. */
function DemoWatch() {
  const { view } = useFints();
  useEffect(() => {
    if (view !== 'dashboard') endDemo();
  }, [view]);
  return null;
}

/**
 * Says, on every screen of the demo, that nothing here is real — and the way
 * out. Above the phone's navigation bar; on wider screens at the bottom,
 * centred, clear of the navigation rail and of the toasts' column.
 */
function DemoBanner() {
  const t = useT();
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--bottombar-h)+12px)] z-40 flex justify-center px-4 print:hidden sm:bottom-6"
      style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
    >
      <div
        role="status"
        className="pointer-events-auto flex max-w-full items-center gap-1 rounded-full bg-raised py-1 pr-1 pl-4 text-ink"
        style={{ boxShadow: 'var(--shadow-pop)' }}
      >
        <span className="min-w-0 truncate text-[13.5px] leading-snug text-ink-2">{t.auth.demo.banner}</span>
        <Button variant="tertiary" size="sm" onClick={endDemo} className="shrink-0">
          <span className="sm:hidden" aria-hidden>{t.auth.demo.endShort}</span>
          <span className="max-sm:sr-only">{t.auth.demo.end}</span>
        </Button>
      </div>
    </div>
  );
}
