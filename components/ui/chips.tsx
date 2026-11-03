'use client';

// Chips, tags, badges

import type { ComponentProps, ReactNode, Ref } from 'react';
import { M3eChip, M3eFilterChip } from '@m3e/react/chips';
import { ChevronIcon } from '../icons';
import { cx } from './shared';

/** The cancel that keeps a chip's selected state the caller's: M3E would flip it on a click before the caller decides. */
const keepSelection = (e: Event) => e.preventDefault();

/**
 * M3E's filter chip (@m3e/web chips): outlined; selected, the secondary
 * container and a check (the check, not the tint, is what says "on" without
 * colour). `menu` makes it the trigger of a dropdown — a chevron after the
 * label, selected while its filter is set. Standing alone, not in a chip
 * set, it is a button: pressed or not, or a menu's trigger.
 */
export function FilterChip({
  selected = false, count, icon, menu, className, children, onClick, disabled, ...rest
}: Omit<ComponentProps<'button'>, 'ref' | 'onClick'> & {
  ref?: Ref<HTMLElement>;
  onClick?: (e: MouseEvent) => void;
  selected?: boolean;
  count?: number;
  icon?: ReactNode;
  menu?: boolean;
}) {
  return (
    <M3eFilterChip
      {...(rest as object)}
      role="button"
      variant="outlined"
      selected={selected}
      disabled={!!disabled}
      aria-pressed={menu ? undefined : selected}
      data-chip
      onBeforeInput={keepSelection}
      onClick={onClick as ((e: Event) => void) | undefined}
      className={cx('shrink-0', className)}
    >
      {icon && <span slot="icon" className="inline-flex">{icon}</span>}
      {children}
      {(menu || (count != null && count > 0)) && (
        <span slot="trailing-icon" className="inline-flex items-center gap-1">
          {count != null && count > 0 && <CountBadge count={count} tone="accent" />}
          {menu && <ChevronIcon size={16} strokeWidth={2} />}
        </span>
      )}
    </M3eFilterChip>
  );
}

/**
 * A chip that is a value rather than a filter — a recent payee to pick, a
 * source note ("Aus GiroCode übernommen"). Pressable when it has onClick — a
 * filter chip, checked while picked — otherwise M3E's plain outlined chip.
 */
export function Chip({
  children, icon, onClick, selected, className, title,
}: {
  children: ReactNode;
  icon?: ReactNode;
  onClick?: () => void;
  selected?: boolean;
  className?: string;
  title?: string;
}) {
  const body = (
    <>
      {icon && <span slot="icon" className="inline-flex">{icon}</span>}
      <span className="block min-w-0 truncate">{children}</span>
    </>
  );
  if (!onClick) {
    return <M3eChip variant="outlined" title={title} className={cx('max-w-full', className)}>{body}</M3eChip>;
  }
  return (
    <M3eFilterChip
      role="button"
      variant="outlined"
      selected={!!selected}
      aria-pressed={!!selected}
      data-chip
      title={title}
      onBeforeInput={keepSelection}
      onClick={onClick}
      className={cx('max-w-full', className)}
    >
      {body}
    </M3eFilterChip>
  );
}

export type TagTone = 'neutral' | 'info' | 'positive' | 'negative' | 'pending' | 'emphasis';

const TAG_TONES: Record<TagTone, string> = {
  neutral: 'bg-inset text-ink-2',
  info: 'bg-info-soft text-info',
  positive: 'bg-green-soft text-green',
  negative: 'bg-red-soft text-red',
  pending: 'bg-amber-soft text-amber',
  // Orange may only be a mark: the text stays ink, a dot carries the colour.
  emphasis: 'bg-[color-mix(in_srgb,var(--emphasis)_11%,var(--surface))] text-ink',
};

/** A status word on a row or a heading — "Vorgemerkt", "Echtzeit", "Gerät gemerkt". Not interactive. */
export function Tag({
  tone = 'neutral', icon, size = 'md', className, title, children,
}: { tone?: TagTone; icon?: ReactNode; size?: 'sm' | 'md'; className?: string; title?: string; children: ReactNode }) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex shrink-0 items-center gap-1 rounded-[6px] leading-none font-semibold whitespace-nowrap',
        size === 'sm' ? 'h-5 px-1.5 text-[12.5px]' : 'h-6 px-2 text-[12.5px]',
        TAG_TONES[tone],
        className,
      )}
    >
      {tone === 'emphasis' && !icon && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-emphasis" />}
      {icon}
      {children}
    </span>
  );
}

/** A small count bubble — filters applied, unread messages. */
export function CountBadge({
  count, tone = 'neutral', max = 99, className,
}: { count: number; tone?: 'neutral' | 'accent' | 'onAccent' | 'bar'; max?: number; className?: string }) {
  return (
    <span
      className={cx(
        'tnum inline-grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[12px] leading-none font-bold',
        tone === 'accent' && 'bg-accent text-accent-ink',
        tone === 'onAccent' && 'bg-accent-ink text-accent',
        tone === 'neutral' && 'bg-inset text-ink-2',
        tone === 'bar' && 'bg-[color-mix(in_srgb,var(--bar-ink)_18%,transparent)] text-bar-ink',
        className,
      )}
    >
      {count > max ? `${max}+` : count}
    </span>
  );
}

/** The orange unread mark. Decorative: pair it with text that says the same. */
export function Dot({ className }: { className?: string }) {
  return <span aria-hidden className={cx('inline-block size-2 shrink-0 rounded-full bg-emphasis', className)} />;
}
