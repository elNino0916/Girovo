'use client';

// Small clocks and words the shell needs in several places: the greeting, the
// "Angemeldet seit" line, and the auto-logout countdown. Kept apart from the
// components so the profile menu, the warning dialog and the footer all say
// the same thing the same way.

import { useEffect, useState } from 'react';
import { fmtDate } from '@/lib/format';
import { msgs } from '@/lib/i18n';

export { firstName, holderName, nameInitials, sessionHolder } from '@/lib/holder-name';

/**
 * Milliseconds left until `deadline`, ticking once a second while `enabled`.
 *
 * The provider publishes the deadline only every ~10 s while it is far away
 * (it is state, and state re-renders the whole app), so the seconds are
 * counted here. Each tick is scheduled for just after the next whole-second
 * boundary of the deadline, so the display never skips or repeats a second.
 * Null while disabled, before mount, or without a deadline.
 */
export function useCountdown(deadline: number | null, enabled = true): number | null {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!enabled || deadline == null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const n = Date.now();
      setNow(n);
      const left = deadline - n;
      timer = setTimeout(tick, left > 0 ? (left % 1000 || 1000) + 15 : 1000);
    };
    tick();
    return () => clearTimeout(timer);
  }, [deadline, enabled]);
  if (!enabled || deadline == null || now === 0) return null;
  return Math.max(0, deadline - now);
}

/** "9:41" — minutes and seconds, rounded up so "0:00" only shows at the very end. */
export function fmtCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** "Noch 42 Sekunden" / "Noch 2 Minuten" — the countdown as a screen reader should hear it. */
export function countdownWords(ms: number): string {
  return msgs().shell.countdown(Math.max(0, Math.ceil(ms / 1000)));
}

/** The hour of day, said the way a counter clerk would say it. */
export function greeting(at: number | null): string {
  return msgs().shell.greeting(new Date(at ?? Date.now()).getHours());
}

/** "14:32 Uhr", with the date in front once the session began on another day. */
export function fmtSince(at: number | null, now: number | null = null): string {
  if (at == null) return '—';
  const d = new Date(at);
  const time = msgs().shell.clock(`${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`);
  const today = new Date(now ?? Date.now());
  return d.toDateString() === today.toDateString() ? time : `${fmtDate(d)}, ${time}`;
}
