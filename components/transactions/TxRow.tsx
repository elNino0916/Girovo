'use client';

import { memo } from 'react';
import { categoryLabel, txKey, type CategoryId } from '@/lib/categories';
import type { Merchant, SerializedTransaction } from '@/lib/fints-types';
import { useT } from '@/lib/i18n/react';
import { BankText } from '../BankText';
import { CategoryIcon } from '../icons';
import { Money } from '../Money';
import { Skeleton, cx } from '../ui';
import { CounterpartyAvatar } from './Avatar';
import { rowNote, txText } from './model';

// Categories that say nothing a row needs to repeat: "Sonstiges" under every
// unrecognised booking would be noise, not information.
const QUIET_CATEGORIES = new Set<CategoryId>(['other', 'otherIn']);

/**
 * One booking in a list: who, what for, how much. A full-width button — the
 * whole row opens the detail drawer — with its focus ring drawn inside, so
 * the tile's clipped corners cannot cut it off.
 *
 * Memoised on its props: the parent resolves the merchant and the category,
 * so a row does not subscribe to the provider and does not re-render when an
 * unrelated part of the app changes. It does read the language (useT): a
 * change of it renders every row again, summary and category included.
 */
export const TxRow = memo(function TxRow({
  tx, merchant, category, pending = false, compact = false, onOpen,
}: {
  tx: SerializedTransaction;
  merchant: Merchant | null;
  category?: CategoryId | null;
  pending?: boolean;
  /** The narrower Vorgemerkt panel: tighter padding, no category. */
  compact?: boolean;
  onOpen: (tx: SerializedTransaction) => void;
}) {
  const t = useT();
  const { name, summary, bankName } = txText(tx);
  const credit = tx.amount > 0;
  const note = rowNote(tx, pending);
  const showCategory = !compact && category && !QUIET_CATEGORIES.has(category);

  return (
    <button
      type="button"
      // Hooks for the design preview and tests: a row to click, and which booking it is.
      data-tx-row
      data-tx-key={txKey(tx)}
      onClick={() => onOpen(tx)}
      className={cx(
        // Hover is a half-step of the day band's fill, so a hovered row never
        // reads as one more header.
        'row-focus flex w-full items-center gap-3 text-left transition-colors duration-150',
        'hover:bg-[color-mix(in_srgb,var(--inset)_55%,var(--surface))]',
        compact ? 'min-h-[60px] px-4 py-2.5' : 'min-h-[64px] px-4 py-3 sm:px-5',
      )}
    >
      <CounterpartyAvatar tx={tx} merchant={merchant} name={name} credit={credit} pending={pending} />

      <span className="min-w-0 flex-1">
        {/* The tidied name; hovering shows what the bank's FinTS answer said. */}
        <span
          className="block truncate text-[15px] leading-snug font-semibold text-ink"
          title={bankName && bankName !== name ? t.transactions.row.perBank(bankName) : undefined}
        >
          {name}
        </span>
        {(summary || showCategory) && (
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] leading-snug text-ink-3">
            {/* Bank prose: an amount in it is masked with the row's own. */}
            {summary && <span className="min-w-0 truncate"><BankText text={summary} /></span>}
            {summary && showCategory && <span aria-hidden className="shrink-0">·</span>}
            {showCategory && (
              <span
                className={cx(
                  'inline-flex min-w-0 items-center gap-1',
                  // Prose first: when both don't fit, the category gives way
                  // only once the prose has had at least half the line.
                  summary ? 'shrink-0 sm:max-w-[50%]' : 'shrink',
                )}
              >
                <span title={categoryLabel(category)} className="inline-flex shrink-0">
                  <CategoryIcon id={category} size={14} />
                </span>
                {/* Beside prose on a phone the glyph stands in for the word; the
                    word is still there for a screen reader. */}
                <span className={cx('min-w-0 truncate', summary && 'max-sm:sr-only')}>{categoryLabel(category)}</span>
              </span>
            )}
          </span>
        )}
      </span>

      <span className="shrink-0 pl-1 text-right">
        <span className="sr-only">{credit ? t.common.booking.credit : t.common.booking.debit}</span>
        <Money
          value={tx.amount}
          currency={tx.currency}
          signed
          tone="credit"
          className="block text-[15px] leading-snug font-semibold"
        />
        {note && (
          <span title={note.title} className="tnum mt-0.5 block text-[12.5px] leading-snug text-ink-3">
            {note.text}
          </span>
        )}
      </span>
    </button>
  );
});

/** A placeholder row shaped like the real one — avatar, two lines, an amount. */
export function TxRowSkeleton({ width = 60, compact = false }: { width?: number; compact?: boolean }) {
  return (
    <div aria-hidden className={cx('flex items-center gap-3', compact ? 'min-h-[60px] px-4 py-2.5' : 'min-h-[64px] px-4 py-3 sm:px-5')}>
      <Skeleton circle className="size-10 shrink-0" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-3.5 rounded-full" width={`${width}%`} />
        <Skeleton className="mt-2 h-3 rounded-full" width={`${Math.max(22, width - 20)}%`} />
      </div>
      <Skeleton className="h-3.5 w-16 rounded-full" />
    </div>
  );
}
