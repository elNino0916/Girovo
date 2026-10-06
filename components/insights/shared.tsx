'use client';

// Small pieces the analysis and the contracts views share: dates in words,
// the counterparty's face, and the one button that asks the bank for a longer
// history.

import { useCallback, useId, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useFints } from '../FintsProvider';
import { maskedLabel, maskedMoney, usePrivacy } from '../Money';
import { Button, TileHeader, cx } from '../ui';
import { CalendarIcon } from '../icons';
import { fmtDayShort } from '@/lib/analytics';
import type { TxFilter } from '@/lib/app-types';
import type { SerializedTransaction } from '@/lib/fints-types';
import { dayKey, dayNumber, fmtDate, presetRange, toLocalDate } from '@/lib/format';
import { intlLocale, msgs } from '@/lib/i18n';
import { useLocale, useT } from '@/lib/i18n/react';

/**
 * "28.09.2026" ("28/09/2026") from a local day key — never through
 * `new Date('yyyy-mm-dd')`, which is UTC.
 */
export function fmtDayKey(key: string): string {
  return fmtDate(toLocalDate(key));
}

/** "28.09." ("28 Sept"). */
export function fmtDayKeyShort(key: string): string {
  return fmtDayShort(key);
}

/** "Mo." ("Mon") — the weekday of a day key, short. */
export function fmtWeekday(key: string): string {
  const d = toLocalDate(key);
  return d ? new Intl.DateTimeFormat(intlLocale(), { weekday: 'short' }).format(d) : '';
}

/** "Mo. 05.10." ("Mon 5 Oct") — for a short list of upcoming dates where the weekday helps. */
export function fmtWeekdayShort(key: string): string {
  const d = toLocalDate(key);
  if (!d) return '';
  return `${fmtWeekday(key)} ${fmtDayShort(key)}`;
}

/** Whole calendar days from today to `key` (negative: in the past). */
export function daysUntil(key: string, today: Date = new Date()): number {
  return dayNumber(key) - dayNumber(dayKey(today));
}

/** "heute", "morgen", "in 5 Tagen", "gestern", "vor 3 Tagen" — in the language speaking right now. */
export function relativeDays(key: string, today: Date = new Date()): string {
  const words = msgs().insights.relative;
  const n = daysUntil(key, today);
  if (n === 0) return words.today;
  if (n === 1) return words.tomorrow;
  if (n === -1) return words.yesterday;
  return n > 0 ? words.inDays(n) : words.daysAgo(-n);
}

/** Days covered by a loaded range, both ends included. */
export const spanDays = (from: string, to: string) => dayNumber(dayKey(to)) - dayNumber(dayKey(from)) + 1;

/** A loaded history this long counts as "a year" — the 12-month button is not offered again. */
export const YEAR_SPAN = 360;

/**
 * The counterparty's face — the very component the booking rows use, so a
 * contract and its bookings are recognisably the same counterparty.
 */
export { CounterpartyAvatar } from '../transactions/Avatar';

/**
 * "Umsätze für 12 Monate abrufen" with its honest small print. Applies the
 * range like the Umsätze period control does — an explicit action that may
 * need a TAN, for the active account. Hidden once a year is loaded.
 */
export function LoadHistoryButton({
  className, size = 'sm', variant = 'secondary', layout = 'inline', flush,
}: {
  className?: string;
  size?: 'sm' | 'md';
  variant?: 'secondary' | 'tertiary';
  /** A tertiary button whose label lines up with the text around it (pulls in its own padding). */
  flush?: boolean;
  /** inline: hint beside the button (wraps under it when narrow) · stacked: hint below · centered: below, centred (empty states). */
  layout?: 'inline' | 'stacked' | 'centered';
}) {
  const { applyRange, busy, loadingAccount, activeAccount } = useFints();
  const t = useT();
  const loading = !!activeAccount && loadingAccount === activeAccount.accountNumber;
  const target = useMemo(() => presetRange('365d'), []);
  return (
    <div
      className={cx(
        'flex flex-wrap gap-x-3 gap-y-1.5',
        layout === 'inline' ? 'items-center' : layout === 'stacked' ? 'flex-col items-start' : 'flex-col items-center text-center',
        className,
      )}
    >
      <Button
        size={size}
        variant={variant}
        iconLeft={<CalendarIcon size={16} />}
        busy={loading}
        disabled={busy}
        className={flush ? '-ml-4' : undefined}
        onClick={() => applyRange(target)}
      >
        {t.insights.loadYear.label}
      </Button>
      <span className="text-[13px] leading-snug text-ink-3">
        {t.insights.loadYear.hint}
      </span>
    </div>
  );
}

const MINUS = '\u2212';

/**
 * An estimate in whole euros — "1.316 €" after a "ca." the caller sets. A
 * figure worked out from a rhythm has no cents worth showing; cents would
 * claim a precision the estimate does not have. Masked like every amount
 * under "Beträge ausblenden" (the value is then not in the DOM at all).
 */
export function RoundMoney({
  value, currency = 'EUR', signed = false, className,
}: { value: number; currency?: string; signed?: boolean; className?: string }) {
  const privacy = usePrivacy();
  // Read so a change of language renders the figure again ("1.316 \u20ac", "\u20ac1,316").
  useLocale();
  if (privacy) {
    return <span role="img" aria-label={maskedLabel()} className={cx('amount', className)}>{maskedMoney(currency)}</span>;
  }
  const whole = Math.round(Math.abs(value));
  let text: string;
  try {
    text = new Intl.NumberFormat(intlLocale(), { style: 'currency', currency, maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(whole);
  } catch {
    text = `${whole.toLocaleString(intlLocale())}\u00a0${currency}`;
  }
  const sign = whole === 0 ? '' : value < 0 ? MINUS : signed ? '+' : '';
  return <span className={cx('amount', className)}>{sign}{text}</span>;
}

/**
 * A full-width tile of the analysis tabs. Same as `Tile`, with the 24px side
 * padding the wide tiles use on larger screens (the sidebar tiles keep 20px),
 * so a header, its rows and their hairlines share one left edge.
 */
export function InsightTile({
  title, subtitle, actions, className, children,
}: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; className?: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className={cx('panel overflow-hidden', className)} aria-labelledby={id}>
      <TileHeader title={title} titleId={id} subtitle={subtitle} actions={actions} className="px-4 pt-4 pb-3 sm:px-6 sm:pt-5" />
      {children}
    </section>
  );
}

/**
 * "Umsätze anzeigen" from a view that spans several accounts: opens the
 * Umsätze list filtered, on the account the booking came from.
 *
 * Switching accounts only happens when that account's bookings are cached
 * for the applied range — a switch that would have to ask the bank again
 * (and maybe for a TAN) is not something a "show me" click may set off. In
 * that case the list opens on the active account, with the filter set.
 */
export function useShowInList() {
  const {
    txByAccount, accounts, activeAccount, busy, isLoadedForAppliedRange, selectAccount, showTransactions,
  } = useFints();
  return useCallback((tx: SerializedTransaction | null, filter: Partial<TxFilter>) => {
    if (tx && activeAccount && !busy) {
      const owner = Object.keys(txByAccount).find((a) => txByAccount[a].includes(tx));
      if (owner && owner !== activeAccount.accountNumber) {
        const account = accounts.find((a) => a.accountNumber === owner);
        // The provider's own answer, midnight included: a range that ran
        // "until today" yesterday is loaded anew today.
        if (account && isLoadedForAppliedRange(owner)) selectAccount(account);
      }
    }
    showTransactions(filter);
  }, [txByAccount, accounts, activeAccount, busy, isLoadedForAppliedRange, selectAccount, showTransactions]);
}

/**
 * Where focus goes when the row holding it is about to disappear (a series
 * marked "Kein Vertrag" or restored): the neighbouring row, else the list's
 * heading — never the document body, where a keyboard user would have to
 * start over from the top.
 */
export function focusAfterRemoval(row: HTMLElement | null) {
  if (!row) return;
  const next = row.nextElementSibling ?? row.previousElementSibling;
  const neighbour = next?.querySelector<HTMLElement>('button, [tabindex]') ?? null;
  const heading = row.closest('section')?.querySelector<HTMLElement>('h2') ?? null;
  // After the removal has rendered; the menu has already put focus back on its trigger.
  setTimeout(() => {
    const target = [neighbour, heading, document.querySelector<HTMLElement>('[data-focus-fallback]')]
      .find((el) => el?.isConnected);
    if (!target) return;
    if (!target.matches('button, a, input, [tabindex]')) target.setAttribute('tabindex', '-1');
    target.focus();
  }, 0);
}
