// The Steuer-Jahresübersicht: one calendar year's bookings in the categories
// the user picks — donations, tradespeople, insurance, health, whatever the
// tax return asks about — grouped, summed and ready to hand over as a PDF
// (components/Statement.tsx), a CSV, or a ZIP with the receipts kept on the
// bookings (lib/zip.ts).
//
// It is a compilation, not advice: the app does not know what is deductible
// and does not pretend to. It knows which bookings the user filed where — and
// with own categories and splits (lib/splits.ts) that can be exactly what the
// Finanzamt asks for. A split booking contributes only its share.
//
// The data horizon decides what may be said, as in the budgets: the app knows
// the loaded days only. A year they do not cover from 1 January to
// 31 December (or to today, in the running year) is incomplete, every sum is
// then a minimum, and the sheet says which days it covers per account.
//
// Booked Umsätze only (the lists hold no Vormerkposten), by Buchungstag, in
// euros; other currencies are set aside and counted.
//
// Pure and node-test-safe: no path aliases, `.ts` on sibling imports.

import type { CategoryOf } from './analytics';
import type { CategoryId } from './categories';
import type { SerializedAccount, SerializedTransaction } from './fints-types';
import { bookingDay, categoryPieces } from './analytics.ts';
import { categoryDef, categoryLabel, counterpartyName } from './categories.ts';
import { CSV_BOM, CSV_EOL, CSV_SEPARATOR, csvAmountCell, csvDateCell, csvIdCell, csvTextCell } from './csv.ts';
import { dayKey, prettyBookingText, repairBankText } from './format.ts';
import { msgs } from './i18n/index.ts';
import { parsePurpose, purposeLines } from './sepa-purpose.ts';

/** Which part of the year the loaded days of one account cover. */
export type YearCoverage = 'complete' | 'running' | 'partial' | 'none';

export type TaxLine = {
  tx: SerializedTransaction;
  accountNumber: string;
  /** What the booking adds to its group, signed like the booking: a split booking's share, else its amount. */
  amount: number;
  /** Only a share of the booking counts here (lib/splits.ts). */
  share: boolean;
};

export type TaxGroup = {
  id: CategoryId;
  /** Oldest first, as a ledger reads. */
  lines: TaxLine[];
  /** Signed: spending negative, income and refunds positive. */
  total: number;
};

export type AccountCoverage = {
  accountNumber: string;
  coverage: YearCoverage;
  /** The days of the year the loaded list covers, yyyy-mm-dd — absent for 'none'. */
  from?: string;
  to?: string;
};

export type TaxYear = {
  year: number;
  /** 1 January and 31 December of the year (the running year: today). */
  from: string;
  to: string;
  /** Spending groups first, then income; within each, the largest first. */
  groups: TaxGroup[];
  accounts: AccountCoverage[];
  /** Every account in scope covers its whole year (or up to today). Else every sum is a minimum. */
  complete: boolean;
  /** Bookings of the year in the picked categories, in a currency other than euros: left out. */
  otherCurrency: number;
};

const pad2 = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const cents = (v: number) => Math.round(Number(v) * 100);

/** The years a summary can be made for: every year with a loaded booking, and the running one; newest first. */
export function taxYears(txsByAccount: Record<string, readonly SerializedTransaction[]>, today = new Date()): number[] {
  const years = new Set<number>([today.getFullYear()]);
  for (const list of Object.values(txsByAccount)) {
    for (const tx of list) {
      const y = Number(bookingDay(tx).slice(0, 4));
      if (y > 1990 && y <= today.getFullYear()) years.add(y);
    }
  }
  return [...years].sort((a, b) => b - a);
}

/** The year a summary opens on: last year while its return is the usual one to do, else the newest with bookings. */
export function defaultTaxYear(years: readonly number[], today = new Date()): number {
  const last = today.getFullYear() - 1;
  return years.includes(last) ? last : years[0] ?? today.getFullYear();
}

/** How the loaded days `span` cover the year `year` (as of `today`). */
export function yearCoverage(
  span: { from: string; to: string } | null | undefined,
  year: number,
  today = new Date(),
): { coverage: YearCoverage; from?: string; to?: string } {
  const start = `${year}-01-01`;
  const running = year === today.getFullYear();
  const end = running ? isoDay(today) : `${year}-12-31`;
  if (!span?.from || !span.to) return { coverage: 'none' };
  const from = dayKey(span.from) > start ? dayKey(span.from) : start;
  const to = dayKey(span.to) < end ? dayKey(span.to) : end;
  if (from > to) return { coverage: 'none' };
  if (from === start && to === end) return { coverage: running ? 'running' : 'complete', from, to };
  return { coverage: 'partial', from, to };
}

/**
 * The summary of `year`: every booking of the year on the accounts in scope
 * whose category (or one of whose shares) is in `include`, grouped by
 * category. `spans` are the loaded days per account (statementInfo).
 */
export function taxYear(opts: {
  year: number;
  accounts: readonly Pick<SerializedAccount, 'accountNumber'>[];
  txsByAccount: Record<string, readonly SerializedTransaction[]>;
  spans: Record<string, { from: string; to: string } | null | undefined>;
  categoryOf: CategoryOf;
  include: ReadonlySet<CategoryId>;
  today?: Date;
}): TaxYear {
  const today = opts.today ?? new Date();
  const { year } = opts;
  const from = `${year}-01-01`;
  const to = year === today.getFullYear() ? isoDay(today) : `${year}-12-31`;
  const groups = new Map<CategoryId, TaxGroup>();
  let otherCurrency = 0;
  const accounts: AccountCoverage[] = [];

  for (const a of opts.accounts) {
    const cov = yearCoverage(opts.spans[a.accountNumber], year, today);
    accounts.push({ accountNumber: a.accountNumber, ...cov });
    for (const tx of opts.txsByAccount[a.accountNumber] ?? []) {
      const day = bookingDay(tx);
      if (day < `${year}-01-01` || day > `${year}-12-31`) continue;
      const pieces = categoryPieces(tx, opts.categoryOf).filter((p) => opts.include.has(p.id) && !categoryDef(p.id).neutral);
      if (!pieces.length) continue;
      if ((tx.currency || 'EUR') !== 'EUR') {
        otherCurrency++;
        continue;
      }
      const share = pieces.length > 1 || cents(tx.amount) !== pieces.reduce((s, p) => s + p.cents, 0);
      for (const p of pieces) {
        let g = groups.get(p.id);
        if (!g) groups.set(p.id, (g = { id: p.id, lines: [], total: 0 }));
        g.lines.push({ tx, accountNumber: a.accountNumber, amount: p.cents / 100, share });
        g.total = (cents(g.total) + p.cents) / 100;
      }
    }
  }

  const order = (g: TaxGroup) => (categoryDef(g.id).direction === 'in' || g.total > 0 ? 1 : 0);
  const sorted = [...groups.values()]
    .map((g) => ({ ...g, lines: g.lines.sort((x, y) => (bookingDay(x.tx) < bookingDay(y.tx) ? -1 : bookingDay(x.tx) > bookingDay(y.tx) ? 1 : 0)) }))
    .sort((x, y) => order(x) - order(y) || Math.abs(y.total) - Math.abs(x.total));

  return {
    year,
    from,
    to,
    groups: sorted,
    accounts,
    complete: accounts.length > 0 && accounts.every((a) => a.coverage === 'complete' || a.coverage === 'running'),
    otherCurrency,
  };
}

/** The bookings of a summary, once each, oldest first — what the receipts are looked up for. */
export function taxBookings(summary: TaxYear): SerializedTransaction[] {
  const seen = new Set<SerializedTransaction>();
  const out: SerializedTransaction[] = [];
  for (const g of summary.groups) for (const l of g.lines) if (!seen.has(l.tx)) { seen.add(l.tx); out.push(l.tx); }
  return out.sort((x, y) => (bookingDay(x) < bookingDay(y) ? -1 : bookingDay(x) > bookingDay(y) ? 1 : 0));
}

/** Who a line is with and what for, as one line of the bank's own words. */
export function taxLineText(tx: SerializedTransaction): { name: string; purpose: string } {
  const parsed = parsePurpose(repairBankText(tx.purpose));
  return {
    name: counterpartyName(tx) || prettyBookingText(tx.bookingText),
    purpose: purposeLines(parsed.text).join(' '),
  };
}

/**
 * The summary as a CSV for German Excel (the format of lib/csv.ts): one row
 * per line, in groups, the category first — so a pivot table or a filter on
 * the first column gives the sums back. A split booking's row carries its
 * share and says so. The file says nothing the PDF does not.
 */
export function taxYearCsv(
  summary: TaxYear,
  opts: {
    accountOf: (accountNumber: string) => Pick<SerializedAccount, 'iban' | 'accountNumber'> | undefined;
    noteOf?: (tx: SerializedTransaction) => string | undefined;
    receiptsOf?: (tx: SerializedTransaction) => readonly string[];
  },
): string {
  const words = msgs().tax.csv;
  const rows = [words.header.map(csvTextCell).join(CSV_SEPARATOR)];
  for (const g of summary.groups) {
    for (const l of g.lines) {
      const text = taxLineText(l.tx);
      const acct = opts.accountOf(l.accountNumber);
      rows.push([
        csvTextCell(categoryLabel(g.id)),
        csvDateCell(l.tx.entryDate || l.tx.valueDate),
        csvDateCell(l.tx.valueDate),
        csvIdCell(String(acct?.iban || l.accountNumber).replace(/\s+/g, '')),
        csvTextCell(text.name),
        csvTextCell(text.purpose),
        csvAmountCell(l.amount),
        l.share ? csvAmountCell(l.tx.amount) : '',
        csvTextCell(opts.noteOf?.(l.tx) ?? ''),
        csvTextCell((opts.receiptsOf?.(l.tx) ?? []).join(', ')),
      ].join(CSV_SEPARATOR));
    }
  }
  return CSV_BOM + rows.join(CSV_EOL) + CSV_EOL;
}

/** The file names the summary is offered under, ASCII only: "Steuerjahr_2025.pdf", "Steuerjahr_2025_Belege.zip". */
export function taxFileName(year: number, kind: 'pdf' | 'csv' | 'zip'): string {
  const words = msgs().tax.file;
  return kind === 'zip' ? `${words.base}_${year}_${words.receipts}.zip` : `${words.base}_${year}.${kind}`;
}
