'use client';

import { BRANDS, DARK_INVERT } from '@/lib/brands';
import { cx } from './ui';

export type LogoSize = 'sm' | 'md' | 'lg' | 'tile';

const BOX: Record<LogoSize, string> = {
  sm: 'size-6.5 rounded-[7px]',
  md: 'size-9 rounded-[10px]',
  lg: 'size-11 rounded-xl',
  tile: 'h-12 w-full rounded-[10px]',
};

const IMG_BOX: Record<LogoSize, string> = {
  sm: 'min-w-6.5 max-w-[76px] rounded-[7px] px-1.5 py-1',
  md: 'min-w-9 max-w-[100px] rounded-[10px] px-2 py-1.5',
  lg: 'min-w-11 max-w-[116px] rounded-xl px-2 py-1.5',
  tile: 'max-w-full rounded-[10px] px-2 py-1',
};

const IMG_H: Record<LogoSize, string> = {
  sm: 'h-[18px]',
  md: 'h-6',
  lg: 'h-8',
  tile: 'h-10',
};

/**
 * A bank's mark. Prefers a real logo file from public/logos (discovered at boot
 * via /api/logos) and falls back to a monogram chip in the group's brand color.
 */
export function BankLogo({
  brand, size = 'md', file,
}: {
  brand: string;
  size?: LogoSize;
  /** Filename under public/logos, when one exists for this brand. */
  file?: string;
}) {
  if (file) {
    return (
      <span
        data-invert={DARK_INVERT.has(brand)}
        className={cx('logo-img grid w-auto shrink-0 place-items-center overflow-hidden', IMG_BOX[size])}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/logos/${file}`} alt="" loading="lazy" className={cx('mx-auto block w-auto max-w-full object-contain', IMG_H[size])} />
      </span>
    );
  }

  const b = BRANDS[brand] || BRANDS.generic;
  const fg = b.fg || '#ffffff';

  let inner;
  if (b.mark === 'slash') {
    // square with a rising diagonal — the classic German bank geometry
    inner = (
      <>
        <rect x="22" y="22" width="56" height="56" fill="none" stroke={fg} strokeWidth="7" />
        <path d="M32 68 L68 32" stroke={fg} strokeWidth="8" />
      </>
    );
  } else if (brand === 'sparkasse') {
    inner = (
      <>
        <circle cx="63" cy="25" r="11" fill={fg} />
        <text x="44" y="60" dy=".36em" textAnchor="middle" fontFamily="var(--font-barlow-condensed), var(--font-barlow), sans-serif" fontWeight="700" fontSize="58" fill={fg}>S</text>
      </>
    );
  } else {
    const len = String(b.mark).length;
    const fs = len >= 3 ? 32 : len === 2 ? 42 : 56;
    inner = (
      <text x="50" y="50" dy=".36em" textAnchor="middle" fontFamily="var(--font-barlow-condensed), var(--font-barlow), sans-serif" fontWeight="700" fontSize={fs} fill={fg}>
        {b.mark}
      </text>
    );
  }

  return (
    <span className={cx('grid shrink-0 place-items-center overflow-hidden', BOX[size])} style={{ background: b.bg }}>
      <svg viewBox="0 0 100 100" role="img" aria-hidden className="block size-full">
        {inner}
        {b.accent && <rect x="0" y="86" width="100" height="14" fill={b.accent} />}
      </svg>
    </span>
  );
}
