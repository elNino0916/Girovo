'use client';

// The ways to Girovo Plus from a locked place (lib/plus.ts): the forecast,
// Frag deine Umsätze and a second bank. Each is a tonal button carrying the
// gold plate, so every door to Plus looks the same. Shown only where Plus
// locks something — the Google Play build without it.

import { useT } from '@/lib/i18n/react';
import { useFints } from '../FintsProvider';
import { BrandPlate } from '../shell/BrandMark';
import { Button } from '../ui';

export function PlusButton({ label, size = 'sm', className, onClick, 'aria-label': ariaLabel }: {
  label: string;
  size?: 'xs' | 'sm';
  className?: string;
  onClick: () => void;
  'aria-label'?: string;
}) {
  return (
    <Button
      variant="secondary"
      size={size}
      className={className}
      aria-label={ariaLabel}
      iconLeft={<BrandPlate tone="plus" size={size === 'xs' ? 16 : 18} />}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

/** A locked tile's body: one line on what it would show, and the way to Plus. */
export function PlusTeaser({ text }: { text: string }) {
  const { openPlus } = useFints();
  const w = useT().plus;
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-[14px] leading-relaxed text-ink-2">{text}</p>
      <PlusButton label={w.name} onClick={openPlus} />
    </div>
  );
}
