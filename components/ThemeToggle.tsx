'use client';

import { useEffect, useState } from 'react';
import { store } from '@/lib/client-api';
import { IconButton } from './ui';

/** Paper or ink. The choice is written before first paint in layout.tsx. */
export function ThemeToggle({ tone = 'page' }: { tone?: 'page' | 'bar' }) {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    setTheme((document.documentElement.dataset.theme as 'light' | 'dark') || 'light');
  }, []);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store.set('fints.theme', next);
    setTheme(next);
  };

  return (
    <IconButton tone={tone} onClick={toggle} title="Design wechseln" aria-label="Design wechseln">
      {theme === 'dark' ? (
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
          <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden>
          <circle cx="12" cy="12" r="4.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5 5l1.8 1.8M17.2 17.2L19 19M19 5l-1.8 1.8M6.8 17.2L5 19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      )}
    </IconButton>
  );
}
