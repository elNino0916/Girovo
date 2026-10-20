'use client';

// Pull to refresh, in the Android app: pulling the page down past its top
// fetches the account's Umsätze and balance again — what the Umsätze tile's
// refresh button does (refreshAccount), so it may ask for an approval as that
// one may. M3E's contained loading indicator comes down from under the top
// bar with the finger, its shape turning and growing until the pull is far
// enough (a haptic tick says so), and morphs from shape to shape while the
// fetch runs.

import { M3eLoadingIndicator } from '@m3e/react/loading-indicator';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { useT } from '@/lib/i18n/react';
import { useFints } from '../FintsProvider';
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

  return (
    <>
      <span className="sr-only" role="status">{refreshing ? t.android.refresh.refreshing : ''}</span>
      {/* Material 3 Expressive's pull to refresh: M3E's contained loading
          indicator, its shape turning with the pull and morphing from shape
          to shape once the refresh runs. */}
      <M3eLoadingIndicator
        aria-hidden
        data-pull-indicator
        variant="contained"
        // A turn and a half over the pull; null once it refreshes, which starts the morph.
        pullProgress={refreshing ? null : progress * 1.5}
        className="pointer-events-none fixed left-1/2 z-30 rounded-full"
        style={{
          top: 'var(--barbar-h)',
          width: 48,
          height: 48,
          '--m3e-loading-indicator-container-size': '48px',
          '--m3e-loading-indicator-active-indicator-size': '38px',
          transform: `translate(-50%, ${y - 56}px) scale(${refreshing ? 1 : 0.6 + 0.4 * progress})`,
          opacity: y > 0 ? 1 : 0,
          transition: pull > 0 ? 'none' : 'transform 0.3s cubic-bezier(0.2, 0, 0, 1), opacity 0.2s',
        } as CSSProperties}
      />
    </>
  );
}
