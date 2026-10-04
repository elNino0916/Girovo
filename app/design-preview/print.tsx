'use client';

// The printed Kontoauszug and Buchungsbeleg, on screen — for looking at and
// screenshotting them without a printer. The mock's own printStatement /
// printTransaction only toast (a print dialog over every screenshot would be
// worse), so these views build the same PrintJob the real provider builds,
// from the mock's state, and hand it to the real sheet (DocumentPreview from
// components/Statement.tsx) at A4 width.
//
// Printing one of these pages (Strg+P) gives the real pages, page marks
// included: the preview frame drops away on paper.

import { useEffect, useMemo, useState } from 'react';
import { useFints, type PrintJob } from '@/components/FintsProvider';
import { DocumentPreview } from '@/components/Statement';
import type { StatementInfo } from '@/lib/app-types';
import type { SerializedBalance, SerializedTransaction } from '@/lib/fints-types';
import { isFutureDate, isoDate } from '@/lib/format';

/**
 * Which document, and for the receipt which booking of the mock data:
 *   statement             the active account's Kontoauszug for the loaded range
 *   statement-no-opening  …as from a bank that sends no statement balances: the
 *                         old balance is worked out and marked so
 *   statement-difference  …with a closing balance 0,10 off what the bookings
 *                         explain: the sheet prints the difference, not a fit
 *   receipt               a Basislastschrift (creditor ID, mandate, End-to-End reference)
 *   credit                the salary — a Gutschrift
 *   card                  a Visa Debit payment through the card processor, in US dollars
 *   ahead                 the card payment the bank already dates to the next business day
 *   pending               a Vormerkposten
 */
export type PrintPreviewKind =
  | 'statement' | 'statement-no-opening' | 'statement-difference'
  | 'receipt' | 'credit' | 'card' | 'ahead' | 'pending';

const newest = (txs: readonly SerializedTransaction[], pred: (t: SerializedTransaction) => boolean) =>
  txs.find(pred) ?? null;

/** The newest statement block's closing balance — what the provider prints for a past range. */
function closingOf(info: StatementInfo, currency: string): SerializedBalance | null {
  let best: StatementInfo['blocks'][number] | null = null;
  for (const b of info.blocks) {
    if (b.closingBalance == null) continue;
    if (!best || (b.closingDate ?? '') >= (best.closingDate ?? '')) best = b;
  }
  return best && best.closingBalance != null
    ? { balance: best.closingBalance, currency: best.currency || currency, date: best.closingDate ?? info.to, availableAmount: null }
    : null;
}

/** An A4 sheet's width in CSS pixels (210 mm at 96 dpi) — the .doc-paper width. */
const SHEET_PX = (210 / 25.4) * 96;

/** How far the sheet must shrink to fit the scroller's content box: 1 when it fits. */
function useFitToWidth(scroller: HTMLElement | null): number {
  const [fit, setFit] = useState(1);
  useEffect(() => {
    if (!scroller) return;
    const measure = () => {
      const cs = getComputedStyle(scroller);
      const room = scroller.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      setFit(Math.min(1, Math.max(0.25, room / SHEET_PX)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scroller);
    return () => ro.disconnect();
  }, [scroller]);
  return fit;
}

export function PrintPreview({ kind }: { kind: PrintPreviewKind }) {
  const { activeAccount, bank, transactions, balances, statementInfo, pendingCache } = useFints();

  // Built once per change of the data it reads: the sheet seals every new job.
  const job = useMemo((): PrintJob | null => {
    if (!activeAccount) return null;
    const acct = activeAccount.accountNumber;
    const info = statementInfo[acct];
    if (kind === 'statement' || kind === 'statement-no-opening' || kind === 'statement-difference') {
      const past = !!info && info.to < isoDate(new Date());
      const balance = past && info ? closingOf(info, activeAccount.currency) : balances[acct] ?? null;
      return {
        kind: 'statement',
        account: activeAccount,
        bank,
        transactions: transactions ?? [],
        balance: kind === 'statement-difference' && balance
          ? { ...balance, balance: Math.round(balance.balance * 100 + 10) / 100 }
          : balance,
        from: info?.from,
        to: info?.to,
        blocks: kind === 'statement-no-opening' ? null : info?.blocks ?? null,
      };
    }
    // Newest first, as the provider keeps them.
    const txs = transactions ?? [];
    const pending = kind === 'pending';
    const tx = pending
      ? (pendingCache[acct] ?? [])[0] ?? null
      : kind === 'credit'
        ? newest(txs, (t) => /GEHALT/i.test(t.bookingText) && t.amount > 0)
        : kind === 'card'
          ? newest(txs, (t) => !!t.ultimateName && /USD/.test(t.purpose)) ?? newest(txs, (t) => !!t.ultimateName)
          : kind === 'ahead'
            ? newest(txs, (t) => isFutureDate(t.entryDate))
            : newest(txs, (t) => !!t.creditorId && !!t.mandateReference && t.amount < 0);
    if (!tx) return null;
    return { kind: 'transaction', account: activeAccount, bank, tx, pending };
  }, [kind, activeAccount, bank, transactions, balances, statementInfo, pendingCache]);

  const [main, setMain] = useState<HTMLElement | null>(null);
  const fit = useFitToWidth(main);

  return (
    <main
      ref={setMain}
      data-scroll-root
      className="h-dvh overflow-auto bg-paper px-4 py-8 sm:px-8 print:h-auto print:overflow-visible print:bg-transparent print:p-0"
    >
      {job ? (
        // Scaled down (never up) to the window's width, so a narrow window
        // sees the whole A4 sheet instead of its left two thirds. Paper is
        // the real size again.
        <div className="[zoom:var(--fit)] print:[zoom:1]" style={{ ['--fit' as string]: fit }}>
          <DocumentPreview job={job} />
        </div>
      ) : (
        <p className="mx-auto max-w-[46ch] text-center text-[14px] text-ink-2">
          Für diesen Beleg gibt es in den Beispieldaten dieses Kontos keine passende Buchung.
        </p>
      )}
    </main>
  );
}
