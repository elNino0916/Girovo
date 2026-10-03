// Umsätze as a CSV file for Excel — the German one.
//
// German Excel opens a .csv by double-click only on its own terms: `;` as the
// separator (the comma is the decimal mark), a UTF-8 byte order mark or the
// umlauts come out as "Ã¼", dd.mm.yyyy dates, amounts with a decimal comma
// and no grouping, CRLF line ends. The columns follow the layout German
// online banking exports have made familiar, so an existing spreadsheet
// template keeps working — but this is the app's own export, built from the
// bookings it loaded, and nothing here may claim to be the bank's.
//
// Pure and dependency-free apart from sibling lib modules, so the
// `node --test` suite can run it under Node's own type stripping.

import { categoryLabel, isCategoryId, txBic, txCreditorId } from './categories.ts';
import type { CategoryId, CategoryResult } from './categories.ts';
import { prettyBookingText, repairBankText, translateType } from './format.ts';
import type { SerializedAccount, SerializedTransaction } from './fints-types';
import { parsePurpose, purposeLines } from './sepa-purpose.ts';

export const CSV_COLUMNS = [
  'Bezeichnung Auftragskonto',
  'IBAN Auftragskonto',
  'BIC Auftragskonto',
  'Bankname Auftragskonto',
  'Buchungstag',
  'Valutadatum',
  'Name Zahlungsbeteiligter',
  'IBAN Zahlungsbeteiligter',
  'BIC Zahlungsbeteiligter',
  'Buchungstext',
  'Verwendungszweck',
  'Betrag',
  'Waehrung',
  'Kategorie',
  'Glaeubiger ID',
  'Mandatsreferenz',
  'Kundenreferenz (End-to-End)',
  'Status',
] as const;

export type CsvOptions = {
  account: Pick<SerializedAccount, 'accountNumber' | 'iban' | 'bic' | 'currency' | 'accountType' | 'product'>;
  bankName: string;
  /** What the user calls the account (their alias); defaults to the product name or the account type. */
  accountLabel?: string;
  /** The category the app shows for a booking — the provider's `categoryOf`. Omitted: empty column. */
  categoryOf?: (tx: SerializedTransaction) => CategoryResult | CategoryId | null | undefined;
  /**
   * The rows (the very objects passed in) that are Vormerkposten rather than
   * booked. Decided by where a row came from, never by a key: a Vormerkposten
   * and the booking it became share day, amount, IBAN and reference, and a
   * key lookup would mark the booking "Vorgemerkt" too.
   */
  pendingRows?: ReadonlySet<SerializedTransaction>;
};

const SEPARATOR = ';';
const EOL = '\r\n';
const BOM = '﻿';

/**
 * One text cell.
 *
 * Formula guard first: a cell starting with = + - @ (or a tab / CR) is run as
 * a formula when Excel opens the file — and a counterparty's name or
 * Verwendungszweck is text anyone who sends you money can choose. A leading
 * apostrophe makes Excel show it as plain text (OWASP's recommendation).
 * Then RFC 4180: a cell containing the separator, a quote or a line break is
 * quoted, and its quotes doubled. Line breaks inside a cell are written as a
 * bare LF, which Excel shows as a line break within the cell.
 */
export function csvTextCell(value: unknown): string {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  s = s.replace(/\r\n?/g, '\n');
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** What Excel would read as a number, a date or a time rather than as text. */
const NUMBER_SHAPED = /^\d[\d .,:\/+\-eE%]*$/;

/**
 * One identifier cell: an IBAN or account number, a BIC or BLZ, a Gläubiger-ID,
 * a Mandats- or End-to-End-Referenz.
 *
 * Excel turns a cell that looks like a number into one: the Mandatsreferenz
 * "000123456789" loses its zeros, a 20-digit End-to-End-Referenz is cut to 15
 * significant digits and shown as 2,0261E+19 — and saving the workbook makes
 * that permanent. Such a cell is written as the text formula ="000123456789",
 * which Excel shows as exactly that text. The formula can carry nothing else:
 * it is written only for a value that starts with a digit and holds nothing
 * but digits, spaces and . , : / + - e E %, so no quote can close the string
 * and nothing in it can be a reference or a function. Everything else is an
 * ordinary text cell, formula guard included. Betrag never comes here — it has
 * to stay a number.
 */
export function csvIdCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  return NUMBER_SHAPED.test(s) ? `"=""${s}"""` : csvTextCell(s);
}

/**
 * One amount cell: "-1234,50". A plain ASCII minus (Excel does not read
 * U+2212 as a sign), a decimal comma, no thousands separator, and never
 * guarded or quoted — it has to stay a number Excel can sum.
 * Built from whole cents so binary floating point never shows through.
 */
export function csvAmountCell(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '';
  const cents = Math.round(value * 100);
  if (cents === 0) return '0,00';
  const abs = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

/**
 * dd.mm.yyyy of the *local* calendar day. Dates arrive as ISO strings of a
 * local midnight (JSON of a Date) — "2026-10-02T22:00:00.000Z" is the 3rd in
 * Germany, so the string's own date part must not be used.
 */
export function csvDateCell(value: Date | string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

const compact = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, '').toUpperCase();

/** "NOTPROVIDED" / "NONREF" are SEPA's way of saying "no reference". */
const reference = (s: string | null | undefined) => {
  const v = String(s ?? '').trim();
  return v && v !== 'NOTPROVIDED' && v !== 'NONREF' ? v : '';
};

// The tags with a column of their own; every other tag stays in the
// Verwendungszweck so the export loses nothing the statement said.
const OWN_COLUMN_TAGS = new Set(['EREF', 'MREF', 'CRED', 'SVWZ']);

function categoryCell(tx: SerializedTransaction, categoryOf: CsvOptions['categoryOf']): string {
  if (!categoryOf) return '';
  const result = categoryOf(tx);
  const id = typeof result === 'string' ? result : result?.id;
  return isCategoryId(id) ? categoryLabel(id) : '';
}

function row(tx: SerializedTransaction, opts: CsvOptions, accountCells: string[]): string {
  const parsed = parsePurpose(repairBankText(tx.purpose));
  const field = (tag: string) => parsed.fields.find((f) => f.tag === tag)?.value ?? '';
  // The prose on one line: Excel shows a multi-line cell as a row several
  // lines tall, and the line breaks in :86: are only where the bank's
  // 27-character subfields happened to end.
  const purpose = [
    purposeLines(parsed.text).join(' '),
    ...parsed.fields.filter((f) => !OWN_COLUMN_TAGS.has(f.tag)).map((f) => `${f.label}: ${f.value}`),
  ]
    .filter(Boolean)
    .join(' · ');

  const cells = [
    ...accountCells,
    csvDateCell(tx.entryDate),
    csvDateCell(tx.valueDate),
    csvTextCell(repairBankText(tx.remoteName).trim()),
    csvIdCell(compact(tx.remoteIban)),
    csvIdCell(txBic(tx)),
    csvTextCell(prettyBookingText(repairBankText(tx.bookingText))),
    csvTextCell(purpose),
    csvAmountCell(tx.amount),
    csvTextCell(tx.currency || opts.account.currency || 'EUR'),
    csvTextCell(categoryCell(tx, opts.categoryOf)),
    csvIdCell(txCreditorId(tx) ?? field('CRED')),
    csvIdCell(reference(tx.mandateReference) || reference(field('MREF'))),
    csvIdCell(reference(tx.e2eReference) || reference(field('EREF'))),
    csvTextCell(opts.pendingRows?.has(tx) ? 'Vorgemerkt' : 'Gebucht'),
  ];
  return cells.join(SEPARATOR);
}

/**
 * The CSV file's full text, BOM included, one row per booking in the order
 * given (pass them as the list shows them). Write it with
 * `downloadText(name, csv, 'text/csv;charset=utf-8')`.
 */
export function transactionsToCsv(txs: readonly SerializedTransaction[], opts: CsvOptions): string {
  const { account } = opts;
  const label = opts.accountLabel?.trim() || account.product?.trim() || translateType(account.accountType);
  const accountCells = [
    csvTextCell(label),
    csvIdCell(compact(account.iban)),
    csvIdCell(compact(account.bic)),
    csvTextCell(opts.bankName),
  ];
  const lines = [CSV_COLUMNS.join(SEPARATOR), ...txs.map((tx) => row(tx, opts, accountCells))];
  return BOM + lines.join(EOL) + EOL;
}

/**
 * "Umsaetze_593271_2026-07-05_2026-10-03.csv" — the last six characters of
 * the IBAN tell two accounts' exports apart without putting the whole IBAN
 * into a file name that ends up in a Downloads folder and in recent-files
 * lists. ASCII only: "ä" in a file name still trips up some mail clients.
 */
export function csvFileName(
  account: Pick<SerializedAccount, 'accountNumber' | 'iban'>,
  range: { from: string; to: string },
): string {
  const id = compact(account.iban || account.accountNumber).replace(/[^A-Z0-9]/g, '').slice(-6) || 'Konto';
  const day = (s: string) => String(s ?? '').replace(/[^0-9-]/g, '');
  const span = [day(range.from), day(range.to)].filter(Boolean).join('_');
  return `Umsaetze_${id}${span ? `_${span}` : ''}.csv`;
}
