'use client';

// Pull to refresh, in the Android app: pulling the page down past its top
// fetches the account's Umsätze and balance again — what the Umsätze tile's
// refresh button does (refreshAccount), so it may ask for an approval as that
// one may. Material's indicator comes down from under the top bar with the
// finger, its arc filling until the pull is far enough (a haptic tick says
// so), and turns into the loading indicator while the fetch runs.

import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useT } from '@/lib/i18n/react';
import { useFints } from '../FintsProvider';
import { RefreshIcon } from '../icons';
import { Spinner } from '../ui';
import { haptic } from './haptics';

/** How far (after damping) a pull must go to refresh, and how far it can. */
const TRIGGER = 72;
const MAX = 112;
/** The finger moves twice as far as the indicator. */
const DAMPING = 0.5;
/** Where the indicator rests while the fetch runs. */
const REST = 64;

export function PullToRefresh({ scrollRef }: { scrollRef: RefObject<HTMLElement | null> }) {
  const { activeAccount, refreshAccount, busy } = useFints();
  const t = useT();
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // The latest of what the touch handlers need, without re-binding them.
  const can = !!activeAccount?.canStatements && !busy;
  const live = useRef({ can, refresh: () => {} });
  live.current = {
    can,
    refresh: () => {
      if (!activeAccount) return;
      setRefreshing(true);
      refreshAccount(activeAccount);
    },
  };

  // The indicator stays until the fetch it started has run.
  const sawBusy = useRef(false);
  useEffect(() => {
    if (!refreshing) return;
    if (busy) {
      sawBusy.current = true;
      return;
    }
    if (sawBusy.current) {
      sawBusy.current = false;
      setRefreshing(false);
      return;
    }
    // Nothing started (already up to date in flight elsewhere): let it go.
    const timer = setTimeout(() => setRefreshing(false), 1200);
    return () => clearTimeout(timer);
  }, [refreshing, busy]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    let startY = 0;
    let active = false;
    let armed = false;
    let distance = 0;

    const onStart = (e: TouchEvent) => {
      active = live.current.can && root.scrollTop <= 0 && e.touches.length === 1;
      startY = e.touches[0]?.clientY ?? 0;
      armed = false;
      distance = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!active) return;
      const dy = (e.touches[0]?.clientY ?? 0) - startY;
      if (dy <= 0 || root.scrollTop > 0) {
        if (distance) setPull((distance = 0));
        return;
      }
      // The page itself must not stretch under the indicator.
      if (e.cancelable) e.preventDefault();
      distance = Math.min(MAX, dy * DAMPING);
      setPull(distance);
      const now = distance >= TRIGGER;
      if (now && !armed) haptic('threshold');
      armed = now;
    };
    const onEnd = () => {
      if (!active) return;
      active = false;
      if (armed) live.current.refresh();
      armed = false;
      setPull((distance = 0));
    };

    root.addEventListener('touchstart', onStart, { passive: true });
    root.addEventListener('touchmove', onMove, { passive: false });
    root.addEventListener('touchend', onEnd);
    root.addEventListener('touchcancel', onEnd);
    return () => {
      root.removeEventListener('touchstart', onStart);
      root.removeEventListener('touchmove', onMove);
      root.removeEventListener('touchend', onEnd);
      root.removeEventListener('touchcancel', onEnd);
    };
  }, [scrollRef]);

  const y = refreshing ? REST : pull;
  const progress = Math.min(1, pull / TRIGGER);
  const circumference = 2 * Math.PI * 8;

  return (
    <>
      <span className="sr-only" role="status">{refreshing ? t.android.refresh.refreshing : ''}</span>
      <div
        aria-hidden
        data-pull-indicator
        className="pointer-events-none fixed left-1/2 z-30 grid size-10 place-items-center rounded-full bg-raised text-accent"
        style={{
          top: 'var(--barbar-h)',
          transform: `translate(-50%, ${y - 48}px)`,
          opacity: y > 0 ? 1 : 0,
          transition: pull > 0 ? 'none' : 'transform 0.3s cubic-bezier(0.2, 0, 0, 1), opacity 0.2s',
        }}
      >
        {refreshing ? (
          <Spinner size={22} />
        ) : (
          <span className="relative grid size-6 place-items-center">
            {/* The arc fills as the pull goes; the glyph turns with it. */}
            <svg viewBox="0 0 20 20" className="absolute inset-0 size-6 -rotate-90">
              <circle
                cx="10"
                cy="10"
                r="8"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray={`${progress * circumference} ${circumference}`}
                opacity={progress >= 1 ? 1 : 0.7}
              />
            </svg>
            <RefreshIcon size={12} style={{ transform: `rotate(${progress * 270}deg)` }} />
          </span>
        )}
      </div>
    </>
  );
}
