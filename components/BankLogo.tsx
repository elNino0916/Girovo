'use client';

import { BRANDS, DARK_INVERT, ON_DARK } from '@/lib/brands';
import { cx } from './ui';

export type LogoSize = 'sm' | 'md' | 'tile';

// Monogram chips, on DESIGN.md's radius scale: 6px at field size, 8px from
// chip size up, so a small chip still reads as a rounded square, never a
// circle.
const BOX: Record<LogoSize, string> = {
  sm: 'size-6.5 rounded-[6px]',
  md: 'size-9 rounded-[8px]',
  // A quick pick on the login screen: compact beside the name on a phone,
  // above it from `sm` up. A chip, not a slab.
  tile: 'size-8 rounded-[8px] sm:size-9',
};

// Logo files sit on a white plate (.logo-img) so a transparent PNG reads on any
// background. The plate is padded so the mark never touches its edge.
const IMG_BOX: Record<LogoSize, string> = {
  sm: 'min-w-6.5 max-w-[76px] rounded-[6px] px-1.5 py-1',
  md: 'min-w-9 max-w-[100px] rounded-[8px] px-2 py-1.5',
  tile: 'w-full px-1',
};

// Height sets the size; the width cap keeps a long wordmark (ING,
// Commerzbank) from out-shouting a square one (Sparkasse) in a row of picks.
const IMG_H: Record<LogoSize, string> = {
  sm: 'h-[18px] max-w-full',
  md: 'h-6 max-w-full',
  tile: 'h-6 max-w-[min(100%,88px)] sm:h-7',
};

/**
 * A bank's mark. Prefers a real logo file from public/logos (discovered at boot
 * via /api/logos) and falls back to a monogram chip in the group's brand color.
 *
 * Always decorative: the bank's name is written next to it wherever it
 * appears, so the image carries no accessible name of its own.
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
    // Dark navy and black marks are flipped in dark mode, and marks drawn
    // for a dark ground are set in one dark colour in light mode; which ones
    // is decided in lib/brands.ts, beside the brand list.
    const invert = DARK_INVERT.has(brand);
    const onDark = ON_DARK.has(brand);
    return (
      <span
        data-invert={invert}
        data-on-dark={onDark}
        className={cx('logo-img grid w-auto shrink-0 place-items-center overflow-hidden', IMG_BOX[size])}
        // A quick pick sits on the white card itself, so the logo goes on it
        // bare — a framed plate on the card would be a box in a box. Inline,
        // because .logo-img is unlayered and beats any utility; the class
        // stays for its dark-mode inversion of navy and black marks.
        style={size === 'tile' ? { background: 'transparent', borderColor: 'transparent' } : undefined}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/logos/${file}`}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className={cx('mx-auto block w-auto object-contain', IMG_H[size])}
        />
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
      <svg viewBox="0 0 100 100" aria-hidden focusable="false" className="block size-full">
        {inner}
        {b.accent && <rect x="0" y="86" width="100" height="14" fill={b.accent} />}
      </svg>
    </span>
  );
}
