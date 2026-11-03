'use client';

// Alert — an inline message inside a form or a tile.

import type { ReactNode } from 'react';
import { useT } from '@/lib/i18n/react';
import { AlertTriangleIcon, CheckCircleIcon, CloseIcon, InfoIcon } from '../icons';
import { IconButton } from './button';
import { cx } from './shared';

export type AlertTone = 'error' | 'warn' | 'info' | 'success';

// A tonal container and a glyph in the tone's colour, Material's way — no
// stripe down the side.
const ALERT_TONES: Record<AlertTone, { box: string; icon: string; Glyph: typeof InfoIcon }> = {
  error: { box: 'bg-red-soft', icon: 'text-red', Glyph: AlertTriangleIcon },
  // Amber is reserved for "vorgemerkt", so a warning is the neutral inset with
  // the orange glyph — the colour is only a pointer; the words carry it.
  warn: { box: 'bg-inset', icon: 'text-emphasis', Glyph: AlertTriangleIcon },
  info: { box: 'bg-info-soft', icon: 'text-info', Glyph: InfoIcon },
  success: { box: 'bg-green-soft', icon: 'text-green', Glyph: CheckCircleIcon },
};

export function Alert({
  tone = 'error', title, children, action, onDismiss, icon, className, role,
}: {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  icon?: ReactNode;
  /** Replaces the default top margin. */
  className?: string;
  /** Defaults to "alert" for errors, none otherwise. */
  role?: 'alert' | 'status';
}) {
  const tr = useT();
  const t = ALERT_TONES[tone];
  return (
    <div
      role={role ?? (tone === 'error' ? 'alert' : undefined)}
      className={cx('flex items-start gap-3 rounded-[12px] py-3 pr-3 pl-4 text-[14px] leading-snug text-ink', t.box, className ?? 'mt-3')}
    >
      <span className={cx('mt-px shrink-0', t.icon)}>{icon ?? <t.Glyph size={18} />}</span>
      <div className="min-w-0 flex-1">
        {title && <p className="font-bold">{title}</p>}
        {children && <div className={cx(title ? 'mt-0.5 text-ink-2' : undefined)}>{children}</div>}
        {action && <div className="mt-2.5 flex flex-wrap gap-2">{action}</div>}
      </div>
      {onDismiss && (
        <IconButton aria-label={tr.shell.ui.dismiss} onClick={onDismiss} className="-my-1 -mr-1 size-7">
          <CloseIcon size={15} />
        </IconButton>
      )}
    </div>
  );
}
