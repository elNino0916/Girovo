'use client';

// The intro: the G€ draws itself and Girovo settles in, once — on the very
// first start (a fresh install, or after "Girovo zurücksetzen") and on the
// first start of Girovo 6 on a device that knew a bank before ("Girovo 6",
// ahead of the "Neu in Girovo 6" sheet after the login).
//
// On the login screen's own stage, so it fades straight into it. Never while
// the desktop window is still hidden behind the start window, never when the
// system asks for less motion; a click or a key ends it early. While it plays
// the login screen holds back its Windows Hello prompt (useIntroPlaying).

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { MARK_ARC, MARK_ARC_WIDTH, MARK_BARS, MARK_BAR_WIDTH, MARK_GRID, MARK_PLATE_RADIUS } from '@/lib/brand-mark';
import { store } from '@/lib/client-api';
import { cx } from '../ui';

/** The preference that says which intro was shown last; a later major version may bump it. */
const SEEN_KEY = 'fints.intro';
const SEEN = '6';
/** The whole of it, fade-out included (globals.css .intro-*). */
const LENGTH_MS = 2400;
/** A skip's fade. */
const SKIP_MS = 180;

export type IntroKind = 'welcome' | 'six';
type Kind = IntroKind;

// Whether it is playing, for the login screen's Windows Hello prompt.
let playing = false;
const listeners = new Set<() => void>();
const setPlaying = (on: boolean) => {
  playing = on;
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** True while the intro covers the app. */
export function useIntroPlaying(): boolean {
  return useSyncExternalStore(subscribe, () => playing, () => false);
}

/** Which intro this start owes, if any — decided once, on the client. */
function due(): Kind | null {
  if (store.get(SEEN_KEY) === SEEN) return null;
  let last: { blz?: string } | null = null;
  try { last = JSON.parse(store.get('fints.lastBank') ?? 'null'); } catch { /* stale value */ }
  return last?.blz ? 'six' : 'welcome';
}

/** On screen: the desktop shell has shown the window (src-tauri/src/shell.rs), and the page is visible. */
const onScreen = () => document.visibilityState === 'visible' && (window.electronWindow?.shown?.() ?? true);

/**
 * `preview` (app/design-preview): this intro, playing from the first frame —
 * or, with `at`, held still that many milliseconds in.
 */
export function Intro({ preview }: { preview?: { kind: Kind; at?: number } } = {}) {
  const [kind, setKind] = useState<Kind | null>(preview?.kind ?? null);
  const [phase, setPhase] = useState<'waiting' | 'playing' | 'skipping'>(preview ? 'playing' : 'waiting');
  const root = useRef<HTMLDivElement>(null);

  // Decided after the first render: the store is the client's.
  useEffect(() => {
    if (preview) return;
    const owed = due();
    if (!owed) return;
    store.set(SEEN_KEY, SEEN);
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    setKind(owed);
    setPlaying(true);
  }, []);

  // Starts once the window is on screen.
  useEffect(() => {
    if (!kind || phase !== 'waiting') return;
    const start = () => {
      if (onScreen()) setPhase('playing');
    };
    start();
    window.addEventListener('girovo:window-shown', start);
    document.addEventListener('visibilitychange', start);
    return () => {
      window.removeEventListener('girovo:window-shown', start);
      document.removeEventListener('visibilitychange', start);
    };
  }, [kind, phase]);

  // The design preview's still frame.
  const at = preview?.at;
  useEffect(() => {
    if (at == null || !root.current) return;
    for (const a of root.current.getAnimations({ subtree: true })) {
      a.pause();
      a.currentTime = at;
    }
  }, [at]);

  // Ends on its own, or early on a click or a key.
  useEffect(() => {
    if (phase === 'waiting' || at != null) return;
    const done = setTimeout(() => {
      setKind(null);
      setPlaying(false);
    }, phase === 'skipping' ? SKIP_MS : LENGTH_MS);
    if (phase === 'skipping') return () => clearTimeout(done);
    const skip = () => setPhase('skipping');
    window.addEventListener('keydown', skip, { once: true });
    return () => {
      clearTimeout(done);
      window.removeEventListener('keydown', skip);
    };
  }, [phase, at]);

  if (!kind) return null;
  return (
    <div
      ref={root}
      aria-hidden
      onPointerDown={() => phase === 'playing' && setPhase('skipping')}
      className={cx(
        'intro fixed inset-0 z-[200] grid place-items-center bg-stage text-stage-ink',
        phase === 'playing' && 'intro-run',
        phase === 'skipping' && 'intro-skip',
      )}
    >
      <div className="intro-lockup flex flex-col items-center gap-5">
        <svg
          viewBox={`0 0 ${MARK_GRID} ${MARK_GRID}`}
          // The login's plate (AuthShell): by night a fine ring sets it off the stage.
          className="intro-plate size-[88px] rounded-[21.875%] sm:size-24 dark:shadow-[0_0_0_1.5px_color-mix(in_srgb,var(--stage-ink)_45%,transparent)]"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect width={MARK_GRID} height={MARK_GRID} rx={MARK_PLATE_RADIUS} fill="#0a2c5e" />
          <path className="intro-arc" d={MARK_ARC} stroke="#fff" strokeWidth={MARK_ARC_WIDTH} pathLength={1} />
          <path className="intro-bars" d={MARK_BARS} stroke="#fff" strokeWidth={MARK_BAR_WIDTH} pathLength={1} />
        </svg>
        <p className="intro-word text-[30px] leading-9 font-medium tracking-[-0.01em]">
          Girovo{kind === 'six' && <span className="text-accent">{' '}6</span>}
        </p>
      </div>
    </div>
  );
}
