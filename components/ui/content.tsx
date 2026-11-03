'use client';

// What fills the page between the controls: tiles, the loading, empty and
// failure states, and the small parts (dot lists, keys).

import { type CSSProperties, type ReactNode, useId } from 'react';
import { M3eSkeleton } from '@m3e/react/skeleton';
import { useT } from '@/lib/i18n/react';
import { Button } from './button';
import { cx } from './shared';

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

/** A content block on the page: `.panel` with an optional header row. */
export function Tile({
  as: As = 'section', title, titleId, subtitle, actions, className, children, 'aria-label': ariaLabel,
}: {
  as?: 'section' | 'div' | 'aside' | 'article';
  title?: ReactNode;
  titleId?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
  'aria-label'?: string;
}) {
  const auto = useId();
  const id = title ? (titleId ?? `tile${auto}`) : undefined;
  return (
    <As className={cx('panel', className)} aria-labelledby={id} aria-label={id ? undefined : ariaLabel}>
      {title && <TileHeader title={title} titleId={id} subtitle={subtitle} actions={actions} />}
      {children}
    </As>
  );
}

export function TileHeader({
  title, titleId, subtitle, actions, className,
}: { title: ReactNode; titleId?: string; subtitle?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    // The actions wrap under the title when both will not fit one line
    // ("Ausgaben nach Kategorie" and "Budgets festlegen" on a phone), rather
    // than squeezing the title onto two.
    <div className={cx('flex flex-wrap items-start justify-between gap-x-3 gap-y-1', className ?? 'px-4 pt-4 pb-3 sm:px-5 sm:pt-5')}>
      <div className="min-w-0">
        <h2 id={titleId} className="section-head">{title}</h2>
        {subtitle && <div className="mt-0.5 text-[13px] text-ink-3">{subtitle}</div>}
      </div>
      {actions && <div className="-mt-1 -mr-1 flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading, empty and failure states
// ---------------------------------------------------------------------------
/**
 * A placeholder shaped like what it stands in for: M3E's skeleton (@m3e/web
 * skeleton), its wave travelling over the shape. The shape is the span it
 * covers — its size and corner the caller's classes (6px unless a
 * `rounded-*` says otherwise; round with `circle`).
 */
export function Skeleton({
  className, width, height, circle, style,
}: { className?: string; width?: number | string; height?: number | string; circle?: boolean; style?: CSSProperties }) {
  return (
    <M3eSkeleton aria-hidden="true" animation="wave" shape={circle ? 'circular' : 'auto'}>
      <span
        className={cx('block', circle ? 'rounded-full' : 'rounded-[6px]', className)}
        style={{ width, height, ...style }}
      />
    </M3eSkeleton>
  );
}

export type Illustration = 'transactions' | 'search' | 'inbox' | 'chart' | 'contracts' | 'error' | 'done';

/**
 * Small line illustrations for empty and failure states: one soft disc, a
 * few strokes in the accent, detail in the quiet ink. Deliberately plain —
 * a picture that explains, not one that decorates.
 */
function IllustrationArt({ name }: { name: Illustration }) {
  const a = 'var(--accent)';
  const q = 'var(--ink-3)';
  const common = { fill: 'none', strokeWidth: 2.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg viewBox="0 0 120 96" width="120" height="96" aria-hidden focusable="false" className="shrink-0">
      <circle cx="60" cy="48" r="40" fill="var(--accent-soft)" />
      {name === 'transactions' && (
        <g {...common}>
          <rect x="34" y="22" width="52" height="56" rx="7" stroke={a} fill="var(--surface)" />
          <path d="M44 36h18M44 48h24M44 60h14" stroke={q} />
          <path d="M74 36h2M74 48h2M74 60h2" stroke={a} />
        </g>
      )}
      {name === 'search' && (
        <g {...common}>
          <rect x="30" y="24" width="44" height="50" rx="7" stroke={q} fill="var(--surface)" />
          <path d="M40 38h22M40 49h16M40 60h12" stroke={q} />
          <circle cx="72" cy="56" r="13" stroke={a} fill="var(--surface)" />
          <path d="M81.5 65.5L91 75" stroke={a} />
        </g>
      )}
      {name === 'inbox' && (
        <g {...common}>
          <path d="M30 54l8-24a4 4 0 0 1 3.8-2.7h36.4A4 4 0 0 1 82 30l8 24" stroke={q} />
          <path d="M30 54v14a4 4 0 0 0 4 4h52a4 4 0 0 0 4-4V54H74l-4 7H50l-4-7H30z" stroke={a} fill="var(--surface)" />
        </g>
      )}
      {name === 'chart' && (
        <g {...common}>
          <path d="M30 74h60" stroke={q} />
          <rect x="36" y="50" width="10" height="24" rx="2" stroke={a} fill="var(--surface)" />
          <rect x="55" y="34" width="10" height="40" rx="2" stroke={a} fill="var(--surface)" />
          <rect x="74" y="58" width="10" height="16" rx="2" stroke={q} fill="var(--surface)" />
        </g>
      )}
      {name === 'contracts' && (
        <g {...common}>
          <rect x="32" y="26" width="48" height="46" rx="6" stroke={q} fill="var(--surface)" />
          <path d="M32 38h48M44 21v9M68 21v9" stroke={q} />
          <circle cx="78" cy="64" r="13" stroke={a} fill="var(--surface)" />
          <path d="M72.5 64a5.5 5.5 0 0 1 9.5-3.8M83.5 64a5.5 5.5 0 0 1-9.5 3.8M82 56.8v3.6h-3.6M74 71.2v-3.6h3.6" stroke={a} strokeWidth={2} />
        </g>
      )}
      {name === 'error' && (
        <g {...common}>
          <rect x="34" y="22" width="52" height="56" rx="7" stroke={q} fill="var(--surface)" />
          <path d="M44 36h24M44 47h16" stroke={q} />
          <circle cx="60" cy="62" r="10" stroke={a} fill="var(--surface)" />
          <path d="M60 57v5.5M60 66.5v.01" stroke={a} />
        </g>
      )}
      {name === 'done' && (
        <g {...common}>
          <circle cx="60" cy="48" r="22" stroke={a} fill="var(--surface)" />
          <path d="M50 48.5l7 7 13-14" stroke={a} strokeWidth={3} />
        </g>
      )}
    </svg>
  );
}

export function EmptyState({
  illustration, icon, title, children, action, className, compact,
}: {
  /** A built-in line illustration; `icon` (a 24-grid icon) is the smaller alternative. */
  illustration?: Illustration;
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** Less vertical room, for a side tile. */
  compact?: boolean;
}) {
  return (
    <div className={cx('flex flex-col items-center text-center', compact ? 'px-4 py-6' : 'px-6 py-10', className)}>
      {illustration ? (
        <IllustrationArt name={illustration} />
      ) : icon ? (
        <span className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent">{icon}</span>
      ) : null}
      {title && <p className={cx('text-[17px] leading-snug font-bold text-ink', illustration || icon ? 'mt-3' : undefined)}>{title}</p>}
      {children && <div className="mt-1.5 max-w-[46ch] text-[14px] leading-relaxed text-ink-2">{children}</div>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title, children, onRetry, retryLabel, busy, className, compact,
}: {
  title?: ReactNode;
  /** The reason, as the bank or the app put it. */
  children?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  busy?: boolean;
  className?: string;
  compact?: boolean;
}) {
  const t = useT();
  return (
    <div role="alert" className={cx('flex flex-col items-center text-center', compact ? 'px-4 py-6' : 'px-6 py-10', className)}>
      <IllustrationArt name="error" />
      <p className="mt-3 text-[17px] leading-snug font-bold text-ink">{title === undefined ? t.shell.ui.failed : title}</p>
      {children && <div className="mt-1.5 max-w-[46ch] text-[14px] leading-relaxed text-ink-2">{children}</div>}
      {onRetry && (
        <Button size="sm" variant="secondary" className="mt-4" busy={busy} onClick={onRetry}>
          {retryLabel ?? t.common.retry}
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small parts
// ---------------------------------------------------------------------------

/**
 * Short facts in a row with " · " between them: "Basis: Girokonto · 4 Umsätze".
 *
 * Where the row wraps (a phone), a line never starts or ends on a dot — a
 * dot left hanging at a line's end reads like a fact that went missing.
 * Each fact carries its dot in front of it, and the row starts one dot-width
 * left of its box, clipped: on every line, the first fact's dot sits in that
 * clipped margin and is not drawn. The dots are decoration; a screen reader
 * hears the facts as separate items.
 */
export function DotList({ items, className }: { items: ReactNode[]; className?: string }) {
  return (
    <span className={cx('block overflow-hidden', className)}>
      <span className="-ml-[0.8em] flex flex-wrap">
        {items.filter((item) => item != null && item !== false && item !== '').map((item, i) => (
          <span
            key={i}
            className="min-w-0 before:inline-block before:w-[0.8em] before:text-center before:content-['·'_/_'']"
          >
            {item}
          </span>
        ))}
      </span>
    </span>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cx(
        'inline-grid h-[22px] min-w-[22px] place-items-center rounded-[5px] bg-[var(--md-surface-container-highest)] px-1.5',
        'font-sans text-[12.5px] leading-none font-medium text-ink-2',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
