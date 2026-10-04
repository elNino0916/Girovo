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
// globals.css: five type sizes in points, a spacing scale in points, one label
// rail every block aligns to, three rules and one tinted panel. Structure comes
// from alignment and space — a printed financial document earns its authority
// from order, and a page of competing enclosures reads as busy instead.
//
// The paper is a record for people who are not the user, so it prints what
// the bank sent: names, purposes and references word for word (only encoding
// damage repaired), balances only as the bank reported them or plainly marked
// as worked out, and a booking's state exactly as the screen states it —
// vorgemerkt, noch nicht gebucht, gebucht. What it says, and the arithmetic
// behind it, lives in lib/print-doc.ts; this file only lays it out.
//
// The footer says plainly that the document was generated here, seals it with
// a SHA-256 over the exact data on the page, and names the generator.

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { isCardAccount } from '@/lib/balances';
import { txBic } from '@/lib/categories';
import { dayKey, fmtDate, fmtDecimal, fmtIban, ibanCountry, translateType } from '@/lib/format';
import {
  bankLine, bookingReferences, bookingState, creditLine, cssString, fmtBalance, fmtBlz, fmtMovement, paperText,
  statementLedger, statementNumberRange, statementPeriod,
  type BookingState, type DocRef, type LedgerFigure, type StatementLedger,
} from '@/lib/print-doc';
import type { SerializedAccount, SerializedBalance, SerializedTransaction } from '@/lib/fints-types';
import type { ChosenBank, PrintJob } from './FintsProvider';
import { useFints, useLogoFile } from './FintsProvider';

const APP_NAME = 'Sooskasse-FinTS';
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '';

type StatementJob = Extract<PrintJob, { kind: 'statement' }>;
type TransactionJob = Extract<PrintJob, { kind: 'transaction' }>;

export function Statement() {
  const { printJob, closePrintJob, toast } = useFints();
  const stamp = useSeal(printJob);
  const sheet = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!printJob || !stamp) return;
    let cancelled = false;
    // The desktop shell exports straight out of Chromium instead of going
    // through window.print(): on Windows that route hands the PDF to the OS
    // print dialog's "Microsoft Print to PDF" virtual printer, whose driver is
    // a separate OS component that can fail with "Configuration error.
    // 0x80070002" on machines where it's missing or corrupt — see main.cjs.
    const electronPDF = typeof window !== 'undefined' ? window.electronPDF : undefined;

    const onAfterPrint = () => closePrintJob();
    if (!electronPDF) window.addEventListener('afterprint', onAfterPrint);

    // Marks first, then one frame to paint them, then the export.
    void marksSettled(sheet.current).then(() => {
      if (cancelled) return;
      requestAnimationFrame(() => {
        if (cancelled) return;
        if (electronPDF) {
          electronPDF.exportPDF(suggestedFileName(printJob, stamp))
            .then((result) => {
              if (!result.ok && 'error' in result) {
                toast(`PDF konnte nicht gespeichert werden: ${result.error}`, 'error');
              }
            })
            .finally(() => {
              if (!cancelled) closePrintJob();
            });
        } else {
          window.print();
        }
      });
    });

    return () => {
      cancelled = true;
      if (!electronPDF) window.removeEventListener('afterprint', onAfterPrint);
    };
  }, [printJob, stamp, closePrintJob, toast]);

  if (!printJob || !stamp) return null;
  return <DocumentSheet ref={sheet} job={printJob} stamp={stamp} className="hidden print:block" />;
}

/**
 * A sheet on screen, at A4 width with its page margins — for the design
 * preview, which renders documents to look at and never prints them. The same
 * component the print path uses, so what the preview shows is what the paper
 * says (printing the preview page gives the real pages, too).
 */
export function DocumentPreview({ job }: { job: PrintJob }) {
  const stamp = useSeal(job);
  if (!stamp) return null;
  return <DocumentSheet job={job} stamp={stamp} className="doc-paper" />;
}

function DocumentSheet({
  job, stamp, className, ref,
}: { job: PrintJob; stamp: DocStamp; className: string; ref?: Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={`sheet doc ${className}`}>
      {job.kind === 'statement'
        ? <StatementSheet job={job} stamp={stamp} />
        : <TransactionSheet job={job} stamp={stamp} />}
    </div>
  );
}

/**
 * The seal for a job, once its digest has resolved — null until then.
 *
 * The footer states a checksum over the exact data on the page, so a sheet
 * must not reach the print dialog before the digest exists — otherwise the
 * document would go out without its own seal. The stamp is kept with the job
 * it sealed, so a new job never prints under the previous one's seal.
 */
function useSeal(job: PrintJob | null): DocStamp | null {
  const [sealed, setSealed] = useState<{ job: PrintJob; stamp: DocStamp } | null>(null);
  useEffect(() => {
    if (!job) return;
    let alive = true;
    void sealDocument(job).then((stamp) => {
      if (alive) setSealed({ job, stamp });
    });
    return () => {
      alive = false;
    };
  }, [job]);
  return sealed && sealed.job === job ? sealed.stamp : null;
}

/** How long a slow mark may hold up the print dialog before it goes without. */
const MARK_GRACE_MS = 3000;

/**
 * Resolves once every mark on the sheet has settled — loaded or failed.
 *
 * window.print() snapshots the page synchronously, so an image still in flight
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

/** The desktop save dialog's default filename — kept short and filesystem-safe. */
function suggestedFileName(job: PrintJob, stamp: DocStamp): string {
  const base = job.kind === 'statement' ? 'Kontoauszug' : 'Buchungsbeleg';
  return `${base}_${stamp.docId}.pdf`;
}

// ---------------------------------------------------------------------------
// Document identity
// ---------------------------------------------------------------------------

type DocStamp = {
  /** Human-citable reference, printed in the letterhead and on every page. */
  docId: string;
  /** SHA-256 over the document's data, or null where WebCrypto is unavailable. */
  sha: string | null;
  /** Fixed at seal time, so the printed timestamp, the digest and every "noch nicht gebucht" agree. */
  created: Date;
};

const s = (v: unknown) => String(v ?? '');

/**
 * Every value the sheet will print, in a fixed order.
 *
 * This — not the PDF bytes, which the browser produces and this code never
 * sees — is what the footer's checksum covers, so the footer names it as a
 * digest of the document's *data*. The day of creation is part of it: whether
 * a booking prints as "noch nicht gebucht" depends on it.
 */
function canonical(job: PrintJob, created: Date): string {
  const acct = (a: SerializedAccount) =>
    [a.accountNumber, a.iban, a.bic, a.currency, a.accountType, a.product, a.holder].map(s).join('|');
  const bank = (b: ChosenBank | null) => [b?.name, b?.bic, b?.blz].map(s).join('|');
  const bal = (b: SerializedBalance | null) =>
    b ? [b.balance, b.currency, dayKey(b.date), b.availableAmount, b.creditLimit].map(s).join('|') : '';
  const entry = (t: SerializedTransaction) =>
    [
      t.entryDate, t.valueDate, t.amount, t.currency, t.remoteName, t.ultimateName, t.remoteIban, t.remoteBic,
      t.creditorId, t.purpose, t.bookingText, t.e2eReference, t.mandateReference, t.customerReference,
      t.bankReference, t.transactionCode, t.primeNotesNr, t.statementNumber, t.additionalInformation,
    ].map(s).join('|');
  const head = [job.kind === 'statement' ? 'kontoauszug' : 'buchungsbeleg', dayKey(created), acct(job.account), bank(job.bank)];

  if (job.kind === 'statement') {
    return [
      ...head, bal(job.balance), s(job.from), s(job.to),
      ...(job.blocks ?? []).map((b) =>
        [b.openingBalance, dayKey(b.openingDate), b.closingBalance, dayKey(b.closingDate), b.currency].map(s).join('|')),
      ...job.transactions.map(entry),
    ].join('\n');
  }
  return [...head, String(job.pending), entry(job.tx)].join('\n');
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
  const payload = canonical(job, created);
  const sha = await sha256Hex(payload);
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${created.getFullYear()}${pad(created.getMonth() + 1)}${pad(created.getDate())}`;
  // Derived from the contents, so the same data on the same day always yields
  // the same reference and two different exports never collide.
  return { docId: `SK-${day}-${sha ? sha.slice(0, 8).toUpperCase() : fnv1a(payload)}`, sha, created };
}

/** "04.10.2026, 14:32 Uhr (MESZ)" — a timestamp that says which clock it is on. */
function fmtCreated(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const zone = new Intl.DateTimeFormat('de-DE', { timeZoneName: 'short' })
    .formatToParts(d)
    .find((part) => part.type === 'timeZoneName')?.value;
  return `${fmtDate(d)}, ${pad(d.getHours())}:${pad(d.getMinutes())} Uhr${zone ? ` (${zone})` : ''}`;
}

// ---------------------------------------------------------------------------
// The document system
// ---------------------------------------------------------------------------

/**
 * The text in the bottom page margin, on every printed page: what the page
 * belongs to on the left, the reference and "Seite 2 von 3" on the right — so
 * a page that comes loose can still be put back, and a reader can see that
 * none is missing.
 *
 * Page-margin boxes inherit from the page, not from the sheet, and next/font
 * sets the face's variable on <body> — so the face is read off the sheet once
 * it is mounted and written into the rule. Until then (and in an engine
 * without margin boxes) the page simply carries no marks.
 */
function PageMarks({ left, right }: { left: string; right: string }) {
  const ref = useRef<HTMLStyleElement>(null);
  const [family, setFamily] = useState('');
  useLayoutEffect(() => {
    const host = ref.current?.parentElement;
    if (host) setFamily(getComputedStyle(host).fontFamily);
  }, []);
  const box = `${family ? `font-family: ${family};` : ''} font-size: 8pt; color: #5f6b78;`;
  const css =
    `@page { @bottom-left { content: ${cssString(left)}; ${box} }` +
    ` @bottom-right { content: ${cssString(`${right} · Seite `)} counter(page) " von " counter(pages); ${box} } }`;
  return <style ref={ref}>{css}</style>;
}

type Cast = 'text' | 'fig' | 'mono' | 'iban' | 'ref';

const CAST_CLASS: Record<Cast, string> = {
  text: '',
  fig: 'doc-fig',
  mono: 'doc-mono',
  iban: 'doc-mono doc-iban',
  ref: 'doc-mono doc-ref',
};

/** One label/value pair on the rail. Rendered as two grid cells, not a row. */
type Pair = { label: string; value: ReactNode; cast?: Cast };

/**
 * A block of label/value pairs on the shared rail, under a heading.
 *
 * Returns nothing at all when no row has a value, so a document can never
 * print a heading over an empty space — the sparse cases (a Vormerkposten with
 * no references yet) are the common ones, not the exception.
 */
function PairBlock({ title, rows }: { title: string; rows: Pair[] }) {
  const filled = rows.filter((r) => r.value !== '' && r.value != null);
  if (!filled.length) return null;
  return (
    <Block title={title}>
      <Pairs rows={filled} />
    </Block>
  );
}

function Pairs({ rows, rail = 'full' }: { rows: Pair[]; rail?: 'full' | 'auto' }) {
  return (
    <div className={rail === 'auto' ? 'doc-pairs doc-pairs-auto' : 'doc-pairs'}>
      {rows.map(({ label, value, cast = 'text' }, i) => (
        <Fragment key={`${label}-${i}`}>
          <span className="doc-label">{label}</span>
          <span className={CAST_CLASS[cast]}>{value}</span>
        </Fragment>
      ))}
    </div>
  );
}

/** A titled block. The heading stays with what it introduces. */
function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="doc-block keep">
      <h2 className="doc-section keep-next">{title}</h2>
      {children}
    </section>
  );
}

/**
 * The institution's mark, with a monogram behind it.
 *
 * A logo that fails to load leaves an image element with no intrinsic size, which
 * collapses to zero width and takes the letterhead's mark away silently. The
 * monogram is what the document falls back to — a brand with no file of its
 * own, and a file that could not be fetched, look the same and both keep the
 * letterhead's proportions.
 */
function BankMark({ bank, logoFile }: { bank: ChosenBank | null; logoFile?: string }) {
  const [broken, setBroken] = useState(false);

  if (logoFile && !broken) {
    return (
      // A mark beside the bank's own name: decorative, so no alt text.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={`/logos/${logoFile}`} alt="" onError={() => setBroken(true)} className="doc-mark" />
    );
  }

  return (
    <span className="doc-monogram" aria-hidden>
      {(bank?.name || '?').trim().slice(0, 1).toUpperCase()}
    </span>
  );
}

/**
 * The letterhead: the institution the account is held at on the left, the
 * document's name and its reference block on the right, closed by the navy
 * rule. The bank is named as the account's institution — not as the
 * document's author: it did not issue this sheet, and the letterhead is not
 * allowed to imply that it did. The generator names itself in the footer.
 */
function Letterhead({
  bank, title, info,
}: { bank: ChosenBank | null; title: string; info: [string, ReactNode, Cast?][] }) {
  const logoFile = useLogoFile(bank?.brand);
  const codes = [
    bank?.bic ? ['BIC', bank.bic] : null,
    bank?.blz ? ['BLZ', fmtBlz(bank.blz)] : null,
  ].filter((c): c is [string, string] => !!c);
  return (
    <header className="doc-head keep">
      <div className="flex min-w-0 items-start gap-[var(--s-5)]">
        <BankMark bank={bank} logoFile={logoFile} />
        <div className="min-w-0">
          <p className="doc-lead">{bank?.name || 'Bank'}</p>
          <p className="doc-small doc-soft mt-[var(--s-1)]">Kontoführendes Institut</p>
          {codes.length > 0 && (
            <Facts
              className="doc-small doc-soft"
              items={codes.map(([label, value]) => <>{label}{NBSP}<span className="doc-mono">{value}</span></>)}
            />
          )}
        </div>
      </div>

      <div className="shrink-0">
        <h1 className="doc-title">{title}</h1>
        <div className="doc-info doc-small">
          {info.map(([label, value, cast = 'text']) => (
            <Fragment key={label}>
              <span className="doc-soft">{label}</span>
              <span className={CAST_CLASS[cast]}>{value}</span>
            </Fragment>
          ))}
        </div>
      </div>
    </header>
  );
}

const NBSP = '\u00a0';

/**
 * A run of short facts separated by dots. The dot is glued to the fact before
 * it, so a wrapped line never starts with one; a label is glued to its value
 * the same way where the caller joins them with NBSP.
 */
function Facts({ items, className }: { items: ReactNode[]; className: string }) {
  if (!items.length) return null;
  return (
    <p className={className}>
      {items.map((item, i) => (
        <Fragment key={i}>
          {i > 0 && `${NBSP}· `}
          {item}
        </Fragment>
      ))}
    </p>
  );
}

/** The end-of-document line: a printed document says where it stops. */
function EndMarker({ label }: { label: string }) {
  return <p className="doc-end doc-small doc-quiet keep">{label}</p>;
}

/**
 * Who made this, from what, and its seal. Plainly not the bank: the sentence
 * every sheet ends on says the bank did not issue it.
 */
function SheetFooter({ stamp, notes }: { stamp: DocStamp; notes: string[] }) {
  const generator = [APP_NAME, APP_VERSION].filter(Boolean).join(' ');
  return (
    <footer className="doc-foot doc-small doc-quiet keep">
      <div className="max-w-[150mm] space-y-[var(--s-1)]">
        {notes.map((note) => (
          <p key={note}>{note}</p>
        ))}
        <p>
          Erstellt mit {generator} aus den Daten, die die Bank per FinTS übermittelt hat. Die Bank hat dieses
          Dokument nicht ausgestellt; maßgeblich sind ihre eigenen Kontoauszüge.
        </p>
      </div>

      {stamp.sha && (
        <p className="mt-[var(--s-3)] flex gap-[var(--s-4)]">
          {/* Over the data the sheet prints (see canonical), not over the PDF's bytes. */}
          <span className="shrink-0">Prüfsumme (SHA-256)</span>
          {/* Grouped in eights so a reader can compare it against another copy
              without losing their place, and free to wrap at those seams. */}
          <span className="doc-mono">{(stamp.sha.toUpperCase().match(/.{1,8}/g) || []).join(' ')}</span>
        </p>
      )}
    </footer>
  );
}

/** "1.777,78 EUR" — a balance with its currency, as the paper states money outside the table. */
const balanceText = (v: number, currency: string) => `${fmtBalance(v)} ${currency}`;

// ---------------------------------------------------------------------------
// Kontoauszug (date-range statement)
// ---------------------------------------------------------------------------

/** Oldest first by local Buchungstag; within a day, in the bank's own order. */
function oldestFirst(txs: readonly SerializedTransaction[]): SerializedTransaction[] {
  return txs
    .map((tx, i) => ({ tx, i, day: dayKey(tx.entryDate || tx.valueDate) }))
    .sort((a, b) => (a.day === b.day ? a.i - b.i : a.day < b.day ? -1 : 1))
    .map((x) => x.tx);
}

const AHEAD_NOTE =
  '„Noch nicht gebucht“: Die Bank hat den Umsatz bereits gemeldet, sein Buchungstag liegt aber nach dem Erstellungsdatum.';

function StatementSheet({ job, stamp }: { job: StatementJob; stamp: DocStamp }) {
  const { account, bank, balance, transactions } = job;
  const currency = balance?.currency || account.currency || 'EUR';
  const rows = oldestFirst(transactions);
  const states = rows.map((t) => bookingState(t, false, stamp.created));
  const ledger = statementLedger({
    txs: transactions,
    closing: balance ? { balance: balance.balance, date: balance.date } : null,
    blocks: job.blocks,
    currency,
  });
  const period = statementPeriod(job.from, job.to, transactions);
  const periodText = `${period.from ? fmtDate(period.from) : '—'} – ${period.to ? fmtDate(period.to) : '—'}`;
  const stmtNo = statementNumberRange(rows);
  const iban = fmtIban(account.iban);
  // A card by its Kontoart is a card on paper, as on screen (its line below is a Kreditrahmen).
  const kind = isCardAccount(account) ? 'Kreditkarte' : translateType(account.accountType);

  const notes = [
    states.includes('ahead') ? AHEAD_NOTE : '',
    ledger.opening?.source === 'derived'
      ? 'Alter Kontostand errechnet: neuer Kontostand abzüglich der Umsätze, die er enthält. Einen Anfangssaldo hat die Bank nicht gemeldet.'
      : '',
    ledger.closing?.source === 'derived'
      ? 'Neuer Kontostand errechnet: alter Kontostand zuzüglich der Umsätze dieses Auszugs. Einen Endsaldo hat die Bank nicht gemeldet.'
      : '',
    'Vorgemerkte Umsätze sind nicht enthalten: Die Bank hat sie noch nicht gebucht.',
  ].filter(Boolean);

  return (
    <article>
      <PageMarks
        left={['Kontoauszug', iban || account.accountNumber, periodText].filter(Boolean).join(' · ')}
        right={stamp.docId}
      />
      <Letterhead
        bank={bank}
        title="Kontoauszug"
        info={[
          ['Zeitraum', periodText, 'fig'],
          ...(stmtNo ? [['Auszug-Nr.', stmtNo, 'fig'] as [string, string, Cast]] : []),
          ['Erstellt', fmtCreated(stamp.created), 'fig'],
          ['Dokument', stamp.docId, 'mono'],
        ]}
      />

      {/* Whose account, and which one. */}
      <section className="doc-columns keep mt-[var(--s-5)]">
        <Pairs
          rows={[
            { label: 'Kontoinhaber', value: <span className="doc-strong">{bankLine(account.holder) || '—'}</span> },
            { label: 'Konto', value: [kind, account.product].filter((v, i, all) => v && all.indexOf(v) === i).join(' · ') },
          ]}
        />
        <Pairs
          rail="auto"
          rows={[
            ...(iban ? [{ label: 'IBAN', value: iban, cast: 'iban' } satisfies Pair] : []),
            { label: 'Kontonummer', value: account.accountNumber, cast: 'mono' },
          ]}
        />
      </section>

      <section className="doc-block doc-block-table">
        <h2 className="doc-section keep-next">Umsätze</h2>
        <table className="doc-table">
          <thead>
            {/* Repeats on every printed page; the page margin names the account. */}
            <tr>
              <th scope="col" className="doc-col-date">Buchungstag</th>
              <th scope="col" className="doc-col-date">Wertstellung</th>
              <th scope="col" className="doc-col-text">Vorgang</th>
              <th scope="col" className="doc-col-amount">Betrag{ledger.mixed ? '' : ` in ${currency}`}</th>
            </tr>
          </thead>
          <tbody>
            {ledger.opening && <BalanceRow label="Alter Kontostand" figure={ledger.opening} />}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="doc-quiet py-[var(--s-7)] text-center">Keine Umsätze in diesem Zeitraum.</td>
              </tr>
            )}
            {rows.map((t, i) => (
              <BookingRow key={i} tx={t} state={states[i]} mixed={ledger.mixed} />
            ))}
          </tbody>
        </table>
      </section>

      <Totals ledger={ledger} currency={currency} balance={balance} account={account} />

      <EndMarker label={`Ende des Kontoauszugs · ${endCount(rows.length, ledger.outstanding?.count ?? 0)}`} />
      <SheetFooter stamp={stamp} notes={notes} />
    </article>
  );
}

/**
 * The end line's count, matching the sums above it: the bookings the balance
 * contains, plus those set apart as "Noch nicht enthalten" — so a reader who
 * adds Gutschriften and Belastungen finds the same number.
 */
function endCount(rows: number, outstanding: number): string {
  const counted = rows - outstanding;
  const head = counted === 1 ? '1 Umsatz' : `${counted} Umsätze`;
  if (!outstanding) return head;
  return `${head}, dazu ${outstanding} noch nicht ${outstanding === 1 ? 'enthaltener' : 'enthaltene'}`;
}

/** "Alter Kontostand am 05.07.2026" — the ledger's first line, in the amount column. */
function BalanceRow({ label, figure }: { label: string; figure: LedgerFigure }) {
  return (
    <tr className="doc-row-balance keep-next">
      <td colSpan={3} className="doc-col-text">
        {label}
        {figure.date && <> am <span className="doc-fig">{fmtDate(figure.date)}</span></>}
        {figure.source === 'derived' && <span className="doc-soft font-normal"> (errechnet)</span>}
      </td>
      <td className="doc-col-amount doc-fig">{fmtBalance(figure.amount)}</td>
    </tr>
  );
}

/**
 * The references a statement row carries, under short labels — the creditor
 * first, because with the mandate it is what identifies a direct debit. A
 * reference the purpose already prints (an order number) is not repeated.
 */
const ROW_REFS: { key: DocRef['key']; label: string }[] = [
  { key: 'cred', label: 'Gläubiger-ID' },
  { key: 'mref', label: 'Mandatsref.' },
  { key: 'eref', label: 'End-to-End-Ref.' },
];

function BookingRow({ tx, state, mixed }: { tx: SerializedTransaction; state: BookingState; mixed: boolean }) {
  const text = paperText(tx);
  const refs = bookingReferences(tx, text.parsed);
  const prose = text.purposeLines.join(' ');
  const credit = Math.round(tx.amount * 100) > 0;
  const iban = fmtIban(tx.remoteIban);

  const meta: ReactNode[] = [];
  if (text.via) meta.push(`über ${text.via}`);
  if (iban) meta.push(<span className="doc-mono doc-iban">{iban}</span>);
  for (const { key, label } of ROW_REFS) {
    const ref = refs.find((r) => r.key === key);
    if (ref && !prose.includes(ref.value)) {
      meta.push(<><span className="whitespace-nowrap">{label}</span>{NBSP}<span className="doc-mono doc-ref">{ref.value}</span></>);
    }
  }

  return (
    <tr>
      <td className="doc-col-date">
        <span className="doc-fig">{fmtDate(tx.entryDate || tx.valueDate)}</span>
        {state === 'ahead' && <span className="doc-small doc-soft block">noch nicht gebucht</span>}
      </td>
      <td className="doc-col-date doc-fig">{fmtDate(tx.valueDate)}</td>
      <td className="doc-col-text">
        {/* Who, then what kind of booking — on one line. */}
        <p>
          <span className="doc-strong">{text.name || text.bookingText || 'Buchung'}</span>
          {text.name && text.bookingText && <span className="doc-kind">{text.bookingText}</span>}
        </p>
        {text.bankName && <p className="doc-small doc-soft">Name laut Bank: {text.bankName}</p>}
        {text.purposeLines.map((line, n) => (
          <p key={n} className="doc-soft">{line}</p>
        ))}
        {meta.length > 0 && (
          <Facts className="doc-small doc-quiet mt-[var(--s-1)]" items={meta} />
        )}
      </td>
      <td className={`doc-col-amount doc-fig doc-strong ${credit ? 'doc-credit' : ''}`}>
        {fmtMovement(tx.amount)}
        {mixed && <span className="doc-small doc-quiet"> {tx.currency}</span>}
      </td>
    </tr>
  );
}

/**
 * The arithmetic a reader checks, under the amount column: the two sums, then
 * the new balance. Alter Kontostand opened the table; together they add up —
 * and where the bank's own figures do not, the sheet says by how much rather
 * than making them fit.
 */
function Totals({
  ledger, currency, balance, account,
}: { ledger: StatementLedger; currency: string; balance: SerializedBalance | null; account: SerializedAccount }) {
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const limit = creditLine(balance?.creditLimit, account.accountType);
  const qualifiers = [
    balance?.availableAmount != null ? `Verfügbar ${balanceText(balance.availableAmount, balance.currency)}` : '',
    limit && balance ? `${limit.label} ${balanceText(limit.amount, balance.currency)}` : '',
  ].filter(Boolean);

  return (
    <section className="doc-totals keep" aria-label="Summen und Kontostand">
      {ledger.mixed ? (
        <p className="doc-small doc-soft">Die Umsätze sind in mehreren Währungen geführt und werden nicht addiert.</p>
      ) : (
        <>
          <div className="doc-totals-row">
            <span className="doc-soft"><span className="doc-fig">{count(ledger.credits.count, 'Gutschrift', 'Gutschriften')}</span></span>
            <span className={`doc-fig doc-strong ${ledger.credits.count ? 'doc-credit' : ''}`}>{fmtMovement(ledger.credits.sum)}</span>
          </div>
          <div className="doc-totals-row">
            <span className="doc-soft"><span className="doc-fig">{count(ledger.debits.count, 'Belastung', 'Belastungen')}</span></span>
            <span className="doc-fig doc-strong">{fmtMovement(ledger.debits.sum)}</span>
          </div>
        </>
      )}

      {/* The final figure between a rule and a double rule — the
          Summenstrich a reader of any German statement knows. */}
      <div className="doc-totals-row doc-total-final">
        <span className="doc-strong">
          Neuer Kontostand
          {ledger.closing?.date && <> am <span className="doc-fig">{fmtDate(ledger.closing.date)}</span></>}
          {ledger.closing?.source === 'derived' && <span className="doc-soft font-normal"> (errechnet)</span>}
        </span>
        <span className="doc-lead doc-fig font-bold">
          {ledger.closing ? balanceText(ledger.closing.amount, currency) : 'nicht gemeldet'}
        </span>
      </div>

      {ledger.outstanding && (
        <div className="doc-totals-row doc-small doc-soft">
          <span>
            Noch nicht enthalten: {ledger.outstanding.count === 1 ? '1 Umsatz vom' : `${ledger.outstanding.count} Umsätze ab`}{' '}
            <span className="doc-fig">{fmtDate(ledger.outstanding.firstDay)}</span>
          </span>
          <span className="doc-fig">{fmtMovement(ledger.outstanding.sum)}</span>
        </div>
      )}
      {ledger.difference != null && (
        <p className="doc-small doc-soft mt-[var(--s-1)]">
          Alter und neuer Kontostand stammen von der Bank; die Umsätze dieses Auszugs erklären{' '}
          <span className="doc-fig">{fmtDecimal(Math.abs(ledger.difference))} {currency}</span> des Unterschieds nicht.
        </p>
      )}
      {qualifiers.length > 0 && (
        <Facts className="doc-small doc-soft mt-[var(--s-1)] text-right" items={qualifiers} />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Buchungsbeleg (single-transaction receipt)
// ---------------------------------------------------------------------------

const STATE_WORD: Record<BookingState, string> = {
  booked: 'gebucht',
  pending: 'vorgemerkt',
  ahead: 'noch nicht gebucht',
};

function TransactionSheet({ job, stamp }: { job: TransactionJob; stamp: DocStamp }) {
  const { account, bank, tx } = job;
  const state = bookingState(tx, job.pending, stamp.created);
  const text = paperText(tx);
  const credit = Math.round(tx.amount * 100) > 0;
  const currency = tx.currency || account.currency || 'EUR';
  const own = ibanCountry(account.iban);
  const remote = ibanCountry(tx.remoteIban);
  // A country line only where it says something: when either side is abroad.
  const showCountry = (own && own.code !== 'DE') || (remote && remote.code !== 'DE');
  const entryDay = dayKey(tx.entryDate);
  const valueDay = dayKey(tx.valueDate);
  const extra = String(tx.additionalInformation ?? '').trim();
  const showExtra = !!extra && extra.toLowerCase() !== text.bookingText.toLowerCase();

  const subline = [
    text.bookingText,
    text.via ? `über ${text.via}` : '',
  ].filter(Boolean);

  return (
    <article>
      <PageMarks left="Buchungsbeleg" right={stamp.docId} />
      <Letterhead
        bank={bank}
        title="Buchungsbeleg"
        info={[
          ['Erstellt', fmtCreated(stamp.created), 'fig'],
          ['Dokument', stamp.docId, 'mono'],
        ]}
      />

      {/* What this document is about: who, how much, which way, and whether
          it is booked. The figure is the largest thing on the page. */}
      <section className="keep mt-[var(--s-6)] flex items-start justify-between gap-[var(--s-7)]">
        <div className="min-w-0">
          <p className="doc-label">{credit ? 'Auftraggeber' : 'Zahlungsempfänger'}</p>
          <p className="doc-name mt-[var(--s-1)]">{text.name || text.bookingText || '—'}</p>
          {subline.length > 0 && (
            <Facts className="doc-soft mt-[var(--s-1)]" items={subline} />
          )}
          {text.bankName && <p className="doc-small doc-soft mt-[var(--s-1)]">Name laut Bank: {text.bankName}</p>}
        </div>

        <div className="doc-panel shrink-0 text-right">
          <p className={`doc-display doc-fig ${credit ? 'doc-credit' : ''}`}>{fmtMovement(tx.amount)} {currency}</p>
          <p className="doc-soft doc-strong mt-[var(--s-2)]">
            {credit ? 'Gutschrift' : 'Belastung'} · {STATE_WORD[state]}
          </p>
        </div>
      </section>

      {/* Whether the money has moved is the first thing a reader of a receipt
          needs to know, so an unbooked state is said in a sentence, not only
          in a word. */}
      {state === 'pending' && (
        <p className="keep mt-[var(--s-5)]">
          <span className="doc-strong">Vorgemerkt, noch nicht gebucht. </span>
          <span className="doc-soft">
            Betrag, Wertstellung und Referenzen können sich bis zur Buchung noch ändern.
          </span>
        </p>
      )}
      {state === 'ahead' && (
        <p className="keep mt-[var(--s-5)]">
          <span className="doc-strong">Noch nicht gebucht. </span>
          <span className="doc-soft">
            Die Bank meldet den Umsatz mit dem Buchungstag <span className="doc-fig">{fmtDate(tx.entryDate)}</span>; er
            liegt nach dem Erstellungsdatum dieses Belegs.
          </span>
        </p>
      )}

      {/* Both sides of the payment against one rail: the labels are written
          once and the two accounts line up column against column. */}
      <Block title="Konten">
        <div className="doc-parties">
          <span />
          <span className="doc-label doc-strong">{credit ? 'Empfängerkonto' : 'Belastetes Konto'}</span>
          <span className="doc-label doc-strong">{credit ? 'Auftraggeberkonto' : 'Empfängerkonto'}</span>

          <span className="doc-label">Inhaber</span>
          <span>{bankLine(account.holder) || '—'}</span>
          <span>{bankLine(tx.remoteName) || '—'}</span>

          <span className="doc-label">IBAN</span>
          <span className="doc-mono doc-iban">{fmtIban(account.iban) || account.accountNumber}</span>
          <span className="doc-mono doc-iban">{fmtIban(tx.remoteIban) || '—'}</span>

          <span className="doc-label">BIC</span>
          <span className="doc-mono">{account.bic || bank?.bic || '—'}</span>
          <span className="doc-mono">{txBic(tx) || '—'}</span>

          {showCountry && (
            <>
              <span className="doc-label">Land</span>
              <span>{own?.name || '—'}</span>
              <span>{remote?.name || '—'}</span>
            </>
          )}
        </div>
      </Block>

      {(text.purposeLines.length > 0 || showExtra) && (
        <Block title="Verwendungszweck">
          {/* One line per line the bank sent, rather than a single wrapped
              paragraph — the seams carry meaning (an order number, a contract,
              a period) and are what a reader is looking for. */}
          {text.purposeLines.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
          {showExtra && <p className="doc-small doc-soft mt-[var(--s-2)]">{extra}</p>}
        </Block>
      )}

      <PairBlock
        title="Buchung"
        rows={[
          {
            label: 'Buchungstag',
            value: state === 'pending'
              ? 'noch nicht gebucht'
              : entryDay
                ? <><span className="doc-fig">{fmtDate(tx.entryDate)}</span>{state === 'ahead' && <span className="doc-soft"> · noch nicht gebucht</span>}</>
                : '',
          },
          {
            label: 'Wertstellung',
            value: valueDay
              ? <><span className="doc-fig">{fmtDate(tx.valueDate)}</span>{state === 'pending' && <span className="doc-soft"> · vorläufig</span>}</>
              : '',
          },
          { label: 'Buchungsart', value: text.bookingText },
          { label: 'Geschäftsvorfall-Code', value: String(tx.transactionCode ?? '').trim(), cast: 'mono' },
          // A Vormerkposten is on no Kontoauszug yet: a statement number or
          // Primanota beside "Vorgemerkt, noch nicht gebucht" would contradict
          // the sheet's own state line, so a pending booking prints neither.
          { label: 'Primanota', value: state === 'pending' ? '' : String(tx.primeNotesNr ?? '').trim(), cast: 'mono' },
          { label: 'Auszug-Nr.', value: state === 'pending' ? '' : String(tx.statementNumber ?? '').trim(), cast: 'mono' },
        ]}
      />

      <PairBlock
        title="Referenzen"
        rows={bookingReferences(tx, text.parsed).map((r: DocRef) => ({
          label: r.label,
          value: r.value,
          cast: r.iban ? 'iban' : r.key === 'field' && !/\d/.test(r.value) ? 'text' : 'ref',
        }))}
      />

      <EndMarker label="Ende des Buchungsbelegs" />
      <SheetFooter
        stamp={stamp}
        notes={state === 'booked' && entryDay && valueDay && entryDay !== valueDay
          ? ['Die Wertstellung (Valuta) bestimmt die Zinsberechnung und kann vom Buchungstag abweichen.']
          : []}
      />
    </article>
  );
}
