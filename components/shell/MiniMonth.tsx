'use client';

// The month in the frame's sidebar (components/shell/Sidebar.tsx), drawn at
// the sidebar's width as Google's desktop calendars draw theirs: weeks from
// Monday, 32px days, today filled in the primary, a dot under the days with
// a booking and a ring under the days a payment is due (the payments Girovo
// expects, insights/recurring-model.ts). On the Übersicht a day pressed
// narrows the bookings to it; in Analyse the analysis's month is a band.
// M3E's calendar is drawn for a dialog (48px days, weeks from the locale's
// first day) and does not fit a sidebar; this is its small sibling.

import { useEffect, useMemo, useState } from 'react';
import { intlLocale } from '@/lib/i18n';
import { useT } from '@/lib/i18n/react';
import { Icon } from '../icons';
import { IconButton, cx } from '../ui';

const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

export function MiniMonth({
  selected, onSelect, dueDays, bookingDays, range, startAt, label,
}: {
  /** The picked day (yyyy-mm-dd), if any. */
  selected?: string | null;
  onSelect?: (day: string) => void;
  /** Days a payment is due (yyyy-mm-dd): a ring under the number. */
  dueDays?: ReadonlySet<string>;
  /** Days with a booking (yyyy-mm-dd): a dot under the number. */
  bookingDays?: ReadonlySet<string>;
  /** A range drawn over the days (Analyse's month). */
  range?: { from: string; to: string } | null;
  /** The month to open on (yyyy-mm-dd of any day in it). */
  startAt?: string;
  /** The month's accessible name. */
  label: string;
}) {
  const t = useT();
  const start = startAt ?? isoToday();
  const [view, setView] = useState({ y: Number(start.slice(0, 4)), m: Number(start.slice(5, 7)) - 1 });
  // A new period from outside (Analyse's month) moves the month along.
  useEffect(() => {
    setView({ y: Number(start.slice(0, 4)), m: Number(start.slice(5, 7)) - 1 });
  }, [start]);

  const today = isoToday();
  const title = new Intl.DateTimeFormat(intlLocale(), { month: 'long', year: 'numeric' }).format(new Date(view.y, view.m, 1, 12));
  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(intlLocale(), { weekday: 'short' });
    // 2026-11-02 is a Monday.
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2026, 10, 2 + i, 12)).replace('.', '').slice(0, 2));
  }, []);
  const dayName = useMemo(() => new Intl.DateTimeFormat(intlLocale(), { weekday: 'long', day: 'numeric', month: 'long' }), []);

  // Six weeks from the Monday on or before the 1st.
  const first = new Date(view.y, view.m, 1, 12);
  const lead = (first.getDay() + 6) % 7;
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(view.y, view.m, 1 - lead + i, 12);
    return { key: keyOf(d.getFullYear(), d.getMonth(), d.getDate()), day: d.getDate(), out: d.getMonth() !== view.m, date: d };
  });
  const move = (step: number) => setView(({ y, m }) => {
    const d = new Date(y, m + step, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  return (
    <div data-frame-month role="group" aria-label={label} className="px-5">
      <div className="flex items-center justify-between pl-2">
        <span className="text-[14px] leading-5 font-medium text-ink">{title}</span>
        <span className="flex">
          <IconButton size="sm" aria-label={t.shell.frame.prevMonth} onClick={() => move(-1)}>
            <Icon ms="chevron_left" size={20}>{null}</Icon>
          </IconButton>
          <IconButton size="sm" aria-label={t.shell.frame.nextMonth} onClick={() => move(1)}>
            <Icon ms="chevron_right" size={20}>{null}</Icon>
          </IconButton>
        </span>
      </div>
      <div className="grid grid-cols-7 justify-items-center">
        {weekdays.map((w) => (
          <span key={w} aria-hidden className="grid h-6 w-8 place-items-center text-[12px] leading-4 font-medium text-ink-2">{w}</span>
        ))}
        {cells.map((c) => {
          const inRange = !!range && c.key >= range.from && c.key <= range.to;
          const isToday = c.key === today;
          const picked = c.key === selected;
          const marks = [
            bookingDays?.has(c.key) ? t.shell.frame.hasBookings : '',
            dueDays?.has(c.key) ? t.shell.frame.hasDue : '',
          ].filter(Boolean).join(', ');
          return (
            <span
              key={c.key}
              className={cx(
                'grid h-8 w-full place-items-center',
                inRange && 'bg-[var(--md-secondary-container)]',
                inRange && c.key === range?.from && 'rounded-l-full',
                inRange && c.key === range?.to && 'rounded-r-full',
              )}
            >
              <button
                type="button"
                disabled={!onSelect}
                aria-label={`${dayName.format(c.date)}${marks ? `, ${marks}` : ''}`}
                aria-pressed={onSelect ? picked : undefined}
                aria-current={isToday ? 'date' : undefined}
                onClick={() => onSelect?.(c.key)}
                className={cx(
                  'relative grid size-7 place-items-center rounded-full text-[12px] leading-4 font-medium tabular-nums outline-offset-1 transition-colors duration-150',
                  isToday ? 'bg-[var(--md-primary)] text-[var(--md-on-primary)]'
                    : picked ? 'text-ink shadow-[inset_0_0_0_1.5px_var(--md-primary)]'
                      : inRange ? 'text-[var(--md-on-secondary-container)]'
                        : c.out ? 'text-ink-2 opacity-75' : 'text-ink',
                  onSelect && !isToday && 'enabled:hover:bg-[var(--md-surface-container-high)]',
                  !onSelect && 'cursor-default',
                )}
              >
                {c.day}
                {bookingDays?.has(c.key) && (
                  <span aria-hidden className={cx('absolute -bottom-0.5 size-1 rounded-full', isToday ? 'bg-[var(--md-primary)]' : 'bg-ink-2')} />
                )}
                {!bookingDays?.has(c.key) && dueDays?.has(c.key) && (
                  <span aria-hidden className="absolute -bottom-0.5 size-1 rounded-full shadow-[inset_0_0_0_1px_var(--ink-2)]" />
                )}
              </button>
            </span>
          );
        })}
      </div>
      {(bookingDays?.size || dueDays?.size) ? (
        <p aria-hidden className="flex gap-4 px-2 pt-1 text-[12px] leading-4 text-ink-2">
          {bookingDays?.size ? <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-ink-2" />{t.shell.frame.legendBookings}</span> : null}
          {dueDays?.size ? <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full shadow-[inset_0_0_0_1px_var(--ink-2)]" />{t.shell.frame.legendDue}</span> : null}
        </p>
      ) : null}
    </div>
  );
}

function isoToday(): string {
  const d = new Date();
  return keyOf(d.getFullYear(), d.getMonth(), d.getDate());
}
