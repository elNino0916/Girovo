'use client';

import { useT } from '@/lib/i18n/react';
import { useFints } from '../FintsProvider';
import { EyeIcon, EyeOffIcon } from '../icons';
import { IconButton, cx } from '../ui';

/**
 * The eye that hides and shows every amount, wherever a screen offers it: the
 * top app bar (`bar`, with its "B" shortcut), the accounts overview and an
 * account's head. The label names what a press does, so it changes with the
 * state (and is not also a pressed toggle — that would announce "Beträge
 * anzeigen, gedrückt"). While amounts are hidden the button keeps a tint, so
 * the mode is visible from across the room.
 */
export function PrivacyToggle({ bar, shortcut, className }: { bar?: boolean; shortcut?: boolean; className?: string }) {
  const { privacy, togglePrivacy } = useFints();
  const t = useT();
  const label = privacy ? t.common.showAmounts : t.common.hideAmounts;
  return (
    <IconButton
      tone={bar ? 'bar' : undefined}
      size="md"
      aria-label={label}
      aria-keyshortcuts={shortcut ? 'B' : undefined}
      title={bar ? label + (shortcut ? ' (B)' : '') : undefined}
      onClick={togglePrivacy}
      className={cx(
        'rounded-full',
        privacy && (bar ? 'bg-[color-mix(in_srgb,var(--bar-ink)_14%,transparent)]' : 'bg-[color-mix(in_srgb,var(--ink)_12%,transparent)]'),
        className,
      )}
    >
      {privacy ? <EyeOffIcon /> : <EyeIcon />}
    </IconButton>
  );
}
