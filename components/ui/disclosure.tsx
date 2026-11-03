'use client';

// Disclosure — the one collapsible-group header in the app.
//
// Every grouped list (accounts, vorgemerkte Umsätze, a day of bookings, the
// Referenzen of a booking) opens and closes through this, so the chevron, the
// hit area, the sticky offset and the aria wiring are decided once.

import { type ReactNode, useId, useState } from 'react';
import { ChevronIcon } from '../icons';
import { cx } from './shared';

export function Disclosure({
  open: openProp, onToggle, defaultOpen = false, title, trailing, sticky, tone = 'plain', className, headerClassName, children,
}: {
  /** Controlled when given (with onToggle); otherwise the Disclosure keeps its own state. */
  open?: boolean;
  onToggle?: () => void;
  defaultOpen?: boolean;
  title: ReactNode;
  /** Sits at the right edge of the header — a count, a total, a refresh. */
  trailing?: ReactNode;
  /** Pin the header to the top of the scrolling page while its group is scrolled through. */
  sticky?: boolean;
  tone?: 'plain' | 'inset' | 'amber';
  className?: string;
  headerClassName?: string;
  children: ReactNode;
}) {
  const id = useId();
  const [own, setOwn] = useState(defaultOpen);
  const open = openProp ?? own;
  const toggle = onToggle ?? (() => setOwn((o) => !o));
  const tones = {
    plain: 'text-ink-2 hover:text-ink',
    inset: 'bg-inset text-ink-2 hover:text-ink',
    amber: 'bg-amber-soft text-amber',
  } as const;

  return (
    <div className={className}>
      <div className={cx('flex min-h-11 items-center gap-2 px-4', tones[tone], sticky && 'sticky top-0 z-5', headerClassName)}>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={id}
          className="-ml-1 flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-md pl-1 text-left"
        >
          <ChevronIcon className="chev shrink-0 opacity-70" data-open={open} />
          <span className="min-w-0 truncate">{title}</span>
        </button>
        {trailing}
      </div>
      <div id={id} hidden={!open}>{children}</div>
    </div>
  );
}
