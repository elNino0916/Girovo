'use client';

// Small presentational pieces the money sheets share.

import type { ReactNode } from 'react';
import { cx } from '../ui';

/** A key–value line of a summary: label left, value right (stacked on a phone). */
export function SummaryRow({
  label, children, className,
}: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-col gap-0.5 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6', className)}>
      <dt className="shrink-0 text-[13px] leading-snug font-semibold text-ink-3">{label}</dt>
      <dd className="min-w-0 text-[15px] leading-snug break-words text-ink sm:text-right">{children}</dd>
    </div>
  );
}

export function SummaryList({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cx('divide-y divide-line', className)}>{children}</dl>;
}

/**
 * The confirmation mark: a green disc that settles in, a ring that leaves
 * once, and the tick drawn on. Under reduced motion the animations collapse
 * to their end state (globals.css), so the finished check is still shown.
 */
export function SuccessMark() {
  return (
    <span aria-hidden className="relative mx-auto grid size-[72px] place-items-center">
      <span
        className="absolute inset-0 rounded-full bg-green-soft"
        style={{ animation: 'pop-in 0.32s var(--ease-out-soft) both' }}
      />
      <span
        className="absolute inset-0 rounded-full border-2 border-green"
        style={{ animation: 'ping-ring 0.9s var(--ease-out-soft) 0.25s both' }}
      />
      <svg viewBox="0 0 24 24" width="38" height="38" className="relative text-green">
        <path
          d="M5 12.5l4.6 4.6L19 7.8"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="22"
          style={{ ['--check-len' as string]: '22', animation: 'check-draw 0.42s var(--ease-out-soft) 0.18s both' }}
        />
      </svg>
    </span>
  );
}

/** The "we cannot tell" mark: neutral, not a warning colour — nothing is known to be wrong. */
export function UnsureMark() {
  return (
    <span aria-hidden className="mx-auto grid size-[72px] place-items-center rounded-full bg-inset text-ink-2">
      <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.2 9.2a2.9 2.9 0 1 1 4.1 2.65c-.8.37-1.3 1.05-1.3 1.9v.5" />
        <path d="M12 17.6v.1" />
      </svg>
    </span>
  );
}
