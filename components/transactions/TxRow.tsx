'use client';

import { memo } from 'react';
import { categoryLabel, txKey, type CategoryId, type CategoryPart } from '@/lib/categories';
import type { Merchant, SerializedTransaction } from '@/lib/fints-types';
import { useT } from '@/lib/i18n/react';
import { maskAmounts } from '@/lib/mask';
import { BankText } from '../BankText';
import { CategoryIcon, NoteIcon, PaperclipIcon, PieIcon } from '../icons';
import { Money, usePrivacy } from '../Money';
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
  tx, merchant, category, parts, userNote, receipt = false, pending = false, compact = false, onOpen,
}: {
  tx: SerializedTransaction;
  merchant: Merchant | null;
  category?: CategoryId | null;
  /** The shares of a booking the user split up (lib/splits.ts), largest first — the row names them all. */
  parts?: readonly CategoryPart[];
  /** The user's own note on the booking (lib/notes.ts): marked beside the name, read in the drawer. */
  userNote?: string;
  /** A receipt is attached to it (lib/doc-store.ts): marked beside the name, opened in the drawer. */
  receipt?: boolean;
  pending?: boolean;
  /** The narrower Vorgemerkt panel: tighter padding, no category. */
  compact?: boolean;
  onOpen: (tx: SerializedTransaction) => void;
}) {
  const t = useT();
  const { name, summary, bankName } = txText(tx);
  const credit = tx.amount > 0;
  // A booked row leaves its Wertstellung to its details; a Buchungstag still
  // ahead it keeps — that one changes what the row means.
  const fullNote = rowNote(tx, pending);
  const note = !pending && fullNote?.kind === 'value' ? null : fullNote;
  // A split booking always says so: the shares are the user's own doing.
  const split = !compact && parts && parts.length > 1 ? parts : null;
  const showCategory = !compact && category && (split || !QUIET_CATEGORIES.has(category));
  const categoryText = split
    ? t.transactions.split.summary(categoryLabel(split[0].id), categoryLabel(split[1].id), split.length - 2)
    : category ? categoryLabel(category) : '';
  const categoryTitle = split ? t.transactions.split.summaryLabel(split.map((p) => categoryLabel(p.id))) : categoryText;

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
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className="min-w-0 truncate text-[15px] leading-snug font-semibold text-ink"
            title={bankName && bankName !== name ? t.transactions.row.perBank(bankName) : undefined}
          >
            {name}
          </span>
          {userNote && <NoteMark note={userNote} />}
          {receipt && (
            <span className="inline-flex shrink-0 text-ink-3">
              <PaperclipIcon size={14} />
              <span className="sr-only">{t.docs.receipts.marker}</span>
            </span>
          )}
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
                <span title={categoryTitle} className="inline-flex shrink-0">
                  {split ? <PieIcon size={14} /> : <CategoryIcon id={category} size={14} />}
                </span>
                {/* Beside prose on a phone the glyph stands in for the word; the
                    word is still there for a screen reader. */}
                <span className={cx('min-w-0 truncate', summary && 'max-sm:sr-only')}>
                  {split ? <><span className="sr-only">{categoryTitle}</span><span aria-hidden>{categoryText}</span></> : categoryText}
                </span>
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

/**
 * The mark of a booking the user wrote a note on: a quiet glyph after the
 * name, "Mit Notiz" to a screen reader, the note itself as its tooltip — with
 * the amounts in it masked while "Beträge ausblenden" is on. Its own
 * component, so only the mark (not the memoised row) follows that mode.
 */
function NoteMark({ note }: { note: string }) {
  const t = useT();
  const privacy = usePrivacy();
  return (
    <span className="inline-flex shrink-0 text-ink-3" title={privacy ? maskAmounts(note) : note}>
      <NoteIcon size={14} />
      <span className="sr-only">{t.budgets.notes.marker}</span>
    </span>
  );
}

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
