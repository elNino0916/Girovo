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
// release's wordmark carries its major version the same way, set bolder and
// filled with a blue gradient ("Girovo 6"). Every place the wordmark stands is
// navy or darker (the bar, the login's field) in either theme, so its colours
// are literal too.
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

/** The release numeral's fill: sky to Girovo's blue to a touch of violet, bright on the navy it stands on. */
const NUMERAL_GRADIENT = 'linear-gradient(155deg, #b8eeff 12%, #4f9dff 52%, #a77bff 92%)';

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
 * major version, bolder, in a blue gradient ("Girovo 6"). Only "Girovo" truncates.
 */
export function BrandName({ className }: { className?: string }) {
  const nightly = useContext(NightlyContext);
  return (
    <span className={cx('inline-flex min-w-0 items-baseline whitespace-nowrap', className)}>
      <span className="truncate">Girovo</span>
      {nightly ? (
        <span className="ml-[0.28em] shrink-0" style={{ color: NIGHTLY_PLATE }}>Nightly</span>
      ) : (
        MAJOR != null && (
          <span
            className="ml-[0.24em] shrink-0 bg-clip-text font-extrabold text-transparent"
            style={{ backgroundImage: NUMERAL_GRADIENT }}
          >
            {MAJOR}
          </span>
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
