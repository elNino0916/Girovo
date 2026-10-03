'use client';

// Every amount on screen goes through here, so three rules hold everywhere:
//
// - The sign is a real minus (U+2212), never a hyphen: a hyphen is narrower
//   than a digit and sits too low, which is exactly wrong in a column of
//   tabular figures. A credit may carry an explicit "+".
// - Colour follows the value's role, not its sign alone. A negative BALANCE is
//   red (it is a problem); a debit BOOKING is ink (it is ordinary spending);
//   a credit booking is green. The caller says which one it is showing.
// - "Beträge ausblenden" replaces the figure with dots. The value is then not
//   in the DOM at all — not in a title, not in an aria-label — so it cannot be
//   read off a screen share, a screenshot or the accessibility tree.

import { useCallback, useContext } from 'react';
import { splitMoney } from '@/lib/format';
import { FintsContext } from './FintsProvider';
import { cx } from './ui';

const MINUS = '−';
const NBSP = ' ';
const MASK = '•••••';

/** What a masked amount reads as, for the few places that announce one. */
export const MASKED_LABEL = 'Betrag ausgeblendet';

/** "€", "$", "CHF" — the mark an amount in `currency` is written with. */
export function currencyMark(currency: string): string {
  if (currency === 'EUR') return '€';
  try {
    const part = new Intl.NumberFormat('de-DE', { style: 'currency', currency })
      .formatToParts(0)
      .find((p) => p.type === 'currency');
    return part?.value ?? currency;
  } catch {
    return currency;
  }
}

/** The sign a value is shown with — none for zero, even a negative-rounding one. */
function signOf(value: number, signed: boolean): string {
  const cents = Math.round(value * 100);
  if (cents < 0) return MINUS;
  if (cents > 0 && signed) return '+';
  return '';
}

/**
 * The unmasked text of an amount: "−1.234,56 €", "+12,00 €". For the places
 * that must show the figure regardless of "Beträge ausblenden" — the transfer
 * review, a printed document. Everything else uses <Money> or useMoneyText.
 */
export function formatMoney(value: number, currency = 'EUR', opts: { signed?: boolean } = {}): string {
  let abs: string;
  try {
    abs = new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(Math.abs(value));
  } catch {
    abs = `${new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(value))}${NBSP}${currency}`;
  }
  return signOf(value, !!opts.signed) + abs;
}

export const maskedMoney = (currency = 'EUR') => `${MASK}${NBSP}${currencyMark(currency)}`;

/** Whether amounts are hidden right now. Outside the provider (a print sheet, a gallery) they are not. */
export function usePrivacy(): boolean {
  return useContext(FintsContext)?.privacy ?? false;
}

export type MoneyTone = 'auto' | 'plain' | 'credit';

export function Money({
  value, currency = 'EUR', signed = false, tone = 'auto', split = false, masked, className, centsClassName,
}: {
  value: number | null | undefined;
  currency?: string;
  /** Put a "+" on positive values (bookings). Negatives always carry the minus. */
  signed?: boolean;
  /**
   * auto — a balance: red when negative, otherwise the surrounding ink.
   * credit — a booking: green when positive (a Gutschrift), ink when negative.
   * plain — never coloured.
   */
  tone?: MoneyTone;
  /** Euros at full size, cents and currency smaller — the hero figure. */
  split?: boolean;
  /**
   * Override "Beträge ausblenden": false shows the figure anyway (the transfer
   * review — an explicit action the user is checking), true always masks.
   */
  masked?: boolean;
  className?: string;
  /** Size of the cents part when split (default 0.58em). */
  centsClassName?: string;
}) {
  const privacy = usePrivacy();
  const hidden = masked ?? privacy;

  if (hidden) {
    return (
      <span role="img" aria-label={MASKED_LABEL} className={cx('amount', className)}>
        {maskedMoney(currency)}
      </span>
    );
  }

  if (value == null || Number.isNaN(value)) {
    return <span className={cx('amount text-ink-3', className)}>–</span>;
  }

  const cents = Math.round(value * 100);
  const color =
    tone === 'auto' ? (cents < 0 ? 'text-red' : undefined)
      : tone === 'credit' ? (cents > 0 ? 'text-green' : undefined)
        : undefined;
  const sign = signOf(value, signed);

  if (!split) {
    return <span className={cx('amount', color, className)}>{formatMoney(value, currency, { signed })}</span>;
  }

  const parts = splitMoney(Math.abs(value), currency);
  return (
    <span className={cx('amount', color, className)}>
      {sign}
      {parts.euros}
      <span className={centsClassName ?? 'text-[0.58em]'}>
        {parts.cents}
        {NBSP}
        {parts.suffix}
      </span>
    </span>
  );
}

/**
 * An amount as plain text that honours "Beträge ausblenden" — for a title, an
 * aria-label, a toast, a chart label, the document title.
 */
export function useMoneyText(): (value: number, currency?: string, opts?: { signed?: boolean; masked?: boolean }) => string {
  const privacy = usePrivacy();
  return useCallback(
    (value, currency = 'EUR', opts = {}) =>
      (opts.masked ?? privacy) ? maskedMoney(currency) : formatMoney(value, currency, { signed: opts.signed }),
    [privacy],
  );
}
