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
import { ExpandIcon } from '../icons';
import { Button, Overlay, Sheet } from '../ui';
import type { InvoicePage } from './GiroCodeDrop';

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

/** The page and, over it, a box round every line the reading took. */
function PageWithBoxes({ page }: { page: InvoicePage }) {
  return (
    <>
      {/* The user's own picture of their invoice; described by the button or heading around it. */}
      <img src={page.url} alt="" className="absolute inset-0 size-full object-contain" />
      {page.boxes.map(([l, top, r, b], i) => (
        <span
          key={i}
          aria-hidden
          className="absolute rounded-[3px] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] shadow-[0_0_0_1.5px_var(--accent)]"
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
