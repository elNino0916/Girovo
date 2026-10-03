// The app's own mark: a "€" plate and the wordmark, in the masthead, the navy
// footer and the screens before the login. One component, so the three never
// drift apart — the same plate, the same weight, the same one colour.
//
// Drawn for navy (--bar): a light plate with the "€" cut out in the bar's own
// navy, which reads as a stamp in both themes, and the wordmark in bar-ink —
// one name, so one colour (a dimmer "-FinTS" would read as a second name).
//
// The version stays legible for support questions, development builds
// included ("3.1.3-dev.123"); `versionClassName` lets a caller hide it first
// when room runs out (it truncates before the wordmark does, and its full
// text stays in the tooltip).

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
      <span
        aria-hidden
        className="grid size-[var(--band-plate)] shrink-0 place-items-center rounded-[8px] bg-bar-ink text-[18px] leading-none font-bold text-bar"
      >
        €
      </span>
      {/* On the narrowest phones (a 375px masthead) the full name and the four
          session controls don't share one row; there the suffix goes rather
          than the name being cut to "Sooskasse-…". The plate still says what
          this is, and screen readers always get the whole name. Outside the
          masthead's container (footer, login bar) the query never matches. */}
      <span className="truncate text-[17px] leading-none font-bold whitespace-nowrap text-bar-ink sm:shrink-0 sm:text-[18px]">
        Sooskasse<span className="@max-[349.98px]/mast:sr-only">-FinTS</span>
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
