'use client';

// The printable Kontoauszug / transaction receipt.
//
// No PDF library: this renders a print-only sheet (Tailwind's `print:` variant,
// hidden on screen) from data already sitting in memory, then calls
// window.print() — the browser's own "Save as PDF" target is the actual PDF
// generator. That keeps a local-only banking app from adding a renderer
// dependency (or a headless-Chromium one) just to lay out a table of numbers.

import { useEffect } from 'react';
import { fmtDate, fmtIban, fmtMoney, txTime } from '@/lib/format';
import type { SerializedTransaction } from '@/lib/fints-types';
import type { ChosenBank, PrintJob } from './FintsProvider';
import { useFints, useLogoFile } from './FintsProvider';

export function Statement() {
  const { printJob, closePrintJob } = useFints();

  useEffect(() => {
    if (!printJob) return;
    // Give the sheet a paint before invoking the system print dialog.
    const raf = requestAnimationFrame(() => window.print());
    const onAfterPrint = () => closePrintJob();
    window.addEventListener('afterprint', onAfterPrint);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('afterprint', onAfterPrint);
    };
  }, [printJob, closePrintJob]);

  if (!printJob) return null;

  return (
    <div className="hidden bg-white text-black print:block" style={{ fontFamily: 'var(--font-barlow), Arial, sans-serif' }}>
      {printJob.kind === 'statement' ? <StatementSheet job={printJob} /> : <TransactionSheet job={printJob} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared chrome
// ---------------------------------------------------------------------------

/** The app's own mark — a small co-branding credit, not the document's issuer. */
function AppMark() {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg viewBox="0 0 100 100" width="18" height="18" aria-hidden>
        <rect width="100" height="100" rx="22" fill="#0b5c42" />
        <text x="50" y="68" fontSize="52" fontFamily="Consolas, monospace" fontWeight="700" fill="#fff" textAnchor="middle">€</text>
      </svg>
      <span className="text-[11px] font-semibold tracking-tight text-neutral-700">Sooskasse-FinTS</span>
    </span>
  );
}

function SheetHeader({ bank, logoFile, title }: { bank: ChosenBank | null; logoFile?: string; title: string }) {
  return (
    <div className="mb-5 flex items-start justify-between border-b-2 border-black pb-3">
      <div className="flex items-center gap-3">
        {logoFile ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/logos/${logoFile}`} alt="" className="h-9 w-auto max-w-[130px] object-contain" />
        ) : (
          <span className="grid size-9 shrink-0 place-items-center rounded border border-black text-[15px] font-bold">
            {(bank?.name || '?').trim().slice(0, 1).toUpperCase()}
          </span>
        )}
        <div>
          <p className="text-[15px] font-semibold leading-tight">{bank?.name || 'Bank'}</p>
          {bank?.bic && <p className="num text-[11px] leading-tight text-neutral-600">BIC {bank.bic}</p>}
        </div>
      </div>
      <div className="text-right">
        <p className="text-[17px] font-bold tracking-wide uppercase">{title}</p>
        <div className="mt-1 flex justify-end">
          <AppMark />
        </div>
      </div>
    </div>
  );
}

function SheetFooter() {
  return (
    <div className="mt-8 border-t border-neutral-400 pt-2.5 text-[10px] leading-snug text-neutral-500">
      <p>
        Diese Aufstellung wurde über FinTS direkt von der kontoführenden Bank abgerufen und mit Sooskasse-FinTS
        erzeugt — sie ist kein amtlicher, von der Bank ausgestellter Kontoauszug.
      </p>
      <p className="num mt-0.5">
        Erstellt am {new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kontoauszug (date-range statement)
// ---------------------------------------------------------------------------

function periodOf(txs: SerializedTransaction[], from?: string, to?: string) {
  const dates = txs
    .map((t) => new Date(t.entryDate || t.valueDate))
    .filter((d) => !Number.isNaN(d.getTime()));
  if (dates.length) {
    return {
      from: new Date(Math.min(...dates.map((d) => d.getTime()))),
      to: new Date(Math.max(...dates.map((d) => d.getTime()))),
    };
  }
  return { from: from ? new Date(from) : null, to: to ? new Date(to) : null };
}

function StatementSheet({ job }: { job: PrintJob & { kind: 'statement' } }) {
  const { account, bank, balance, transactions, from, to } = job;
  const logoFile = useLogoFile(bank?.brand);
  const period = periodOf(transactions, from, to);
  const sorted = transactions.slice().sort((a, b) => txTime(a) - txTime(b));

  const closing = balance?.balance ?? null;
  const sum = transactions.reduce((s, t) => s + t.amount, 0);
  const opening = closing != null ? closing - sum : null;

  return (
    <article className="mx-auto max-w-[190mm] px-2 py-4 text-[12px] text-black">
      <SheetHeader bank={bank} logoFile={logoFile} title="Kontoauszug" />

      <div className="mb-4 flex flex-wrap justify-between gap-4">
        <div>
          <p className="text-[10px] tracking-wide text-neutral-500 uppercase">Kontoinhaber</p>
          <p className="font-semibold">{account.holder || '—'}</p>
          <p className="num mt-1 text-[11.5px]">{fmtIban(account.iban) || account.accountNumber}</p>
          {account.bic && <p className="num text-[11.5px] text-neutral-600">BIC {account.bic}</p>}
        </div>
        <div className="text-right">
          <p className="text-[10px] tracking-wide text-neutral-500 uppercase">Zeitraum</p>
          <p className="num font-semibold">
            {period.from ? fmtDate(period.from) : '—'} – {period.to ? fmtDate(period.to) : '—'}
          </p>
        </div>
      </div>

      <div className="mb-4 flex justify-between border border-black px-3 py-2 text-[11.5px]">
        <span>
          Alter Kontostand{period.from ? ` am ${fmtDate(period.from)}` : ''}
          {opening != null && <span className="num ml-2 font-semibold">{fmtMoney(opening, balance?.currency)}</span>}
        </span>
        <span>
          Neuer Kontostand{balance?.date ? ` am ${fmtDate(balance.date)}` : period.to ? ` am ${fmtDate(period.to)}` : ''}
          {closing != null && <span className="num ml-2 font-semibold">{fmtMoney(closing, balance?.currency)}</span>}
        </span>
      </div>

      <table className="w-full border-collapse text-[11.5px]">
        <thead>
          <tr className="border-b-2 border-black text-left text-[10px] tracking-wide text-neutral-600 uppercase">
            <th className="py-1.5 pr-2 font-semibold">Buchung</th>
            <th className="py-1.5 pr-2 font-semibold">Valuta</th>
            <th className="py-1.5 pr-2 font-semibold">Vorgang</th>
            <th className="py-1.5 pr-0 text-right font-semibold">Betrag</th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td colSpan={4} className="py-6 text-center text-neutral-500">Keine Umsätze in diesem Zeitraum.</td>
            </tr>
          )}
          {sorted.map((t, i) => (
            <tr key={`${t.bankReference}-${t.e2eReference}-${i}`} className="border-b border-neutral-300 align-top">
              <td className="num py-2 pr-2 whitespace-nowrap">{fmtDate(t.entryDate || t.valueDate)}</td>
              <td className="num py-2 pr-2 whitespace-nowrap">{fmtDate(t.valueDate)}</td>
              <td className="py-2 pr-2">
                <p className="font-semibold">{t.remoteName || t.bookingText || 'Buchung'}</p>
                {t.purpose && <p className="text-neutral-600">{t.purpose}</p>}
              </td>
              <td className="num py-2 pr-0 text-right font-semibold whitespace-nowrap">
                {t.amount >= 0 ? '+' : '−'}{fmtMoney(Math.abs(t.amount), t.currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <SheetFooter />
    </article>
  );
}

// ---------------------------------------------------------------------------
// Single-transaction receipt
// ---------------------------------------------------------------------------

function TransactionSheet({ job }: { job: PrintJob & { kind: 'transaction' } }) {
  const { account, bank, tx } = job;
  const logoFile = useLogoFile(bank?.brand);
  const credit = tx.amount >= 0;

  const rows: [string, string][] = [
    ['Konto', `${account.holder || ''} · ${fmtIban(account.iban) || account.accountNumber}`],
    ['Empfänger / Auftraggeber', tx.remoteName],
    ['IBAN', tx.remoteIban ? fmtIban(tx.remoteIban) : ''],
    ['BIC', tx.remoteBic],
    ['Buchungstag', fmtDate(tx.entryDate)],
    ['Wertstellung', fmtDate(tx.valueDate)],
    ['Verwendungszweck', tx.purpose],
    ['Buchungstext', tx.bookingText],
    ['End-to-End-Referenz', tx.e2eReference],
    ['Mandatsreferenz', tx.mandateReference],
    ['Kundenreferenz', tx.customerReference !== 'NONREF' ? tx.customerReference : ''],
    ['Bankreferenz', tx.bankReference],
    ['Geschäftsvorfallcode', tx.transactionCode],
    ['Primanota', tx.primeNotesNr],
  ];

  return (
    <article className="mx-auto max-w-[190mm] px-2 py-4 text-[12px] text-black">
      <SheetHeader bank={bank} logoFile={logoFile} title="Buchungsbeleg" />

      <p className="num mb-4 text-[26px] font-semibold">
        {credit ? '+' : '−'}{fmtMoney(Math.abs(tx.amount), tx.currency)}
      </p>

      <table className="w-full border-collapse text-[11.5px]">
        <tbody>
          {rows.filter(([, v]) => v).map(([label, value]) => (
            <tr key={label} className="border-b border-neutral-300">
              <td className="w-[38%] py-2 pr-3 align-top text-[10.5px] tracking-wide text-neutral-500 uppercase">{label}</td>
              <td className="py-2 align-top break-words">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <SheetFooter />
    </article>
  );
}
