'use client';

// The printable Kontoauszug / Buchungsbeleg.
//
// No PDF library: this renders a print-only sheet (Tailwind's `print:` variant,
// hidden on screen) from data already sitting in memory, then calls
// window.print() — the browser's own "Save as PDF" target is the actual PDF
// generator. That keeps a local-only banking app from adding a renderer
// dependency (or a headless-Chromium one) just to lay out a table of numbers.
//
// The layout follows the conventions of a printed German account statement,
// because those conventions are what make a page of figures readable: a
// letterhead that names the issuer, an addressed account block, framed opening
// and closing balances, amounts as bare figures in one tabular column with a
// Soll/Haben marker beside them, a totals block, and an explicit end marker so
// a reader can tell nothing is missing. Everything on the page is either data
// the bank sent or a fact about this export — the footer says plainly that the
// document was generated here and is not the bank's own statement.

import { useEffect } from 'react';
import { fmtDate, fmtDecimal, fmtIban, fmtMoney, translateType, txTime } from '@/lib/format';
import type { SerializedAccount, SerializedTransaction } from '@/lib/fints-types';
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
    <div className="sheet hidden bg-white text-black print:block" style={{ fontFamily: 'var(--font-barlow), Arial, sans-serif' }}>
      {printJob.kind === 'statement' ? <StatementSheet job={printJob} /> : <TransactionSheet job={printJob} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Document identity
// ---------------------------------------------------------------------------

/**
 * A stable reference for this export, printed in the footer.
 *
 * Real statements carry a document number so a reader can cite one sheet
 * unambiguously. This one is derived (FNV-1a) from the account and the exact
 * contents being printed, so the same data always yields the same reference and
 * two different exports never collide — it identifies *this document*, not a
 * position in any sequence the bank keeps.
 */
function docRef(kind: string, account: SerializedAccount, parts: string[]): string {
  let h = 0x811c9dc5;
  for (const chunk of [kind, account.iban || account.accountNumber, ...parts]) {
    for (let i = 0; i < chunk.length; i++) {
      h ^= chunk.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  const tag = (h >>> 0).toString(36).toUpperCase().padStart(7, '0').slice(0, 7);
  const today = new Date();
  const stamp = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  return `SK-${stamp}-${tag}`;
}

/** Soll (debit) / Haben (credit) — the marker a German statement puts beside a figure. */
const sh = (amount: number) => (amount < 0 ? 'S' : 'H');

/** The MT940 :28C: statement numbers actually present in the data, as a range. */
function statementNoRange(txs: SerializedTransaction[]): string | null {
  const nums = [...new Set(txs.map((t) => t.statementNumber).filter(Boolean))];
  if (!nums.length) return null;
  if (nums.length === 1) return nums[0];
  const sorted = nums.slice().sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  return `${sorted[0]}–${sorted[sorted.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Shared chrome
// ---------------------------------------------------------------------------

const HAIRLINE = 'border-neutral-300';

/** The app's own mark — a generator credit in the footer, not the issuer. */
function AppMark() {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg viewBox="0 0 100 100" width="14" height="14" aria-hidden>
        <rect width="100" height="100" rx="22" fill="#0b5c42" />
        <text x="50" y="68" fontSize="52" fontFamily="Consolas, monospace" fontWeight="700" fill="#fff" textAnchor="middle">€</text>
      </svg>
      <span className="text-[10px] font-semibold tracking-tight text-neutral-700">Sooskasse-FinTS</span>
    </span>
  );
}

/**
 * The letterhead: issuer on the left, document type and its identifying
 * numbers on the right, closed off by the heavy-over-hairline double rule that
 * printed forms use to separate the head from the body.
 */
function Letterhead({
  bank,
  logoFile,
  title,
  meta,
}: {
  bank: ChosenBank | null;
  logoFile?: string;
  title: string;
  meta: [string, string][];
}) {
  return (
    <header className="keep">
      <div className="flex items-start justify-between gap-6 pb-2">
        <div className="flex items-center gap-2.5">
          {logoFile ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/logos/${logoFile}`} alt="" className="h-8 w-auto max-w-[120px] object-contain" />
          ) : (
            <span className="grid size-8 shrink-0 place-items-center rounded-sm border border-black text-[14px] font-bold">
              {(bank?.name || '?').trim().slice(0, 1).toUpperCase()}
            </span>
          )}
          <div>
            {/* Named as the institution the account is held at — not as the
                document's author. The bank did not issue this sheet, and the
                letterhead is not allowed to imply that it did. */}
            <p className="text-[7px] leading-none font-semibold tracking-[0.13em] text-neutral-500 uppercase">
              Kontoführendes Institut
            </p>
            <p className="mt-[3px] text-[13px] leading-tight font-semibold">{bank?.name || 'Bank'}</p>
            <p className="num text-[9px] leading-tight tracking-wide text-neutral-600">
              {[bank?.bic ? `BIC ${bank.bic}` : null, bank?.blz ? `BLZ ${bank.blz}` : null].filter(Boolean).join('  ·  ')}
            </p>
          </div>
        </div>

        <div className="text-right">
          <p
            className="text-[22px] leading-none font-semibold tracking-[0.06em] uppercase"
            style={{ fontFamily: 'var(--font-barlow-condensed), Arial Narrow, sans-serif' }}
          >
            {title}
          </p>
          <div className="mt-1.5 flex justify-end gap-4">
            {meta.map(([label, value]) => (
              <div key={label}>
                <p className="text-[7.5px] leading-none font-semibold tracking-[0.13em] text-neutral-500 uppercase">{label}</p>
                <p className="num mt-0.5 text-[10px] leading-none font-semibold">{value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="h-[2px] bg-black" />
      <div className={`mt-[1.5px] border-t ${HAIRLINE}`} />
    </header>
  );
}

/** Label/value row of the account particulars table. */
function Particular({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <tr className={`border-b ${HAIRLINE}`}>
      <td className="py-[3px] pr-3 align-top text-[9px] leading-snug tracking-wide text-neutral-500 uppercase whitespace-nowrap">
        {label}
      </td>
      <td className={`py-[3px] text-right align-top text-[10px] leading-snug font-medium ${mono ? 'num' : ''}`}>{value}</td>
    </tr>
  );
}

/**
 * The addressed account block plus the particulars table — a statement's
 * "who and which account" half-page, laid out the way the window-envelope
 * version is: recipient on the left under a ruled sender line, account
 * particulars in a ruled column on the right.
 */
function AccountBlock({
  account,
  sender,
  particulars,
}: {
  account: SerializedAccount;
  /** The issuer line above the address field — this app, not the bank. */
  sender: string;
  particulars: [string, string][];
}) {
  return (
    <section className="mt-4 flex items-start justify-between gap-8">
      <div className="max-w-[92mm] pt-1">
        <p className={`num border-b ${HAIRLINE} pb-[3px] text-[7.5px] tracking-wide text-neutral-500`}>{sender}</p>
        <p className="mt-2 text-[7.5px] font-semibold tracking-[0.13em] text-neutral-500 uppercase">Kontoinhaber</p>
        <p className="mt-0.5 text-[13px] leading-tight font-semibold">{account.holder || '—'}</p>
        <p className="num mt-1 text-[10px] leading-tight text-neutral-600">
          {account.product || translateType(account.accountType)}
        </p>
      </div>

      <table className="w-[74mm] shrink-0 border-collapse">
        <tbody>
          {particulars.map(([label, value]) => (
            <Particular key={label} label={label} value={value} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * A framed balance line. The figure sits in a fixed-width right-hand column so
 * opening balance, transaction amounts and closing balance all line up on the
 * same decimal point down the page.
 */
function BalanceBand({
  label,
  date,
  amount,
  currency,
  strong = false,
}: {
  label: string;
  date?: string;
  amount: number | null;
  currency: string;
  strong?: boolean;
}) {
  return (
    <div
      className={`keep flex items-baseline justify-between gap-4 px-2.5 py-[7px] ${
        strong ? 'border-2 border-black bg-neutral-100' : `border ${HAIRLINE} bg-neutral-50`
      }`}
    >
      <span className={`text-[10.5px] ${strong ? 'font-semibold' : ''}`}>
        {label}
        {date && <span className="num ml-1.5 text-neutral-600">vom {date}</span>}
      </span>
      {amount != null ? (
        <span className="flex items-baseline gap-2">
          <span className={`num text-right tabular-nums ${strong ? 'text-[14px] font-bold' : 'text-[11.5px] font-semibold'}`}>
            {fmtDecimal(Math.abs(amount))}
          </span>
          <span className="num w-[9px] text-[10px] font-semibold">{sh(amount)}</span>
          <span className="num w-[24px] text-[9px] text-neutral-600">{currency}</span>
        </span>
      ) : (
        <span className="num text-[10px] text-neutral-500">nicht abgerufen</span>
      )}
    </div>
  );
}

/** The end-of-document marker: printed statements say where they stop. */
function EndMarker({ label }: { label: string }) {
  return (
    <div className="keep mt-4 flex items-center gap-2">
      <span className={`h-0 flex-1 border-t ${HAIRLINE}`} />
      <span className="text-[8px] font-semibold tracking-[0.16em] text-neutral-500 uppercase">{label}</span>
      <span className={`h-0 flex-1 border-t ${HAIRLINE}`} />
    </div>
  );
}

function SheetFooter({ docId, notes }: { docId: string; notes: string[] }) {
  const created = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
  return (
    <footer className="keep mt-3 border-t-2 border-black pt-2">
      <div className="flex items-start justify-between gap-8">
        <div className="max-w-[112mm] space-y-[3px] text-[8px] leading-snug text-neutral-600">
          <p className="font-semibold text-neutral-700">Hinweise</p>
          {notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
        <div className="shrink-0 text-right text-[8px] leading-snug text-neutral-600">
          <table className="border-collapse text-right">
            <tbody>
              <tr>
                <td className="pr-2 tracking-wide text-neutral-500 uppercase">Dokument</td>
                <td className="num font-semibold text-black">{docId}</td>
              </tr>
              <tr>
                <td className="pr-2 tracking-wide text-neutral-500 uppercase">Erstellt</td>
                <td className="num">{created}</td>
              </tr>
              <tr>
                <td className="pr-2 tracking-wide text-neutral-500 uppercase">Quelle</td>
                <td className="num">FinTS 3.0 · HKKAZ/HKSAL</td>
              </tr>
            </tbody>
          </table>
          <div className="mt-1.5 flex justify-end">
            <AppMark />
          </div>
        </div>
      </div>
    </footer>
  );
}

const DISCLAIMER =
  'Diese Aufstellung wurde über FinTS direkt von der kontoführenden Bank abgerufen und mit Sooskasse-FinTS erzeugt. Sie ist kein amtlicher, von der Bank ausgestellter Kontoauszug und ersetzt diesen nicht.';

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
  const credits = transactions.filter((t) => t.amount >= 0);
  const debits = transactions.filter((t) => t.amount < 0);
  const creditSum = credits.reduce((s, t) => s + t.amount, 0);
  const debitSum = debits.reduce((s, t) => s + t.amount, 0);
  const sum = creditSum + debitSum;
  const opening = closing != null ? closing - sum : null;

  // The amount column is headed with the currency, so the figures below it can
  // stay bare — unless the period mixes currencies, in which case each row has
  // to carry its own.
  const currencies = [...new Set(transactions.map((t) => t.currency).filter(Boolean))];
  const currency = balance?.currency || currencies[0] || account.currency || 'EUR';
  const mixed = currencies.length > 1;

  const stmtNo = statementNoRange(transactions);
  const periodLabel = `${period.from ? fmtDate(period.from) : '—'} – ${period.to ? fmtDate(period.to) : '—'}`;
  const docId = docRef('statement', account, [
    periodLabel,
    String(transactions.length),
    String(closing ?? ''),
    ...sorted.map((t) => `${t.bankReference}${t.amount}`),
  ]);

  return (
    <article className="mx-auto max-w-[184mm] py-1 text-[10.5px] leading-[1.45] text-black">
      <Letterhead
        bank={bank}
        logoFile={logoFile}
        title="Kontoauszug"
        meta={[
          ...(stmtNo ? ([['Auszug Nr.', stmtNo]] as [string, string][]) : []),
          ['Zeitraum', periodLabel],
          ['Umsätze', String(transactions.length)],
        ]}
      />

      <AccountBlock
        account={account}
        sender={`Sooskasse-FinTS  ·  Kontoauszug  ·  ${docId}`}
        particulars={[
          ['Kontonummer', account.accountNumber],
          ...(account.iban ? ([['IBAN', fmtIban(account.iban)]] as [string, string][]) : []),
          ...(account.bic || bank?.bic ? ([['BIC', account.bic || bank?.bic || '']] as [string, string][]) : []),
          ['Kontoart', translateType(account.accountType)],
          ['Währung', currency],
          ['Auszugsdatum', fmtDate(balance?.date || period.to || new Date())],
        ]}
      />

      <div className="mt-4">
        <BalanceBand
          label="Alter Kontostand"
          date={period.from ? fmtDate(period.from) : undefined}
          amount={opening}
          currency={currency}
        />
      </div>

      <table className="mt-3 w-full border-collapse">
        <thead>
          {/* Repeats on every printed page, so a continuation sheet still says
              which account and which statement it belongs to. */}
          <tr>
            <th colSpan={4} className="pt-1 pb-1 text-left">
              <span className="num text-[8px] font-normal tracking-wide text-neutral-500">
                {[
                  'Umsatzübersicht',
                  fmtIban(account.iban) || account.accountNumber,
                  stmtNo ? `Auszug ${stmtNo}` : null,
                  periodLabel,
                ]
                  .filter(Boolean)
                  .join('  ·  ')}
              </span>
            </th>
          </tr>
          <tr className="border-y border-black bg-neutral-100 text-left text-[8px] tracking-[0.11em] text-neutral-700 uppercase">
            <th className="w-[19mm] py-[5px] pl-1 font-semibold">Buchung</th>
            <th className="w-[19mm] py-[5px] font-semibold">Valuta</th>
            <th className="py-[5px] pr-3 font-semibold">Vorgang · Verwendungszweck</th>
            <th className="w-[30mm] py-[5px] pr-1 text-right font-semibold">
              Betrag{mixed ? '' : ` in ${currency}`}
              <span className="ml-1.5 font-normal normal-case">S/H</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td colSpan={4} className={`border-b ${HAIRLINE} py-8 text-center text-[10px] text-neutral-500`}>
                Keine Umsätze in diesem Zeitraum.
              </td>
            </tr>
          )}
          {sorted.map((t, i) => (
            <tr key={`${t.bankReference}-${t.e2eReference}-${i}`} className={`border-b ${HAIRLINE} align-top`}>
              <td className="num py-[6px] pl-1 text-[10px] whitespace-nowrap">{fmtDate(t.entryDate || t.valueDate)}</td>
              <td className="num py-[6px] text-[10px] whitespace-nowrap">{fmtDate(t.valueDate)}</td>
              <td className="py-[6px] pr-3">
                {t.bookingText && (
                  <p className="text-[7.5px] font-semibold tracking-[0.11em] text-neutral-500 uppercase">{t.bookingText}</p>
                )}
                <p className="text-[10.5px] leading-snug font-semibold">{t.remoteName || t.bookingText || 'Buchung'}</p>
                {t.purpose && <p className="text-[9.5px] leading-snug text-neutral-700">{t.purpose}</p>}
                <p className="num mt-[1px] text-[8px] leading-snug text-neutral-500">
                  {[
                    t.remoteIban ? fmtIban(t.remoteIban) : null,
                    t.e2eReference ? `E2E ${t.e2eReference}` : null,
                    t.mandateReference ? `MREF ${t.mandateReference}` : null,
                    t.transactionCode ? `GVC ${t.transactionCode}` : null,
                  ]
                    .filter(Boolean)
                    .join('  ·  ')}
                </p>
              </td>
              <td className="py-[6px] pr-1 text-right whitespace-nowrap">
                <span className="num text-[11px] font-semibold tabular-nums">{fmtDecimal(Math.abs(t.amount))}</span>
                <span className="num ml-2 inline-block w-[9px] text-[10px] font-semibold">{sh(t.amount)}</span>
                {mixed && <span className="num ml-1 text-[8px] text-neutral-600">{t.currency}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals, then the closing balance — the arithmetic a reader checks. */}
      <section className="keep mt-3 flex justify-end">
        <table className="w-[86mm] border-collapse text-[10px]">
          <tbody>
            <tr className={`border-b ${HAIRLINE}`}>
              <td className="py-[3px] text-[9px] tracking-wide text-neutral-600 uppercase">
                Summe Gutschriften <span className="num">({credits.length})</span>
              </td>
              <td className="num py-[3px] text-right font-semibold tabular-nums">{fmtDecimal(creditSum)}</td>
              <td className="num w-[9px] py-[3px] pl-2 text-[9px] font-semibold">H</td>
            </tr>
            <tr className={`border-b ${HAIRLINE}`}>
              <td className="py-[3px] text-[9px] tracking-wide text-neutral-600 uppercase">
                Summe Belastungen <span className="num">({debits.length})</span>
              </td>
              <td className="num py-[3px] text-right font-semibold tabular-nums">{fmtDecimal(Math.abs(debitSum))}</td>
              <td className="num w-[9px] py-[3px] pl-2 text-[9px] font-semibold">S</td>
            </tr>
            <tr className="border-b border-black">
              <td className="py-[3px] text-[9px] font-semibold tracking-wide text-neutral-700 uppercase">Saldo der Umsätze</td>
              <td className="num py-[3px] text-right font-semibold tabular-nums">{fmtDecimal(Math.abs(sum))}</td>
              <td className="num w-[9px] py-[3px] pl-2 text-[9px] font-semibold">{sh(sum)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <div className="mt-3">
        <BalanceBand
          label="Neuer Kontostand"
          date={balance?.date ? fmtDate(balance.date) : period.to ? fmtDate(period.to) : undefined}
          amount={closing}
          currency={currency}
          strong
        />
      </div>

      {balance?.availableAmount != null && (
        <p className="num mt-1.5 text-right text-[9px] text-neutral-600">
          Verfügbarer Betrag: {fmtMoney(balance.availableAmount, currency)}
          {balance.creditLimit != null && <> · Eingeräumte Kontoüberziehung: {fmtMoney(balance.creditLimit, currency)}</>}
        </p>
      )}

      <EndMarker label={`Ende des Kontoauszugs · ${transactions.length} Umsätze`} />

      <SheetFooter
        docId={docId}
        notes={[
          'S = Soll (Belastung) · H = Haben (Gutschrift). Beträge ohne Vorzeichen.',
          'Umsätze mit Valuta nach dem Auszugsdatum sind noch nicht wertgestellt.',
          DISCLAIMER,
        ]}
      />
    </article>
  );
}

// ---------------------------------------------------------------------------
// Buchungsbeleg (single-transaction receipt)
// ---------------------------------------------------------------------------

function Field({ label, value }: { label: string; value: string }) {
  return (
    <tr className={`border-b ${HAIRLINE}`}>
      <td className="w-[34%] py-[5px] pr-3 align-top text-[8px] leading-snug font-semibold tracking-[0.11em] text-neutral-500 uppercase">
        {label}
      </td>
      <td className="num py-[5px] align-top text-[10px] leading-snug break-words">{value}</td>
    </tr>
  );
}

function Section({ title, rows }: { title: string; rows: [string, string][] }) {
  const filled = rows.filter(([, v]) => v);
  if (!filled.length) return null;
  return (
    <section className="keep break-inside-avoid">
      <h2 className="keep-next border-b border-black pb-[3px] text-[8.5px] font-semibold tracking-[0.14em] uppercase">{title}</h2>
      <table className="w-full border-collapse">
        <tbody>
          {filled.map(([label, value]) => (
            <Field key={label} label={label} value={value} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function TransactionSheet({ job }: { job: PrintJob & { kind: 'transaction' } }) {
  const { account, bank, tx } = job;
  const logoFile = useLogoFile(bank?.brand);
  const credit = tx.amount >= 0;
  const currency = tx.currency || account.currency || 'EUR';
  const docId = docRef('receipt', account, [tx.bankReference, tx.e2eReference, String(tx.amount), String(tx.valueDate)]);

  return (
    <article className="mx-auto max-w-[184mm] py-1 text-[10.5px] leading-[1.45] text-black">
      <Letterhead
        bank={bank}
        logoFile={logoFile}
        title="Buchungsbeleg"
        meta={[
          ['Buchungstag', fmtDate(tx.entryDate) || '—'],
          ...(tx.statementNumber ? ([['Auszug Nr.', tx.statementNumber]] as [string, string][]) : []),
        ]}
      />

      {/* The figure this document exists for, framed and stated in words as
          well — a receipt has to be unmisreadable at a glance. */}
      <section className="keep mt-4 flex items-end justify-between gap-6 border-2 border-black bg-neutral-100 px-3 py-2.5">
        <div>
          <p className="text-[7.5px] font-semibold tracking-[0.13em] text-neutral-500 uppercase">Umsatzart</p>
          <p className="mt-0.5 text-[13px] leading-tight font-semibold">
            {credit ? 'Gutschrift (Haben)' : 'Belastung (Soll)'}
          </p>
          {tx.bookingText && <p className="num text-[9px] text-neutral-600">{tx.bookingText}</p>}
        </div>
        <div className="text-right">
          <p className="text-[7.5px] font-semibold tracking-[0.13em] text-neutral-500 uppercase">Betrag in {currency}</p>
          <p className="num mt-0.5 flex items-baseline justify-end gap-2 leading-none">
            <span className="text-[26px] font-bold tabular-nums">{fmtDecimal(Math.abs(tx.amount))}</span>
            <span className="text-[15px] font-bold">{sh(tx.amount)}</span>
          </p>
        </div>
      </section>

      <div className="mt-4 grid grid-cols-2 gap-x-7 gap-y-4">
        <Section
          title={credit ? 'Begünstigtes Konto' : 'Belastetes Konto'}
          rows={[
            ['Kontoinhaber', account.holder],
            ['IBAN', fmtIban(account.iban) || account.accountNumber],
            ['BIC', account.bic || bank?.bic || ''],
            ['Kontoart', translateType(account.accountType)],
          ]}
        />
        <Section
          title={credit ? 'Auftraggeber' : 'Zahlungsempfänger'}
          rows={[
            ['Name', tx.remoteName],
            ['IBAN', tx.remoteIban ? fmtIban(tx.remoteIban) : ''],
            ['BIC', tx.remoteBic],
          ]}
        />
        <Section
          title="Verbuchung"
          rows={[
            ['Buchungstag', fmtDate(tx.entryDate)],
            ['Wertstellung', fmtDate(tx.valueDate)],
            ['Buchungstext', tx.bookingText],
            ['Geschäftsvorfallcode', tx.transactionCode],
            ['Primanota', tx.primeNotesNr],
            ['Auszug Nr.', tx.statementNumber],
          ]}
        />
        <Section
          title="Referenzen"
          rows={[
            ['End-to-End-Referenz', tx.e2eReference],
            ['Mandatsreferenz', tx.mandateReference],
            ['Kundenreferenz', tx.customerReference !== 'NONREF' ? tx.customerReference : ''],
            ['Bankreferenz', tx.bankReference],
          ]}
        />
      </div>

      {(tx.purpose || tx.additionalInformation) && (
        <section className="keep mt-4">
          <h2 className="keep-next border-b border-black pb-[3px] text-[8.5px] font-semibold tracking-[0.14em] uppercase">
            Verwendungszweck
          </h2>
          <p className={`border-b ${HAIRLINE} py-2 text-[10.5px] leading-snug whitespace-pre-line`}>
            {tx.purpose || '—'}
          </p>
          {tx.additionalInformation && (
            <p className="num pt-1.5 text-[9px] leading-snug text-neutral-600">{tx.additionalInformation}</p>
          )}
        </section>
      )}

      <EndMarker label="Ende des Buchungsbelegs" />

      <SheetFooter
        docId={docId}
        notes={[
          'S = Soll (Belastung) · H = Haben (Gutschrift). Der Betrag ist ohne Vorzeichen angegeben.',
          'Die Wertstellung (Valuta) bestimmt die Zinsrechnung und kann vom Buchungstag abweichen.',
          DISCLAIMER,
        ]}
      />
    </article>
  );
}
