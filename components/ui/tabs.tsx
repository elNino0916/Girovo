'use client';

// Tabs and Segmented
//
// Both are roving-tabindex groups: one tab stop for the whole row, arrows
// move and select, Home/End jump. Tabs switch a region (role=tablist, with
// TabPanel); Segmented picks a value (role=radiogroup).

import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useRef } from 'react';
import { M3eButton } from '@m3e/react/button';
import { M3eButtonGroup } from '@m3e/react/button-group';
import { CountBadge } from './chips';
import { cx } from './shared';

function rovingKey(e: ReactKeyboardEvent, count: number, current: number, vertical = false): number | null {
  const next = vertical ? 'ArrowDown' : 'ArrowRight';
  const prev = vertical ? 'ArrowUp' : 'ArrowLeft';
  if (e.key === next) return (current + 1) % count;
  if (e.key === prev) return (current - 1 + count) % count;
  if (e.key === 'Home') return 0;
  if (e.key === 'End') return count - 1;
  return null;
}

export type TabItem<T extends string> = { id: T; label: ReactNode; icon?: ReactNode; count?: number };

export const tabDomId = (base: string, id: string) => `${base}-tab-${id}`;
export const tabPanelDomId = (base: string, id: string) => `${base}-panel-${id}`;

export function Tabs<T extends string>({
  items, value, onChange, variant = 'underline', idBase, className, 'aria-label': ariaLabel,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** underline: the institute bar (3px accent rule under the active tab) · pill: inside a tile. */
  variant?: 'underline' | 'pill';
  /** Prefix for tab/panel ids — pass the same to TabPanel. */
  idBase: string;
  className?: string;
  'aria-label': string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = Math.max(0, items.findIndex((t) => t.id === value));

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const n = rovingKey(e, items.length, current);
    if (n == null) return;
    e.preventDefault();
    onChange(items[n].id);
    refs.current[n]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cx(
        // A row that does not fit scrolls sideways rather than wrapping or
        // pushing the page wider; the scrollbar is hidden, the row still swipes.
        variant === 'underline'
          ? 'flex min-w-0 items-stretch gap-1 self-stretch overflow-x-auto [scrollbar-width:none]'
          : 'inline-flex flex-wrap gap-1.5',
        className,
      )}
    >
      {items.map((t, i) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            id={tabDomId(idBase, t.id)}
            aria-selected={selected}
            aria-controls={tabPanelDomId(idBase, t.id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cx(
              'relative inline-flex shrink-0 items-center gap-2 font-semibold whitespace-nowrap transition-colors duration-150',
              variant === 'underline'
                ? cx(
                    // The row scrolls (and so clips), so the ring is drawn inside the tab.
                    'rounded-md px-3 text-[15px] focus-visible:-outline-offset-2',
                    selected ? 'text-ink' : 'text-ink-2 hover:text-ink',
                  )
                : cx(
                    'h-9 rounded-full px-4 text-[14px]',
                    selected ? 'bg-accent text-accent-ink' : 'text-ink-2 hover:bg-inset hover:text-ink',
                  ),
            )}
          >
            {t.icon}
            {t.label}
            {t.count != null && (
              <CountBadge count={t.count} tone={variant === 'pill' && selected ? 'onAccent' : 'neutral'} />
            )}
            {variant === 'underline' && (
              <span
                aria-hidden
                className={cx(
                  'absolute inset-x-2 bottom-0 h-[3px] rounded-t-full transition-colors duration-150',
                  selected ? 'bg-accent' : 'bg-transparent',
                )}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({
  idBase, id, active, className, children,
}: { idBase: string; id: string; active: boolean; className?: string; children: ReactNode }) {
  if (!active) return null;
  return (
    <div role="tabpanel" id={tabPanelDomId(idBase, id)} aria-labelledby={tabDomId(idBase, id)} className={className}>
      {children}
    </div>
  );
}

export function Segmented<T extends string>({
  options, value, onChange, size = 'md', block, className, 'aria-label': ariaLabel,
}: {
  options: { value: T; label: ReactNode; icon?: ReactNode; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  block?: boolean;
  className?: string;
  'aria-label': string;
}) {
  // M3 Expressive's single-select choice: a connected button group of toggle
  // buttons (@m3e/web button-group, variant "connected"). The chosen one is
  // filled in the primary and round all over; the others keep the group's
  // inner corners. One is always chosen: pressing the chosen one again is
  // refused (beforeinput), as a radio group would.
  const buttonSize = size === 'sm' ? 'extra-small' : 'small';
  return (
    <M3eButtonGroup
      variant="connected"
      size={buttonSize}
      role="group"
      aria-label={ariaLabel}
      className={cx(block ? 'flex w-full' : 'inline-flex max-w-full', className)}
    >
      {options.map((o) => {
        const checked = o.value === value;
        return (
          <M3eButton
            key={o.value}
            toggle
            variant="filled"
            size={buttonSize}
            selected={checked}
            disabled={o.disabled}
            className={block ? 'flex-1' : undefined}
            onBeforeInput={(e: Event) => {
              if (checked) e.preventDefault();
            }}
            onChange={() => {
              if (!checked) onChange(o.value);
            }}
          >
            {o.icon && <span slot="icon" className="inline-flex">{o.icon}</span>}
            {o.icon && <span slot="selected-icon" className="inline-flex">{o.icon}</span>}
            {o.label}
          </M3eButton>
        );
      })}
    </M3eButtonGroup>
  );
}
