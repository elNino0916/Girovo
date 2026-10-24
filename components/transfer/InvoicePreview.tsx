'use client';

// "Rechnung ohne GiroCode" (owner's pick "Rechnung daneben", 2026-10-24): the
// invoice's page beside what the transfer took from it. The page as a
// thumbnail at the head of the payee's part, the lines the reading took
// (lib/invoice-text.ts: payee, invoice number, amount, IBAN) boxed in the
// primary, so the user can hold the form against the paper; a press opens it
// large. Beside it the amount and the account it leaves, with the way back
// to change them. The picture stays on the phone and goes when the sheet does.

import { useState } from 'react';
import { useT } from '@/lib/i18n/react';
import { Money } from '../Money';
import { ExpandIcon, InfoIcon } from '../icons';
import { Button, Overlay, Sheet, cx } from '../ui';
import type { InvoiceField, InvoicePage } from './GiroCodeDrop';

export function InvoicePreview({
  page, amount, currency, account, onChangeAmount,
}: {
  page: InvoicePage;
  /** The amount in the form, or null while there is none. */
  amount: number | null;
  currency?: string;
  account: string;
  onChangeAmount: () => void;
}) {
  const t = useT();
  const words = t.transfer.invoice;
  const [large, setLarge] = useState(false);

  return (
    <div className="mb-6 flex gap-5">
      <button
        type="button"
        onClick={() => setLarge(true)}
        aria-label={words.enlarge}
        className="relative w-[150px] shrink-0 overflow-hidden rounded-[12px] bg-white shadow-[inset_0_0_0_1px_var(--line)]"
        style={{ aspectRatio: `${page.width} / ${page.height}` }}
      >
        <PageWithBoxes page={page} />
        <span aria-hidden className="absolute right-2 bottom-2 grid size-10 place-items-center rounded-full bg-[color-mix(in_srgb,var(--ink)_70%,transparent)] text-paper">
          <ExpandIcon size={20} />
        </span>
      </button>
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="text-[14px] leading-5 text-ink-2">{words.amount}</p>
        {amount != null ? (
          <p data-figure className="mt-0.5">
            <Money value={amount} currency={currency} tone="plain" className="text-[32px] leading-10 font-medium text-ink" />
          </p>
        ) : (
          <p className="mt-0.5 text-[16px] leading-6 text-ink-2">{words.noAmount}</p>
        )}
        <p className="mt-1 text-[16px] leading-6 text-ink-2">{words.from(account)}</p>
        <Button size="sm" variant="tertiary" className="-ml-3 self-start" onClick={onChangeAmount}>{words.change}</Button>
        <p className="mt-auto pt-3 text-[14px] leading-5 text-ink-2">{words.marked}</p>
      </div>

      {large && (
        <Overlay open onClose={() => setLarge(false)} label={words.title} align="bottom">
          <Sheet size="lg" onClose={() => setLarge(false)}>
            <h2 className="text-[22px] leading-7 font-medium text-ink">{words.title}</h2>
            <p className="mt-1 text-[14px] leading-5 text-ink-2">{words.marked}</p>
            <div
              className="relative mt-4 w-full overflow-hidden rounded-[12px] bg-white shadow-[inset_0_0_0_1px_var(--line)]"
              style={{ aspectRatio: `${page.width} / ${page.height}` }}
            >
              <PageWithBoxes page={page} />
            </div>
          </Sheet>
        </Overlay>
      )}
    </div>
  );
}

/**
 * The desktop (owner's pick "Rechnung daneben", 2026-10-24): the page beside
 * the transfer at a size it can be read at, the lines the reading took boxed,
 * and the box of the field in use lit — the IBAN's while the IBAN is being
 * checked — so the form is held against the paper line by line.
 */
export function InvoicePane({ page, hot }: { page: InvoicePage; hot: InvoiceField | null }) {
  const words = useT().transfer.invoice;
  const box = hot ? page.marks[hot] : undefined;
  return (
    <figure className="m-0">
      {/* A whole page at the pane's width sets its text at a few pixels: the
          line the field in use came from, magnified above it, is what the
          form is checked against. A picture for the eye; the form says it. */}
      {box && (
        <div aria-hidden className="sticky top-0 z-1 -mx-1 mb-4 rounded-[14px] bg-inset px-1 pb-1">
          <p className="pb-1.5 text-[13px] leading-5 font-medium text-ink-2">{words.lens}</p>
          <Lens page={page} box={box} />
        </div>
      )}
      <div
        className="relative w-full overflow-hidden rounded-[8px] bg-white shadow-[0_1px_3px_rgb(0_0_0/0.18)]"
        style={{ aspectRatio: `${page.width} / ${page.height}` }}
      >
        <PageWithBoxes page={page} hot={hot} />
      </div>
      <figcaption className="mt-3 flex items-start gap-1.5 text-[13.5px] leading-snug text-ink-2">
        <InfoIcon size={17} className="mt-px shrink-0" />
        <span className="min-w-0 break-words">{page.name ? `${page.name} · ${words.marked}` : words.marked}</span>
      </figcaption>
    </figure>
  );
}

/** The inner width of the pane's column (Panel: 500px less 28px either side). */
const LENS_WIDTH = 444;

/**
 * One line of the page, as large as the pane allows — at most three and a
 * half times the whole page's scale, so a short line does not blur into
 * pixels — with its box drawn round it as on the page.
 */
function Lens({ page, box: [l, t, r, b] }: { page: InvoicePage; box: [number, number, number, number] }) {
  // Room round the line: wide at its ends, narrow above and below, so the
  // neighbouring lines stay out of the lens.
  const padX = Math.max(6, (b - t) * 0.6);
  const padY = Math.max(3, (b - t) * 0.18);
  const left = Math.max(0, l - padX);
  const top = Math.max(0, t - padY);
  const width = Math.min(page.width, r + padX) - left;
  const height = Math.min(page.height, b + padY) - top;
  const scale = Math.min(LENS_WIDTH / width, (LENS_WIDTH / page.width) * 3.5);
  const offset = (LENS_WIDTH - width * scale) / 2;
  return (
    <div className="relative overflow-hidden rounded-[10px] bg-white" style={{ width: LENS_WIDTH, height: height * scale }}>
      <img
        src={page.url}
        alt=""
        className="absolute max-w-none"
        style={{ width: page.width * scale, height: page.height * scale, left: offset - left * scale, top: -top * scale }}
      />
      <span
        className="absolute rounded-[3px] bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] shadow-[0_0_0_2px_var(--accent)]"
        style={{ left: offset + (l - left) * scale, top: (t - top) * scale, width: (r - l) * scale, height: (b - t) * scale }}
      />
    </div>
  );
}

/** The page and, over it, a box round every line the reading took; the one in use, if any, lit. */
function PageWithBoxes({ page, hot = null }: { page: InvoicePage; hot?: InvoiceField | null }) {
  const marks = Object.entries(page.marks) as [InvoiceField, [number, number, number, number]][];
  return (
    <>
      {/* The user's own picture of their invoice; described by the button or heading around it. */}
      <img src={page.url} alt="" className="absolute inset-0 size-full object-contain" />
      {marks.map(([field, [l, top, r, b]]) => (
        <span
          key={field}
          aria-hidden
          className={cx(
            'absolute rounded-[3px] transition-[background-color,box-shadow] duration-150',
            field === hot
              ? 'bg-[color-mix(in_srgb,var(--accent)_24%,transparent)] shadow-[0_0_0_2.5px_var(--accent)]'
              : 'bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] shadow-[0_0_0_1.5px_var(--accent)]',
          )}
          style={{
            left: `${(l / page.width) * 100}%`,
            top: `${(top / page.height) * 100}%`,
            width: `${((r - l) / page.width) * 100}%`,
            height: `${((b - top) / page.height) * 100}%`,
          }}
        />
      ))}
    </>
  );
}
