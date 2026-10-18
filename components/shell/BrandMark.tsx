// The app's own mark: the "G€" plate, and the wordmark beside it before the
// login (the login's top bar); at the head of the navigation rail the plate
// alone (BrandPlate). One component, so they never drift apart.
//
// The plate is the app icon's: the G€ (lib/brand-mark.ts) in white on
// Girovo's navy — a logo, so a literal colour, the same in every theme and
// whatever the palette. The wordmark is in the bar's ink.
//
// The version stays legible for support questions, development builds
// included ("3.1.3-dev.123"); `versionClassName` lets a caller hide it first
// when room runs out (it truncates before the wordmark does, and its full
// text stays in the tooltip).

import { MARK_ARC, MARK_ARC_WIDTH, MARK_BARS, MARK_BAR_WIDTH, MARK_GRID } from '@/lib/brand-mark';
import { cx } from '../ui';

/** The plate alone: 32px, smaller only when zoom has shrunk the top bar (--band-plate). */
export function BrandPlate({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cx('grid size-[var(--band-plate)] shrink-0 rounded-[8px] bg-[#0a2c5e] text-white', className)}>
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
      <span className="truncate text-[17px] leading-none font-bold whitespace-nowrap text-bar-ink sm:shrink-0 sm:text-[18px]">
        Girovo
      </span>
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
