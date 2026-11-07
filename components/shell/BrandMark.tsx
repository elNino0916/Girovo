'use client';

// The app's own mark: the "G€" plate, and the wordmark beside it before the
// login (the login's top bar); at the head of the navigation rail the plate
// alone (BrandPlate). One component, so they never drift apart.
//
// The plate is the app icon's: the G€ (lib/brand-mark.ts) in white on
// Girovo's navy — a logo, so a literal colour, the same in every theme and
// whatever the palette. The wordmark is in the bar's ink.
//
// A Girovo Nightly (lib/edition.ts) shows it: the plate is amber with the G€
// in navy, as on its app icon, and the wordmark reads "Girovo Nightly". A
// release's wordmark carries its major version in a six-lobed cookie
// ("Girovo 6"). Every place the wordmark stands is navy or darker (the bar,
// the login's field) in either theme, so its colours are literal too.
//
// The version stays legible for support questions, development builds
// included ("3.1.3-dev.123"); `versionClassName` lets a caller hide it first
// when room runs out (it truncates before the wordmark does, and its full
// text stays in the tooltip).

import { createContext, useContext } from 'react';
import { MARK_ARC, MARK_ARC_WIDTH, MARK_BARS, MARK_BAR_WIDTH, MARK_GRID } from '@/lib/brand-mark';
import { MAJOR, NIGHTLY, NIGHTLY_INK, NIGHTLY_PLATE } from '@/lib/edition';
import { cx } from '../ui';

/** Whether the marks below draw Girovo Nightly: this build's edition, or the design preview's pick. */
export const NightlyContext = createContext(NIGHTLY);

/** The numeral's cookie: six round lobes (Material 3 Expressive's "6-sided cookie"), on a 100 grid. */
const COOKIE = (() => {
  const lobes = 6, depth = 5, steps = 144;
  const points: string[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * 2 * Math.PI - Math.PI / 2;
    const r = 50 - depth + depth * Math.cos(lobes * a);
    points.push(`${(50 + r * Math.cos(a)).toFixed(2)} ${(50 + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${points.join('L')}Z`;
})();

/**
 * The plate alone: 32px, smaller only when zoom has shrunk the top bar
 * (--band-plate). `tone="plus"` is Girovo Plus's: the G€ in gold, as on the
 * gold app icon (scripts/build-android-assets.mjs). `size` (px) draws it at
 * that size anywhere else, its corners in the icon's proportion.
 */
export function BrandPlate({ className, tone = 'standard', size }: { className?: string; tone?: 'standard' | 'plus'; size?: number }) {
  // Girovo Plus keeps its gold G€ on navy even on a nightly: it is that icon's.
  const nightly = useContext(NightlyContext) && tone !== 'plus';
  return (
    <span
      aria-hidden
      style={{
        ...(size ? { width: size, height: size, borderRadius: Math.round(size / 4) } : null),
        ...(nightly ? { backgroundColor: NIGHTLY_PLATE, color: NIGHTLY_INK } : null),
      }}
      className={cx(
        'grid shrink-0 bg-[#0a2c5e]',
        !size && 'size-[var(--band-plate)] rounded-[8px]',
        tone === 'plus' ? 'text-[#f2c14e]' : 'text-white',
        className,
      )}
    >
      <svg
        viewBox={`0 0 ${MARK_GRID} ${MARK_GRID}`}
        className="size-full"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={MARK_ARC} strokeWidth={MARK_ARC_WIDTH} />
        <path d={MARK_BARS} strokeWidth={MARK_BAR_WIDTH} />
      </svg>
    </span>
  );
}

/**
 * The wordmark, in the caller's size and weight: "Girovo Nightly" on a
 * nightly, its second word in the plate's amber; on a release "Girovo" and its
 * major version in a light-blue cookie. Only "Girovo" truncates.
 */
export function BrandName({ className }: { className?: string }) {
  const nightly = useContext(NightlyContext);
  return (
    <span className={cx('inline-flex min-w-0 items-center whitespace-nowrap', className)}>
      <span className="truncate">Girovo</span>
      {nightly ? (
        <span className="ml-[0.28em] shrink-0" style={{ color: NIGHTLY_PLATE }}>Nightly</span>
      ) : (
        MAJOR != null && (
          <>
            <span aria-hidden className="relative ml-[0.3em] grid size-[1.36em] shrink-0 place-items-center">
              <svg viewBox="0 0 100 100" className="absolute inset-0 size-full">
                <path d={COOKIE} fill="#9fcbff" />
              </svg>
              <span className="tnum relative text-[0.74em] leading-none font-bold text-[#0a2c5e]">{MAJOR}</span>
            </span>
            <span className="sr-only"> {MAJOR}</span>
          </>
        )
      )}
    </span>
  );
}

export function BrandMark({
  version, versionClassName, className,
}: {
  version?: string;
  /** Visibility of the version, e.g. "hidden sm:inline" — it is inline by default. */
  versionClassName?: string;
  className?: string;
}) {
  return (
    <span className={cx('flex min-w-0 items-center gap-2.5', className)}>
      <BrandPlate />
      <BrandName className="text-[17px] leading-none font-bold text-bar-ink sm:shrink-0 sm:text-[18px]" />
      {version && (
        <span
          title={`Version ${version}`}
          className={cx(
            'tnum min-w-0 translate-y-[2px] truncate text-[12.5px] leading-none whitespace-nowrap text-bar-ink-2',
            versionClassName ?? 'inline',
          )}
        >
          {version}
        </span>
      )}
    </span>
  );
}
