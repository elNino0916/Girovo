'use client';

// The rows of the settings page (./Settings.tsx), shared with the Sitzung
// panel's list of banks (components/shell/ProfileMenu.tsx): a setting with its
// control, a row that opens something, and a fact about this machine with its
// one action.

import type { ReactNode } from 'react';
import type { SettingsTarget } from '@/lib/app-types';
import { cx } from '../ui';

/**
 * A setting: its name, and what it does when that is not plain, on the left;
 * its control on the right. `wide` controls (a segmented choice) go under the
 * name on a phone, where both would not fit one line. `setting` is where the
 * search (CommandPalette) brings the user.
 */
export function SettingRow({
  label, hint, htmlFor, setting, wide, children,
}: {
  label: string;
  hint?: ReactNode;
  htmlFor?: string;
  setting?: SettingsTarget;
  wide?: boolean;
  children: ReactNode;
}) {
  const Label = htmlFor ? 'label' : 'span';
  return (
    <div
      data-setting={setting}
      className={cx('flex min-h-12 gap-x-4 gap-y-2.5 py-2', wide ? 'flex-col sm:flex-row sm:items-center' : 'items-center')}
    >
      <div className="min-w-0 flex-1">
        <Label htmlFor={htmlFor} className="block text-[15px] leading-snug text-ink">{label}</Label>
        {hint && <p className="mt-0.5 text-[13px] leading-snug text-ink-3">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** A row that opens something: Updates, Tastenkürzel. */
export const ROW = '-mx-1.5 min-h-10 items-center gap-3 rounded-[8px] px-3 text-left text-[14px] text-ink hover:bg-inset';

/** A fact about this machine with its one action: the device registration, the saved data, a bank of the view. */
export function MachineRow({
  icon, title, hint, action, setting,
}: { icon: ReactNode; title: string; hint: string; action?: ReactNode; setting?: SettingsTarget }) {
  return (
    <div data-setting={setting} className="mt-3 flex items-center gap-3">
      {icon}
      <div className="min-w-0 flex-1">
        <p className="text-[14px] leading-snug font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-[13px] leading-snug text-ink-3">{hint}</p>
      </div>
      {action}
    </div>
  );
}

/** The round mark at the start of a MachineRow. */
export function MachineIcon({ children, tone = 'quiet' }: { children: ReactNode; tone?: 'quiet' | 'info' }) {
  return (
    <span
      aria-hidden
      className={cx(
        'relative grid size-8 shrink-0 place-items-center rounded-full',
        tone === 'info' ? 'bg-info-soft text-info' : 'bg-inset text-ink-3',
      )}
    >
      {children}
    </span>
  );
}
