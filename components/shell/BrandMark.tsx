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
// in navy, as on its app icon, and the wordmark reads "Girovo Nightly", its
// second word filled with amber running into orange. A Girovo Next does the
// same in violet: a violet plate with the G€ in white, "Girovo Next" with its
// second word in violet. A release's wordmark carries its number the same
// way, set larger, bolder and filled with a blue gradient ("Girovo 6.1"). The
// bar and the login's field follow the theme, so the gradients do too
// (--brand-nightly, --brand-next, --brand-numeral in app/globals.css): deep
// by day, bright by night.
//
// The version stays legible for support questions, development builds
// included ("3.1.3-dev.123"); `versionClassName` lets a caller hide it first
// when room runs out (it truncates before the wordmark does, and its full
// text stays in the tooltip).

import { createContext, useContext } from 'react';
import { MARK_ARC, MARK_ARC_WIDTH, MARK_BARS, MARK_BAR_WIDTH, MARK_GRID } from '@/lib/brand-mark';
import { EDITION, NUMERAL, plateOf, type Edition } from '@/lib/edition';
import { cx } from '../ui';

/** The edition the marks below draw: this build's, or the design preview's pick. */
export const EditionContext = createContext<Edition>(EDITION);

/** The second word of a pre-release's wordmark and the gradient that fills it. */
const EDITION_WORD: Partial<Record<Edition, { word: string; fill: string }>> = {
  nightly: { word: 'Nightly', fill: 'var(--brand-nightly)' },
  next: { word: 'Next', fill: 'var(--brand-next)' },
};

/**
 * The plate alone: 32px, smaller only when zoom has shrunk the top bar
 * (--band-plate). `tone="plus"` is Girovo Plus's: the G€ in gold, as on the
 * gold app icon (scripts/build-android-assets.mjs). `size` (px) draws it at
 * that size anywhere else, its corners in the icon's proportion.
 */
export function BrandPlate({ className, tone = 'standard', size }: { className?: string; tone?: 'standard' | 'plus'; size?: number }) {
  // Girovo Plus keeps its gold G€ on navy even on a nightly or Next: it is that icon's.
  const edition = useContext(EditionContext);
  const plate = tone === 'plus' ? null : plateOf(edition);
  return (
    <span
      aria-hidden
      style={{
        ...(size ? { width: size, height: size, borderRadius: Math.round(size / 4) } : null),
        ...(plate ? { backgroundColor: plate.plate, color: plate.ink } : null),
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
 * nightly, its second word in an amber-to-orange gradient; "Girovo Next" on
 * Next, its second word in violet; on a release "Girovo" and its number, a
 * third larger, centred on the word and bolder, in a blue gradient ("Girovo 6.1").
 * Only "Girovo" truncates.
 */
export function BrandName({ className }: { className?: string }) {
  const second = EDITION_WORD[useContext(EditionContext)];
  return (
    <span className={cx('inline-flex min-w-0 items-baseline whitespace-nowrap', className)}>
      <span className="truncate">Girovo</span>
      {second ? (
        // Filled like a release's numeral: the plate's colour as a gradient, per theme (--brand-nightly, --brand-next).
        <span
          className="ml-[0.28em] shrink-0 bg-clip-text text-transparent"
          style={{ backgroundImage: second.fill }}
        >
          {second.word}
        </span>
      ) : (
        NUMERAL != null && (
          // A third larger than "Girovo", its middle on the middle of the capital G: it stands out
          // as far above the G as below the baseline. Google Sans Flex's G is 0.73 em tall, the
          // extra-bold 6 0.76 of its own (1.3×) em, so it sits 0.087 of its own size lower.
          <span
            className="ml-[0.2em] shrink-0 translate-y-[0.087em] bg-clip-text text-[1.3em] leading-none font-extrabold text-transparent"
            style={{ backgroundImage: 'var(--brand-numeral)' }}
          >
            {NUMERAL}
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
