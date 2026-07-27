'use client';

// The printable Kontoauszug / Buchungsbeleg.
//
// No PDF library: this renders a print-only sheet (Tailwind's `print:` variant,
// hidden on screen) from data already sitting in memory, then calls
// window.print() — the browser's own "Save as PDF" target is the actual PDF
// generator. That keeps a local-only banking app from adding a renderer
// dependency (or a headless-Chromium one) just to lay out a table of numbers.
//
// Both sheets are one document family, built on the `.doc` system in
// globals.css: six type sizes, a 4pt spacing scale, one label rail that every
// block aligns to, and three rules. Deliberately no frames, no filled bands and
// no boxes — a printed financial document earns its authority from alignment
// and space, and a page of competing enclosures reads as busy instead.
//
// The other rule the layout keeps is that every fact appears exactly once, in
// the block it belongs to. Repeating the booking date in a header, a status
// strip and a table is what makes a one-page receipt feel cluttered.
//
// Everything printed is either data the bank sent or a fact about this export.
// The footer says plainly that the document was generated here, seals it with a
// SHA-256 over the exact data on the page, and names the generator and version.

import { Fragment, useEffect, useRef, useState } from 'react';
import {
  fmtDate, fmtDecimal, fmtIban, fmtMoney, fmtSignedDecimal, fmtSignedMoney,
  ibanCountry, prettyBookingText, translateType, txTime,
} from '@/lib/format';
import { parsePurpose, purposeLines } from '@/lib/sepa-purpose';
import type { SerializedAccount, SerializedTransaction } from '@/lib/fints-types';
import type { ChosenBank, PrintJob } from './FintsProvider';
import { useFints, useLogoFile } from './FintsProvider';

const APP_NAME = 'Sooskasse-FinTS';
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '';

export function Statement() {
  const { printJob, closePrintJob } = useFints();
  const [stamp, setStamp] = useState<DocStamp | null>(null);
  const sheet = useRef<HTMLDivElement>(null);

  // Seal before printing. The footer states a checksum over the exact data on
  // the page, so the sheet must not reach the print dialog until the digest has
  // resolved — otherwise the document would go out without its own seal.
  useEffect(() => {
    if (!printJob) {
      setStamp(null);
      return;
    }
    let alive = true;
    void sealDocument(printJob).then((sealed) => {
      if (alive) setStamp(sealed);
    });
    return () => {
      alive = false;
    };
  }, [printJob]);

  useEffect(() => {
    if (!printJob || !stamp) return;
    let cancelled = false;
    const onAfterPrint = () => closePrintJob();
    window.addEventListener('afterprint', onAfterPrint);

    // Marks first, then one frame to paint them, then the dialog.
    void marksSettled(sheet.current).then(() => {
      if (cancelled) return;
      requestAnimationFrame(() => {
        if (!cancelled) window.print();
      });
    });

    return () => {
      cancelled = true;
      window.removeEventListener('afterprint', onAfterPrint);
    };
  }, [printJob, stamp, closePrintJob]);

  if (!printJob || !stamp) return null;

  return (
    <div
      ref={sheet}
      className="sheet doc hidden bg-white print:block"
      style={{ fontFamily: 'var(--font-barlow), Arial, sans-serif' }}
    >
      {printJob.kind === 'statement'
        ? <StatementSheet job={printJob} stamp={stamp} />
        : <TransactionSheet job={printJob} stamp={stamp} />}
    </div>
  );
}

/** How long a slow mark may hold up the print dialog before it goes without. */
const MARK_GRACE_MS = 3000;

/**
 * Resolves once every mark on the sheet has settled — loaded or failed.
 *
 * window.print() snapshots the page synchronously, so an <img> still in flight
 * is simply not in the PDF. The sheet mounts at most a frame before printing,
 * which means the bank's logo starts downloading at almost exactly the wrong
 * moment: it only made it into the export when the URL happened to be warm in
 * the HTTP cache, and was missing from the rest.
 *
 * The grace period matters as much as the wait. A logo that 404s or hangs must
 * never be able to stop somebody printing their own statement, so this resolves
 * either way and the letterhead falls back to a monogram.
 */
function marksSettled(root: HTMLElement | null): Promise<void> {
  const marks = root ? [...root.querySelectorAll('img')] : [];
  if (!marks.length) return Promise.resolve();

  // decode() rather than a bare load event: the sheet is display:none until the
  // print stylesheet reveals it, so a downloaded mark may still be un-decoded
  // at the moment the snapshot is taken. Both outcomes resolve — a mark that
  // cannot be decoded is one the letterhead renders a monogram for.
  const each = marks.map(
    (img) =>
      new Promise<void>((resolve) => {
        const done = () => resolve();
        if (img.complete) {
          void img.decode().then(done, done);
          return;
        }
        img.addEventListener('load', () => void img.decode().then(done, done), { once: true });
        img.addEventListener('error', done, { once: true });
      }),
  );

  return Promise.race([
    Promise.all(each).then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, MARK_GRACE_MS)),
  ]);
}

// ---------------------------------------------------------------------------
// Document identity
// ---------------------------------------------------------------------------

type DocStamp = {
  /** Human-citable reference, printed in the letterhead and the footer. */
  docId: string;
  /** SHA-256 over the document's data, or null where WebCrypto is unavailable. */
  sha: string | null;
  /** Fixed at seal time so the printed timestamp and the digest agree. */
  created: Date;
};

/**
 * Every value the sheet will print, in a fixed order.
 *
 * This — not the PDF bytes, which the browser produces and this code never
 * sees — is what the footer's checksum covers, so the footer names it as a
 * digest of the document's *data*.
 */
function canonical(job: PrintJob): string {
  const acct = (a: SerializedAccount) =>
    [a.accountNumber, a.iban, a.bic, a.currency, a.accountType, a.holder].map((v) => String(v ?? '')).join('|');
  const entry = (t: SerializedTransaction) =>
    [
      t.entryDate, t.valueDate, t.amount, t.currency, t.remoteName, t.remoteIban, t.remoteBic,
      t.purpose, t.bookingText, t.e2eReference, t.mandateReference, t.customerReference,
      t.bankReference, t.transactionCode, t.primeNotesNr, t.statementNumber,
    ].map((v) => String(v ?? '')).join('|');

  if (job.kind === 'statement') {
    return [
      'kontoauszug', acct(job.account), job.bank?.bic ?? '', job.from ?? '', job.to ?? '',
      String(job.balance?.balance ?? ''), String(job.balance?.date ?? ''),
      ...job.transactions.map(entry),
    ].join('\n');
  }
  return ['buchungsbeleg', acct(job.account), job.bank?.bic ?? '', String(job.pending), entry(job.tx)].join('\n');
}

async function sha256Hex(text: string): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // No WebCrypto — an insecure origin, or an old engine. The sheet still
    // prints; it simply carries no checksum.
    return null;
  }
}

/** FNV-1a, the fallback tag when the digest is unavailable. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).toUpperCase().padStart(7, '0').slice(0, 7);
}

async function sealDocument(job: PrintJob): Promise<DocStamp> {
  const created = new Date();
  const payload = canonical(job);
  const sha = await sha256Hex(payload);
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${created.getFullYear()}${pad(created.getMonth() + 1)}${pad(created.getDate())}`;
  // Derived from the contents, so the same data always yields the same
  // reference and two different exports never collide.
  return { docId: `SK-${day}-${sha ? sha.slice(0, 8).toUpperCase() : fnv1a(payload)}`, sha, created };
}

/** "2026-07-26 20:54:17 MESZ" — a timestamp that says which clock it is on. */
function fmtStamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const zone = new Intl.DateTimeFormat('de-DE', { timeZoneName: 'short' })
    .formatToParts(d)
    .find((part) => part.type === 'timeZoneName')?.value;
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${zone ? ` ${zone}` : ''}`
  );
}

/** The MT940 :28C: statement numbers actually present in the data, as a range. */
function statementNoRange(txs: SerializedTransaction[]): string | null {
  const nums = [...new Set(txs.map((t) => t.statementNumber).filter(Boolean))];
  if (!nums.length) return null;
  if (nums.length === 1) return nums[0];
  const sorted = nums.slice().sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  return `${sorted[0]}–${sorted[sorted.length - 1]}`;
}

// ---------------------------------------------------------------------------
// The document system
// ---------------------------------------------------------------------------

/** One label/value pair on the rail. Rendered as two grid cells, not a row. */
type Pair = { label: string; value: string; cast?: Cast };

/**
 * How a value wants to be set. `iban` never wraps and gets extra tracking;
 * `ref` may break mid-token, because a 35-character End-to-End reference has no
 * seams to break at.
 */
type Cast = 'text' | 'num' | 'iban' | 'ref';

const CAST_CLASS: Record<Cast, string> = {
  text: '',
  num: 'num',
  iban: 'iban',
  ref: 'num break-all',
};

/**
 * A block of the document: an uppercase heading, then content. The heading is
 * the only uppercase on the page, which is what keeps it legible as a heading.
 */
function Block({ title, children, flush = false }: { title?: string; children: React.ReactNode; flush?: boolean }) {
  // `flush` swaps the margin class rather than appending an override — two
  // competing margin utilities in one class list resolve by stylesheet order,
  // not by the order they are written.
  return (
    <section className={`keep ${flush ? '' : 'mt-[var(--s-7)]'}`}>
      {title && <h2 className="doc-section keep-next mb-[var(--s-2)]">{title}</h2>}
      {children}
    </section>
  );
}

/**
 * A block of label/value pairs on the shared rail.
 *
 * Returns nothing at all when no row has a value, so a document can never
 * print a heading over an empty space — the sparse cases (a Vormerkposten with
 * no references yet) are the common ones, not the exception.
 */
function PairBlock({ title, rows, flush = false }: { title?: string; rows: Pair[]; flush?: boolean }) {
  const filled = rows.filter((r) => r.value);
  if (!filled.length) return null;
  return (
    <Block title={title} flush={flush}>
      <div className="doc-pairs doc-rule-strong">
        {filled.map(({ label, value, cast = 'text' }) => (
          <Fragment key={label}>
            <span className="doc-label">{label}</span>
            <span className={`doc-body ${CAST_CLASS[cast]}`}>{value}</span>
          </Fragment>
        ))}
      </div>
    </Block>
  );
}

/**
 * The institution's mark, with a monogram behind it.
 *
 * A logo that fails to load leaves an `<img>` with no intrinsic size, which
 * collapses to zero width and takes the letterhead's mark away silently. The
 * monogram is what the document falls back to — a brand with no file of its
 * own, and a file that could not be fetched, look the same and both keep the
 * letterhead's proportions.
 */
function BankMark({ bank, logoFile }: { bank: ChosenBank | null; logoFile?: string }) {
  const [broken, setBroken] = useState(false);

  if (logoFile && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/logos/${logoFile}`}
        alt=""
        onError={() => setBroken(true)}
        className="h-10 w-auto max-w-[38mm] shrink-0 object-contain"
      />
    );
  }

  return (
    <span className="doc-title grid size-10 shrink-0 place-items-center border border-[var(--doc-ink)] font-semibold">
      {(bank?.name || '?').trim().slice(0, 1).toUpperCase()}
    </span>
  );
}

/**
 * The letterhead. The institution's mark is the only branding on the page and
 * is given the weight to match; the generator names itself once, in the footer.
 */
function Letterhead({
  bank,
  logoFile,
  title,
  docId,
  meta,
}: {
  bank: ChosenBank | null;
  logoFile?: string;
  title: string;
  docId: string;
  meta: [string, string][];
}) {
  return (
    <header className="keep flex items-start justify-between gap-[var(--s-7)] pb-[var(--s-4)]">
      <div className="flex items-center gap-[var(--s-4)]">
        <BankMark bank={bank} logoFile={logoFile} />
        <div>
          {/* Named as the institution the account is held at — not as the
              document's author. The bank did not issue this sheet, and the
              letterhead is not allowed to imply that it did. */}
          <p className="doc-micro doc-quiet">Kontoführendes Institut</p>
          <p className="doc-lead mt-[var(--s-1)] font-semibold">{bank?.name || 'Bank'}</p>
          <p className="doc-micro num doc-quiet mt-[var(--s-1)]">
            {[bank?.bic ? `BIC ${bank.bic}` : null, bank?.blz ? `BLZ ${bank.blz}` : null].filter(Boolean).join('   ')}
          </p>
        </div>
      </div>

      <div className="shrink-0 text-right">
        <p className="doc-title font-semibold tracking-[0.02em]">{title}</p>
        <p className="doc-micro num doc-quiet mt-[var(--s-2)]">{docId}</p>
        {meta.length > 0 && (
          <p className="doc-micro num mt-[var(--s-1)]">
            {meta.map(([label, value]) => `${label} ${value}`).join('   ·   ')}
          </p>
        )}
      </div>
    </header>
  );
}

/** The end-of-document line: a printed document says where it stops. */
function EndMarker({ label }: { label: string }) {
  return <p className="doc-micro doc-quiet keep mt-[var(--s-6)] text-center">{label}</p>;
}

function SheetFooter({ stamp, notes }: { stamp: DocStamp; notes: string[] }) {
  const generator = [APP_NAME, APP_VERSION].filter(Boolean).join(' ');
  const meta: [string, string][] = [
    ['Dokument', stamp.docId],
    ['Erzeugt von', generator],
    ['Erstellt', fmtStamp(stamp.created)],
    ['Quelle', 'FinTS 3.0 · HKKAZ/HKSAL'],
  ];
  return (
    <footer className="doc-rule-strong keep mt-[var(--s-3)] pt-[var(--s-4)]">
      <div className="flex items-start justify-between gap-[var(--s-8)]">
        <div className="doc-micro doc-quiet max-w-[104mm] space-y-[var(--s-1)]">
          {notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
        <div className="doc-micro grid shrink-0 grid-cols-[auto_auto] gap-x-[var(--s-4)] gap-y-[var(--s-1)] text-right">
          {meta.map(([label, value]) => (
            <Fragment key={label}>
              <span className="doc-quiet">{label}</span>
              <span className="num">{value}</span>
            </Fragment>
          ))}
        </div>
      </div>

      {stamp.sha && (
        <p className="doc-micro doc-quiet mt-[var(--s-3)] flex gap-[var(--s-4)]">
          <span className="shrink-0">SHA-256 der Belegdaten</span>
          {/* Grouped in eights so a reader can compare it against another copy
              without losing their place, and free to wrap at those seams. */}
          <span className="num break-words">{(stamp.sha.toUpperCase().match(/.{1,8}/g) || []).join(' ')}</span>
        </p>
      )}
    </footer>
  );
}

const DISCLAIMER =
  'Dieser Beleg wurde über FinTS direkt von der kontoführenden Bank abgerufen und mit Sooskasse-FinTS erzeugt. Er ist kein amtliches, von der Bank ausgestelltes Dokument und ersetzt dieses nicht.';

const SIGN_NOTE = 'Belastungen sind mit einem Minuszeichen dargestellt, Gutschriften ohne Vorzeichen.';

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

function StatementSheet({ job, stamp }: { job: PrintJob & { kind: 'statement' }; stamp: DocStamp }) {
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

  return (
    <article className="mx-auto max-w-[184mm]">
      <Letterhead
        bank={bank}
        logoFile={logoFile}
        title="Kontoauszug"
        docId={stamp.docId}
        meta={stmtNo ? [['Auszug', stmtNo]] : []}
      />

      {/* Whose account, and which one. The holder carries the weight; the
          particulars sit quietly on the rail beneath. */}
      <section className="doc-rule-strong keep pt-[var(--s-5)]">
        <p className="doc-micro doc-quiet">Kontoinhaber</p>
        <p className="doc-lead mt-[var(--s-1)] font-semibold">{account.holder || '—'}</p>
        <p className="doc-small doc-quiet mt-[var(--s-1)]">{account.product || translateType(account.accountType)}</p>

        <div className="doc-pairs-2 mt-[var(--s-5)]">
          <PairBlock
            flush
            rows={[
              { label: 'Kontonummer', value: account.accountNumber, cast: 'num' },
              { label: 'IBAN', value: fmtIban(account.iban), cast: 'iban' },
              { label: 'BIC', value: account.bic || bank?.bic || '', cast: 'num' },
            ]}
          />
          <PairBlock
            flush
            rows={[
              { label: 'Kontoart', value: translateType(account.accountType) },
              { label: 'Währung', value: currency, cast: 'num' },
              { label: 'Zeitraum', value: periodLabel, cast: 'num' },
            ]}
          />
        </div>
      </section>

      <Block title="Umsätze">
        <table className="w-full border-collapse">
          <thead>
            {/* Repeats on every printed page, so a continuation sheet still says
                which account and which statement it belongs to. */}
            <tr>
              <th colSpan={4} className="doc-micro doc-quiet num pb-[var(--s-2)] text-left font-normal">
                {[fmtIban(account.iban) || account.accountNumber, stmtNo ? `Auszug ${stmtNo}` : null, periodLabel]
                  .filter(Boolean)
                  .join('   ·   ')}
              </th>
            </tr>
            <tr className="doc-rule-strong doc-label text-left">
              <th className="w-[18mm] py-[var(--s-2)] font-medium">Buchung</th>
              <th className="w-[18mm] py-[var(--s-2)] font-medium">Valuta</th>
              <th className="py-[var(--s-2)] pr-[var(--s-5)] font-medium">Vorgang</th>
              <th className="w-[28mm] py-[var(--s-2)] text-right font-medium">
                Betrag{mixed ? '' : ` in ${currency}`}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={4} className="doc-body doc-quiet doc-rule py-[var(--s-8)] text-center">
                  Keine Umsätze in diesem Zeitraum.
                </td>
              </tr>
            )}
            {sorted.map((t, i) => {
              const purpose = parsePurpose(t.purpose);
              const marks = [
                t.remoteIban ? fmtIban(t.remoteIban) : null,
                t.e2eReference ? `EREF ${t.e2eReference}` : null,
                t.mandateReference ? `MREF ${t.mandateReference}` : null,
              ].filter(Boolean);
              return (
                <tr key={`${t.bankReference}-${t.e2eReference}-${i}`} className="doc-rule align-top">
                  <td className="doc-body num py-[var(--s-3)] whitespace-nowrap">{fmtDate(t.entryDate || t.valueDate)}</td>
                  <td className="doc-body num py-[var(--s-3)] whitespace-nowrap">{fmtDate(t.valueDate)}</td>
                  <td className="py-[var(--s-3)] pr-[var(--s-5)]">
                    <p className="doc-body font-semibold">
                      {t.remoteName || prettyBookingText(t.bookingText) || 'Buchung'}
                    </p>
                    {purposeLines(purpose.text).map((line, n) => (
                      <p key={n} className="doc-small doc-quiet">{line}</p>
                    ))}
                    {marks.length > 0 && (
                      <p className="doc-micro doc-quiet num mt-[var(--s-1)]">{marks.join('   ·   ')}</p>
                    )}
                  </td>
                  <td className="doc-body num py-[var(--s-3)] text-right font-semibold tabular-nums whitespace-nowrap">
                    {fmtSignedDecimal(t.amount)}
                    {mixed && <span className="doc-micro doc-quiet ml-[var(--s-2)]">{t.currency}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Block>

      {/* The arithmetic a reader checks, in the same column as the figures it
          sums. The closing balance is the one panel this document allows. */}
      <section className="keep mt-[var(--s-5)] flex justify-end">
        <div className="w-[86mm]">
          <div className="doc-pairs doc-rule-strong" style={{ '--doc-rail': '46mm' } as React.CSSProperties}>
            <span className="doc-label">Alter Kontostand</span>
            <span className="doc-body num text-right tabular-nums">
              {opening != null ? fmtSignedDecimal(opening) : 'nicht abgerufen'}
            </span>
            <span className="doc-label">Gutschriften ({credits.length})</span>
            <span className="doc-body num text-right tabular-nums">{fmtDecimal(creditSum)}</span>
            <span className="doc-label">Belastungen ({debits.length})</span>
            <span className="doc-body num text-right tabular-nums">{fmtSignedDecimal(debitSum)}</span>
          </div>

          <div className="doc-panel mt-[var(--s-3)] flex items-baseline justify-between gap-[var(--s-5)] px-[var(--s-4)] py-[var(--s-4)]">
            <span className="doc-small font-semibold">
              Neuer Kontostand
              {balance?.date && <span className="doc-micro doc-quiet num ml-[var(--s-2)]">vom {fmtDate(balance.date)}</span>}
            </span>
            <span className="doc-title num font-bold tabular-nums">
              {closing != null ? fmtSignedMoney(closing, currency) : '—'}
            </span>
          </div>

          {balance?.availableAmount != null && (
            <p className="doc-micro doc-quiet num mt-[var(--s-2)] text-right">
              Verfügbar {fmtSignedMoney(balance.availableAmount, currency)}
              {balance.creditLimit != null && <>   ·   Kontoüberziehung {fmtMoney(balance.creditLimit, currency)}</>}
            </p>
          )}
        </div>
      </section>

      <EndMarker label={`Ende des Kontoauszugs · ${transactions.length} Umsätze`} />

      <SheetFooter
        stamp={stamp}
        notes={[SIGN_NOTE, 'Umsätze mit Valuta nach dem Auszugsdatum sind noch nicht wertgestellt.', DISCLAIMER]}
      />
    </article>
  );
}

// ---------------------------------------------------------------------------
// Buchungsbeleg (single-transaction receipt)
// ---------------------------------------------------------------------------

function TransactionSheet({ job, stamp }: { job: PrintJob & { kind: 'transaction' }; stamp: DocStamp }) {
  const { account, bank, tx, pending, balance, merchant } = job;
  const logoFile = useLogoFile(bank?.brand);
  const credit = tx.amount >= 0;
  const currency = tx.currency || account.currency || 'EUR';
  const bookingType = prettyBookingText(tx.bookingText) || 'Buchung';
  const country = ibanCountry(tx.remoteIban);

  const purpose = parsePurpose(tx.purpose);
  const lines = purposeLines(purpose.text);

  // References the transaction carries in its own fields, then anything the
  // structured purpose added that has no row of its own. Matching by value
  // keeps an EREF that merely repeats the End-to-End reference from printing
  // twice under two names.
  const references: Pair[] = ([
    { label: 'End-to-End', value: tx.e2eReference, cast: 'ref' },
    { label: 'Mandat', value: tx.mandateReference, cast: 'ref' },
    { label: 'Kunde', value: tx.customerReference !== 'NONREF' ? tx.customerReference : '', cast: 'ref' },
    { label: 'Bank', value: tx.bankReference, cast: 'ref' },
  ] satisfies Pair[]).filter((r) => r.value);
  for (const field of purpose.fields) {
    if (references.some((r) => r.value === field.value)) continue;
    references.push({ label: field.label, value: field.value, cast: field.tag === 'IBAN' ? 'iban' : 'ref' });
  }

  return (
    <article className="mx-auto max-w-[184mm]">
      <Letterhead bank={bank} logoFile={logoFile} title="Buchungsbeleg" docId={stamp.docId} meta={[]} />

      {/* What this document is about: who, how much, which way. The figure is
          the largest thing on the page and the only place colour appears. */}
      <section className="doc-rule-strong keep flex items-start justify-between gap-[var(--s-8)] pt-[var(--s-6)]">
        <div className="flex min-w-0 items-start gap-[var(--s-4)]">
          {merchant && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/merchant-logo?id=${merchant.logo}`}
              alt=""
              className="size-11 shrink-0 border border-[var(--doc-rule)] bg-white object-contain p-[var(--s-1)]"
            />
          )}
          <div className="min-w-0">
            <p className="doc-micro doc-quiet">{credit ? 'Auftraggeber' : 'Zahlungsempfänger'}</p>
            <p className="doc-lead mt-[var(--s-1)] font-semibold">{tx.remoteName || '—'}</p>
            {/* The booking's counterparty stays the lead — on a document of
                record that is who was actually paid. Where the shop behind a
                payment provider is known, it is named in words rather than as
                a second logo: a monochrome sheet has no room for a badge, and
                "Einkauf bei …" states the relation the badge only implies. */}
            <p className="doc-small doc-quiet mt-[var(--s-1)]">
              {[
                merchant && merchant.label !== tx.remoteName
                  ? (merchant.via ? `Einkauf bei ${merchant.label}` : merchant.label)
                  : null,
                country?.name,
              ]
                .filter(Boolean)
                .join('   ·   ')}
            </p>
          </div>
        </div>

        <div
          className="doc-panel shrink-0 px-[var(--s-5)] py-[var(--s-4)] text-right"
          style={{ color: credit ? 'var(--doc-credit)' : 'var(--doc-debit)' }}
        >
          <p className="doc-display num font-bold tabular-nums">{fmtSignedMoney(tx.amount, currency)}</p>
          <p className="doc-small mt-[var(--s-2)] font-semibold tracking-[0.14em] uppercase">
            {credit ? 'Gutschrift' : 'Belastung'}
          </p>
        </div>
      </section>

      {/* State and kind on one line — not a strip, not a card. */}
      <p className="doc-small keep mt-[var(--s-5)] flex items-center gap-[var(--s-2)]">
        <span
          className={`inline-block size-[6px] rounded-full border border-[var(--doc-ink)] ${pending ? '' : 'bg-[var(--doc-ink)]'}`}
          aria-hidden
        />
        <span className="font-semibold">{pending ? 'Vorgemerkt' : 'Gebucht'}</span>
        <span className="doc-quiet">·</span>
        <span>{bookingType}</span>
      </p>

      {/* Both sides of the payment against one rail: the labels are written
          once and the two accounts line up column against column. */}
      <Block title="Konten">
        <div className="doc-parties doc-rule-strong">
          <span className="doc-label" />
          <span className="doc-micro font-semibold">{credit ? 'Empfängerkonto' : 'Belastetes Konto'}</span>
          <span className="doc-micro font-semibold">{credit ? 'Auftraggeberkonto' : 'Empfängerkonto'}</span>

          <span className="doc-label">Inhaber</span>
          <span className="doc-body">{account.holder || '—'}</span>
          <span className="doc-body">{tx.remoteName || '—'}</span>

          <span className="doc-label">IBAN</span>
          <span className="doc-body iban">{fmtIban(account.iban) || account.accountNumber}</span>
          <span className="doc-body iban">{tx.remoteIban ? fmtIban(tx.remoteIban) : '—'}</span>

          <span className="doc-label">BIC</span>
          <span className="doc-body num">{account.bic || bank?.bic || '—'}</span>
          <span className="doc-body num">{tx.remoteBic || '—'}</span>
        </div>
      </Block>

      {(lines.length > 0 || tx.additionalInformation) && (
        <Block title="Verwendungszweck">
          {/* One line per line the bank sent, rather than a single wrapped
              paragraph — the seams carry meaning (an order number, a contract,
              a period) and are what a reader is looking for. */}
          <div className="doc-rule-strong pt-[var(--s-3)]">
            {lines.map((line, i) => (
              <p key={i} className="doc-body">{line}</p>
            ))}
            {tx.additionalInformation && (
              <p className="doc-small doc-quiet num mt-[var(--s-2)]">{tx.additionalInformation}</p>
            )}
          </div>
        </Block>
      )}

      <div className="mt-[var(--s-7)] grid grid-cols-2 gap-x-[var(--s-7)] items-start">
        <PairBlock
          flush
          title="Buchung"
          rows={[
            { label: 'Buchungstag', value: fmtDate(tx.entryDate), cast: 'num' },
            { label: 'Wertstellung', value: fmtDate(tx.valueDate), cast: 'num' },
            { label: 'Vorfallcode', value: tx.transactionCode, cast: 'num' },
            { label: 'Primanota', value: tx.primeNotesNr, cast: 'num' },
            { label: 'Auszug', value: tx.statementNumber, cast: 'num' },
          ]}
        />
        <PairBlock flush title="Referenzen" rows={references} />
      </div>

      {balance && (
        // The account as a whole, at the moment it was last fetched. Deliberately
        // not "balance after this booking": that figure can only be derived from
        // a complete run of later transactions, which a single receipt does not
        // have, and a plausible-looking wrong balance is worse than none.
        <PairBlock
          title="Konto zum Abrufzeitpunkt"
          rows={[
            { label: `Kontostand vom ${fmtDate(balance.date)}`, value: fmtSignedMoney(balance.balance, balance.currency), cast: 'num' },
            { label: 'Verfügbar', value: balance.availableAmount != null ? fmtSignedMoney(balance.availableAmount, balance.currency) : '', cast: 'num' },
            { label: 'Kontoüberziehung', value: balance.creditLimit != null ? fmtMoney(balance.creditLimit, balance.currency) : '', cast: 'num' },
          ]}
        />
      )}

      <EndMarker label="Ende des Buchungsbelegs" />

      <SheetFooter
        stamp={stamp}
        notes={[
          SIGN_NOTE,
          pending
            ? 'Dieser Umsatz ist vorgemerkt und noch nicht gebucht. Betrag, Wertstellung und Referenzen können sich bis zur Buchung noch ändern.'
            : 'Die Wertstellung (Valuta) bestimmt die Zinsrechnung und kann vom Buchungstag abweichen.',
          DISCLAIMER,
        ]}
      />
    </article>
  );
}
