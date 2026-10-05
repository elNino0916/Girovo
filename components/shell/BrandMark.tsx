// The app's own mark: the "G€" plate and the wordmark, in the masthead, the
// navy footer and the screens before the login. One component, so the three
// never drift apart — the same plate, the same weight, the same one colour.
//
// Drawn for navy (--bar): a light plate with the G€ (lib/brand-mark.ts) cut
// out in the bar's own navy, which reads as a stamp in both themes, and the
// wordmark in bar-ink.
//
// The version stays legible for support questions, development builds
// included ("3.1.3-dev.123"); `versionClassName` lets a caller hide it first
// when room runs out (it truncates before the wordmark does, and its full
// text stays in the tooltip).

import { MARK_ARC, MARK_ARC_WIDTH, MARK_BARS, MARK_BAR_WIDTH, MARK_GRID } from '@/lib/brand-mark';
import { cx } from '../ui';

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
      {/* 32px, smaller only when zoom has shrunk the masthead (--band-plate). */}
      <span aria-hidden className="grid size-[var(--band-plate)] shrink-0 rounded-[8px] bg-bar-ink text-bar">
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
