'use client';

// Small clocks and words the shell needs in several places: the greeting, the
// "Angemeldet seit" line, and the auto-logout countdown. Kept apart from the
// components so the profile menu, the warning dialog and the footer all say
// the same thing the same way.

import { useEffect, useState } from 'react';
import { fmtDate, properName } from '@/lib/format';

/**
 * The current time, re-read every `intervalMs` (or only once with null).
 *
 * Null until mounted: a clock rendered on the server would report another
 * moment than the one the browser hydrates at, and the dashboard is never
 * worth a hydration mismatch.
 */
export function useNow(intervalMs: number | null): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    if (intervalMs == null) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

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
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s >= 120) return `${Math.ceil(s / 60)} Minuten`;
  if (s > 60) return `${Math.floor(s / 60)} Minute und ${s % 60} Sekunden`;
  if (s === 60) return '1 Minute';
  return s === 1 ? '1 Sekunde' : `${s} Sekunden`;
}

/** The hour of day, said the way a counter clerk would say it. */
export function greeting(at: number | null): string {
  const h = new Date(at ?? Date.now()).getHours();
  if (h < 5) return 'Guten Abend';
  if (h < 11) return 'Guten Morgen';
  if (h < 18) return 'Guten Tag';
  return 'Guten Abend';
}

// Forms of address a bank puts in front of a holder's name. They are not
// what anyone calls you.
const TITLES = new Set(['herr', 'herrn', 'frau', 'dr', 'dr.', 'prof', 'prof.', 'dipl.-ing.', 'mr', 'mrs', 'ms']);

/**
 * The account holder as the bank stores them, made presentable: "NINO
 * BORNEMANN" → "Nino Bornemann", "BORNEMANN, NINO" → "Nino Bornemann".
 */
export function holderName(raw: string | null | undefined): string {
  const s = properName(String(raw ?? '').replace(/\s+/g, ' ').trim());
  const comma = /^([^,]+),\s*(.+)$/.exec(s);
  return comma ? `${comma[2]} ${comma[1]}` : s;
}

/**
 * The name to greet someone by — the first word that is not a title. Empty
 * for something that does not look like a person (a company account, a
 * joint account "Max und Erika Mustermann" still greets Max, which is who is
 * logged in more often than not, but "Mustermann GmbH" greets nobody).
 */
export function firstName(raw: string | null | undefined): string {
  const name = holderName(raw);
  if (!name || /\b(gmbh|ag|kg|ohg|gbr|e\.?\s?v\.?|ug|mbh|se|eg|stiftung|verein)\b/i.test(name)) return '';
  const word = name.split(' ').find((w) => !TITLES.has(w.toLowerCase()));
  return word && /\p{L}/u.test(word) ? word : '';
}

/** Two letters for the profile chip: first and last name, or the first two of one word. */
export function nameInitials(raw: string | null | undefined): string {
  const words = holderName(raw).split(' ').filter((w) => /\p{L}/u.test(w) && !TITLES.has(w.toLowerCase()));
  if (!words.length) return '';
  const letter = (w: string) => w.match(/\p{L}/u)?.[0] ?? '';
  if (words.length === 1) return words[0].replace(/[^\p{L}]/gu, '').slice(0, 2).toUpperCase();
  return (letter(words[0]) + letter(words[words.length - 1])).toUpperCase();
}

/** "14:32 Uhr", with the date in front once the session began on another day. */
export function fmtSince(at: number | null, now: number | null = null): string {
  if (at == null) return '—';
  const d = new Date(at);
  const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')} Uhr`;
  const today = new Date(now ?? Date.now());
  return d.toDateString() === today.toDateString() ? time : `${fmtDate(d)}, ${time}`;
}
