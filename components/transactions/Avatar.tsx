'use client';

// The counterparty's face — one component for every place a booking or a
// series of bookings shows who the money went to or came from: the Umsätze
// rows, the detail drawer, the Vorgemerkt panel, the Analyse lists and the
// Verträge rows. One look everywhere, so a contract and its bookings are
// recognisably the same counterparty.

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { COMPACT_LOGO, DARK_INVERT, ON_DARK } from '@/lib/brands';
import { isBankOwnBooking } from '@/lib/categorize';
import { apiFetch } from '@/lib/client-api';
import type { Merchant, SerializedTransaction } from '@/lib/fints-types';
import { initials } from '@/lib/format';
import { useT } from '@/lib/i18n/react';
import { IS_ANDROID } from '@/lib/platform';
import { BankChip } from '../BankLogo';
import { useFints, useLogoFile, useMerchant } from '../FintsProvider';
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

/** Android: each logo once, as an object URL (null when there is none). */
const phoneLogos = new Map<string, Promise<string | null>>();

/**
 * Where an <img> gets the logo `id`. On the desktop that is the route itself.
 * In the Android app the route runs inside this page (mobile/server) and only
 * a fetch reaches it, so the bytes are fetched and handed to the <img> as an
 * object URL — undefined until they are in, `onFail` when there are none.
 */
function useLogoSrc(id: string, onFail: () => void): string | undefined {
  const [phoneSrc, setPhoneSrc] = useState<{ id: string; url: string } | null>(null);
  useEffect(() => {
    if (!IS_ANDROID || !id) return;
    let live = true;
    let pending = phoneLogos.get(id);
    if (!pending) {
      pending = apiFetch(logoSrc(id))
        .then((res) => (res.ok ? res.blob() : null))
        .then((blob) => (blob ? URL.createObjectURL(blob) : null))
        .catch(() => null);
      phoneLogos.set(id, pending);
    }
    void pending.then((url) => {
      if (!live) return;
      if (url) setPhoneSrc({ id, url });
      else onFail();
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (!IS_ANDROID) return logoSrc(id);
  return phoneSrc?.id === id ? phoneSrc.url : undefined;
}

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
  const src = useLogoSrc(via.logo, () => setBroken(true));
  if (broken) return null;
  return (
    <span
      className={cx(
        'absolute -right-1 -bottom-1 flex items-center justify-center overflow-hidden rounded-full border-2 border-surface bg-white',
        BADGE[size],
      )}
    >
      {/* Only with a source: an <img> without one counts as a failed load to the probe. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src && <img ref={probe} src={src} alt="" onError={() => setBroken(true)} className="max-h-full max-w-full object-contain" />}
    </span>
  );
}

type AvatarProps = {
  /** The booking (or a series' sample booking) the face belongs to. */
  tx: SerializedTransaction;
  /** The name the monogram is drawn from — the display name the row shows. */
  name: string;
  /** Money came in. (The disc no longer takes a tint for it: the amount says so in green.) */
  credit?: boolean;
  /** A Vormerkposten: the monogram takes the amber of "vorgemerkt". */
  pending?: boolean;
  /**
   * The booking's category glyph, drawn in place of the initials when there
   * is no logo: a shop's initials say nothing, its category does. A person
   * (no category worth naming) keeps their initials.
   */
  glyph?: ReactNode;
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

/** The brand chip's square at each avatar size, cornered like the logo tile. */
const CHIP = {
  sm: 'size-8 rounded-[9px]',
  md: 'size-10 rounded-[11px]',
  lg: 'size-14 rounded-[14px]',
} as const;

/**
 * A booking the bank made itself — the Abschluss, a fee, interest — shows the
 * bank's own mark: there the bank is the counterparty, so its mark is the
 * subject. A compact logo file is drawn as every bank logo is (.logo-img: a
 * light plate, navy and black marks flipped in dark mode); a wordmark would be unreadable this small, so there
 * the brand's chip stands in (lib/brands.ts COMPACT_LOGO). Only these rows
 * read the bank, so a long list stays off the provider. Without a bank, the
 * monogram stays.
 */
function BankOwnAvatar({ size, children }: { size: 'sm' | 'md' | 'lg'; children: ReactNode }) {
  // The bank of the account on screen — with more than one bank in the view, not always the first login's.
  const { bank: primary, activeBank } = useFints();
  const bank = activeBank?.bank ?? primary;
  const brand = bank?.brand ?? '';
  const file = useLogoFile(brand || undefined);
  const [broken, setBroken] = useState(false);
  const probe = useEarlyFailure(() => setBroken(true), file ?? '');
  if (!bank) return children;
  if (!file || broken || !COMPACT_LOGO.has(brand)) {
    return (
      <span aria-hidden title={bank.name} className="shrink-0">
        <BankChip brand={brand} className={CHIP[size]} />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      title={bank?.name}
      data-invert={DARK_INVERT.has(brand)}
      data-on-dark={ON_DARK.has(brand)}
      className={cx('logo-img flex shrink-0 items-center justify-center overflow-hidden', TILE[size])}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={probe}
        src={`/logos/${file}`}
        alt=""
        draggable={false}
        onError={() => setBroken(true)}
        className="max-h-full max-w-full object-contain"
      />
    </span>
  );
}

function AvatarFace({
  tx, merchant, name, pending = false, glyph, size: requested = 'md',
}: Omit<AvatarProps, 'merchant'> & { merchant: Merchant | null }) {
  const t = useT();
  // The logo that failed, rather than a flag: when the booking's brand
  // changes (the merchant table arrives late), the new mark gets its chance.
  const [broken, setBroken] = useState<string | null>(null);
  const logo = merchant?.logo ?? '';
  const probe = useEarlyFailure(() => setBroken(logo), logo);
  const logoUrl = useLogoSrc(logo, () => setBroken(logo));
  const size = SIZE[requested];

  if (merchant && broken !== merchant.logo) {
    return (
      // The badge has to sit outside the tile: the tile clips its overflow so a
      // wordmark can't escape it, and the provider mark deliberately does.
      <span
        aria-hidden
        title={merchant.via ? `${merchant.label} · ${t.transactions.via(merchant.via.label)}` : merchant.label}
        className="relative shrink-0"
      >
        {/* A rounded tile rather than the circle used for initials: some
            marks are horizontal wordmarks, which a circle would crop to
            nothing. The tile stays white in both themes — company marks are
            drawn for white backgrounds, and a navy wordmark would vanish on
            the dark surface. */}
        <span className={cx('flex items-center justify-center overflow-hidden border border-line bg-white', TILE[size])}>
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={probe}
              src={logoUrl}
              alt=""
              onError={() => setBroken(merchant.logo)}
              // Bounded on both axes so a tall mark letterboxes instead of being
              // cropped by the tile. Deliberately not `loading="lazy"`: an <img>
              // that is 0×0 until it loads gets skipped by the lazy loader and then
              // never loads at all.
              className="max-h-full max-w-full object-contain"
            />
          )}
        </span>

        {merchant.via && <ViaBadge via={merchant.via} size={size} />}
      </span>
    );
  }

  // Without a logo: the category's glyph when the caller names one, else the
  // counterparty's initials — a disc to scan down the column, whichever way
  // the money went. It stays neutral: the amount already says credit in
  // green, and a second green down the left edge would only repeat it. A
  // Vormerkposten's disc takes the amber of "vorgemerkt", its one meaning.
  const monogram = (
    <span
      aria-hidden
      className={cx(
        'grid shrink-0 place-items-center rounded-full font-semibold',
        MONOGRAM[size],
        pending ? 'bg-amber-soft text-amber' : 'bg-inset text-ink-2',
      )}
    >
      {glyph ?? initials(name)}
    </span>
  );
  return isBankOwnBooking(tx) ? <BankOwnAvatar size={size}>{monogram}</BankOwnAvatar> : monogram;
}
