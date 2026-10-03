'use client';

// The counterparty's face — one component for every place a booking or a
// series of bookings shows who the money went to or came from: the Umsätze
// rows, the detail drawer, the Vorgemerkt panel, the Analyse lists and the
// Verträge rows. One look everywhere, so a contract and its bookings are
// recognisably the same counterparty.

import { useCallback, useState } from 'react';
import type { Merchant, SerializedTransaction } from '@/lib/fints-types';
import { initials } from '@/lib/format';
import { useMerchant } from '../FintsProvider';
import { cx } from '../ui';

/** sm 32 px (compact lists) · md 40 px (lists) · lg 56 px (the detail drawer). Pixel values are accepted too. */
export type AvatarSize = 'sm' | 'md' | 'lg' | 32 | 40 | 56;

const SIZE: Record<AvatarSize, 'sm' | 'md' | 'lg'> = { sm: 'sm', md: 'md', lg: 'lg', 32: 'sm', 40: 'md', 56: 'lg' };

const TILE = {
  sm: 'size-8 rounded-[9px] p-[3px]',
  md: 'size-10 rounded-[11px] p-[3px]',
  lg: 'size-14 rounded-[14px] p-1.5',
} as const;

const MONOGRAM = {
  sm: 'size-8 text-[12px]',
  md: 'size-10 text-[14px]',
  lg: 'size-14 text-[18px]',
} as const;

const BADGE = {
  sm: 'size-[13px]',
  md: 'size-[15px]',
  lg: 'size-5',
} as const;

const logoSrc = (id: string) => `/api/merchant-logo?id=${encodeURIComponent(id)}`;

/**
 * A ref for a logo <img> that catches the failure `onError` never hears of: a
 * mark server-rendered into the page can fail before hydration attaches the
 * handler, and would then stay an empty white tile. `decode()` settles either
 * way — and, unlike `naturalWidth` alone, does not take an SVG without an
 * intrinsic size for a broken one.
 */
function useEarlyFailure(onFail: () => void, key: string) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth === 0) img.decode().catch(onFail);
  }, [key]);
}

/**
 * The payment provider a purchase went through, notched into the corner of the
 * shop's mark.
 *
 * It exists to answer a question the row otherwise raises: the statement names
 * PayPal, the row shows G2A. Small and secondary on purpose — the shop is what
 * the row is about, and the provider is only how the money got there. It
 * disappears rather than falling back to a monogram, since a badge nobody can
 * read is worse than no badge.
 */
function ViaBadge({ via, size }: { via: NonNullable<Merchant['via']>; size: 'sm' | 'md' | 'lg' }) {
  const [broken, setBroken] = useState(false);
  const probe = useEarlyFailure(() => setBroken(true), via.logo);
  if (broken) return null;
  return (
    <span
      className={cx(
        'absolute -right-1 -bottom-1 flex items-center justify-center overflow-hidden rounded-full border-2 border-surface bg-white',
        BADGE[size],
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={probe} src={logoSrc(via.logo)} alt="" onError={() => setBroken(true)} className="max-h-full max-w-full object-contain" />
    </span>
  );
}

type AvatarProps = {
  /** The booking (or a series' sample booking) the face belongs to. */
  tx: SerializedTransaction;
  /** The name the monogram is drawn from — the display name the row shows. */
  name: string;
  /** Money came in: the monogram takes the credit tint. */
  credit?: boolean;
  /** A Vormerkposten: the monogram takes the amber of "vorgemerkt". */
  pending?: boolean;
  size?: AvatarSize;
  /**
   * The brand behind the booking, when the caller has already resolved it.
   * A long list resolves every row once in its parent and passes it here, so
   * a row does not subscribe to the provider; anywhere else, leave it out and
   * the avatar looks the brand up itself.
   */
  merchant?: Merchant | null;
};

/**
 * The company mark when the counterparty was recognised, otherwise a
 * monogram. A logo that fails to load falls back to the monogram too, so a
 * broken image can never replace a booking's identity with an empty box.
 *
 * Decorative for assistive tech: the name beside it already says who.
 */
export function CounterpartyAvatar({ merchant, ...props }: AvatarProps) {
  // Two components rather than a conditional hook: whether the caller
  // resolved the brand is fixed per call site, so this never switches.
  return merchant !== undefined ? <AvatarFace merchant={merchant} {...props} /> : <LookedUpAvatar {...props} />;
}

function LookedUpAvatar(props: Omit<AvatarProps, 'merchant'>) {
  const merchant = useMerchant(props.tx);
  return <AvatarFace merchant={merchant} {...props} />;
}

function AvatarFace({
  merchant, name, credit = false, pending = false, size: requested = 'md',
}: Omit<AvatarProps, 'merchant'> & { merchant: Merchant | null }) {
  // The logo that failed, rather than a flag: when the booking's brand
  // changes (the merchant table arrives late), the new mark gets its chance.
  const [broken, setBroken] = useState<string | null>(null);
  const logo = merchant?.logo ?? '';
  const probe = useEarlyFailure(() => setBroken(logo), logo);
  const size = SIZE[requested];

  if (merchant && broken !== merchant.logo) {
    return (
      // The badge has to sit outside the tile: the tile clips its overflow so a
      // wordmark can't escape it, and the provider mark deliberately does.
      <span
        aria-hidden
        title={merchant.via ? `${merchant.label} · über ${merchant.via.label}` : merchant.label}
        className="relative shrink-0"
      >
        {/* A rounded tile rather than the circle used for initials: some
            marks are horizontal wordmarks, which a circle would crop to
            nothing. The tile stays white in both themes — company marks are
            drawn for white backgrounds, and a navy wordmark would vanish on
            the dark surface. */}
        <span className={cx('flex items-center justify-center overflow-hidden border border-line bg-white', TILE[size])}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={probe}
            src={logoSrc(merchant.logo)}
            alt=""
            onError={() => setBroken(merchant.logo)}
            // Bounded on both axes so a tall mark letterboxes instead of being
            // cropped by the tile. Deliberately not `loading="lazy"`: an <img>
            // that is 0×0 until it loads gets skipped by the lazy loader and then
            // never loads at all.
            className="max-h-full max-w-full object-contain"
          />
        </span>

        {merchant.via && <ViaBadge via={merchant.via} size={size} />}
      </span>
    );
  }

  // The counterparty's monogram, whichever way the money went: the circle is
  // there to give the row a face to scan for, and an arrow repeated down every
  // debit says nothing the amount's own sign has not already said. A credit's
  // circle takes the credit tint; a Vormerkposten's the amber of "vorgemerkt".
  // The plain one gets a hairline: on the dark surface --inset alone is only
  // a shade off, and the circle would dissolve into the row.
  return (
    <span
      aria-hidden
      className={cx(
        'grid shrink-0 place-items-center rounded-full font-semibold',
        MONOGRAM[size],
        pending
          ? 'bg-amber-soft text-amber'
          : credit
            ? 'bg-green-soft text-green'
            : 'border border-line bg-inset text-ink-2',
      )}
    >
      {initials(name)}
    </span>
  );
}
