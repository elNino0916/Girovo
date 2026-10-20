'use client';

// How far Gemini Nano is with the bookings the keyword rules left as
// "Sonstiges" (mobile/server/categories.ts) — under Umsätze and on Analyse,
// where its categories show. Android only, and only while there is enough to
// wait for: a few bookings come back before a line could be read.
//
// AICore makes Nano wait now and then (busy, or the app in the background);
// the bar then simply stands. Only a wait long enough to notice is named.

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n/react';
import { IS_ANDROID } from '@/lib/platform';
import { Progress, cx } from '../ui';

/** Fewer bookings than this come back too fast to show a line for. */
const MIN_TOTAL = 3;
/** The line appears only once a batch has run this long. */
const SHOW_AFTER_MS = 700;
/** A wait for AICore is named only once it has lasted this long. */
const NAME_WAIT_AFTER_MS = 5000;

/** Nano's queue as the plugin reports it; null where there is none (the desktop, or no Nano). */
export function useNanoProgress(): GirovoNanoProgress | null {
  const [progress, setProgress] = useState<GirovoNanoProgress | null>(null);
  useEffect(() => {
    const categories = IS_ANDROID ? window.girovoMobile?.categories : undefined;
    if (!categories) return;
    let live = true;
    void categories.progress().then((p) => live && setProgress(p));
    const off = categories.onProgress((p) => live && setProgress(p));
    return () => {
      live = false;
      off();
    };
  }, []);
  return progress;
}

/** True once `on` has held for `ms`; false again the moment it ends. */
function useHeld(on: boolean, ms: number): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!on) {
      setHeld(false);
      return;
    }
    const timer = setTimeout(() => setHeld(true), ms);
    return () => clearTimeout(timer);
  }, [on, ms]);
  return on && held;
}

export function CategoryProgress({ className }: { className?: string }) {
  const t = useT();
  const m = t.android.categories;
  const progress = useNanoProgress();
  const running = Boolean(progress?.active && progress.total >= MIN_TOTAL);
  const shown = useHeld(running, SHOW_AFTER_MS);
  const waitNamed = useHeld(running && progress?.waiting != null, NAME_WAIT_AFTER_MS);
  if (!shown || !progress) return null;

  const count = m.count(progress.done, progress.total);
  return (
    <div className={cx('max-w-sm', className)}>
      <p className="flex items-baseline justify-between gap-3 text-[13px] leading-snug text-ink-3">
        <span className="min-w-0 truncate">{waitNamed ? m.waiting : m.working}</span>
        <span className="tnum shrink-0">{count}</span>
      </p>
      <Progress
        value={(progress.done / progress.total) * 100}
        label={m.working}
        valueText={count}
        className="mt-1.5"
      />
    </div>
  );
}
