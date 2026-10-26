// Older Umsätze from the bank's own export, into the kept history.
//
// A bank serves its Umsätze over FinTS for a while and then not at all, and
// "Umsätze behalten" only keeps what arrives from the day it is switched on.
// Most online bankings still let the user download years of them — as CSV,
// as camt.053 or as MT940. This reads such a file so the days it covers can
// fill the kept history where it has none (lib/history.ts fillGaps): what the
// bank delivered over FinTS is never replaced by a file.
//
// The formats:
//   - CSV in the German banks' layouts: Sparkasse ("CSV-CAMT"), the
//     Volksbanken and Raiffeisenbanken (Atruvia), and those that write
//     Buchung/Valuta/Betrag much alike (ING, DKB, Commerzbank, comdirect,
//     Postbank) — found by the header's words, not by the bank's name —
//     and Girovo's own export (lib/csv.ts), in either language.
//   - MT940 and camt.052/053, read with lib-fints' own parsers on the server
//     (lib/bank-import-fints.ts); they carry the bank's balances, so the days
//     they cover are proven like a FinTS answer.
//
// What a file vouches for: a CSV has no balances and says nothing about the
// days at its ends, so the days it covers are its first booking's to its
// last's — a file filtered by a search would claim days it does not hold
// whole, which is why the dialog asks for an unfiltered export of a period.
// MT940 and CAMT say where they start and end (lib/history.ts deliveredSpan).
//
// Pure and node-test-safe: no path aliases, `.ts` on sibling imports.

import { bankNumberOf } from './account-key.ts';
import type { SerializedTransaction, StatementBlock } from './fints-types';
import type { AccountHistory, DaySpan, HistoryData } from './history';
import { buildBalanceHistory } from './balance-history.ts';
import { balanceRuns, bookingDay, deliveredSpan, newestFirst, sanitizeBooking } from './history.ts';

export type ImportFormat = 'csv' | 'mt940' | 'camt';

/** What a file holds, read: its bookings, the bank's balances where the format has them, and whose account it is. */
export type ParsedImport = {
  format: ImportFormat;
  txs: SerializedTransaction[];
  blocks: StatementBlock[];
  /** The account the file names, where it names one (IBAN or account number, no spaces). */
  account: string | null;
  /** Rows the file had that are no booking (a pending entry, a broken line). */
  skipped: number;
};

/** The largest file read: ten years of a busy account, as CSV, with room to spare. */
export const IMPORT_MAX_BYTES = 24 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Telling the format
// ---------------------------------------------------------------------------

/** Which format a file is in, by what it says — never by its name. Null: none this reads. */
export function detectFormat(text: string): ImportFormat | null {
  const head = text.slice(0, 4096);
  if (/<Document[\s>][\s\S]*camt\.05[23]|<BkToCstmr(?:Stmt|AcctRpt)>/i.test(head) || /urn:iso:std:iso:20022:tech:xsd:camt\.05[23]/i.test(head)) return 'camt';
  if (/(^|\n|@@):20:/.test(head) && /:61:/.test(text.slice(0, 64 * 1024))) return 'mt940';
  if (/[;,\t]/.test(head) && /\d{1,2}\.\d{1,2}\.\d{2,4}|\d{4}-\d{2}-\d{2}/.test(text.slice(0, 64 * 1024))) return 'csv';
  return null;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** One CSV line into cells: RFC 4180 quoting, the separator given. */
function cells(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** The file's lines, a quoted cell's line breaks kept inside it. */
function lines(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of text.replace(/^﻿/, '')) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && (ch === '\n' || ch === '\r')) {
      if (cur.trim()) out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** A header word reduced to what tells it apart: "Beguenstigter/Zahlungspflichtiger" → "beguenstigterzahlungspflichtiger". */
const fold = (s: string) =>
  s.toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9]/g, '');

type Column =
  | 'entryDate' | 'valueDate' | 'name' | 'iban' | 'bic' | 'bookingText' | 'purpose' | 'amount' | 'debit' | 'credit'
  | 'sign' | 'currency' | 'creditorId' | 'mandate' | 'e2e' | 'account' | 'status' | 'ultimate';

// i18n-data-start — the words banks write in their export's header row, matched, never shown
const COLUMNS: Record<Column, string[]> = {
  entryDate: ['buchungstag', 'buchungsdatum', 'buchung', 'datum', 'bookingdate', 'date'],
  valueDate: ['valutadatum', 'valuta', 'wertstellung', 'wertstellungsdatum', 'wertstellungstag', 'valuedate'],
  name: [
    'beguenstigterzahlungspflichtiger', 'namezahlungsbeteiligter', 'auftraggeberempfaenger', 'zahlungsempfaengerin',
    'zahlungspflichtigerin', 'auftraggeberbeguenstigter', 'empfaenger', 'auftraggeber', 'beguenstigter', 'name',
  ],
  iban: ['kontonummeriban', 'ibanzahlungsbeteiligter', 'iban', 'kontonummer', 'gegenkonto'],
  bic: ['bic', 'bicswiftcode', 'biczahlungsbeteiligter', 'bankleitzahl'],
  bookingText: ['buchungstext', 'umsatztyp', 'vorgang', 'umsatzart', 'transactiontype', 'bookingtext'],
  purpose: ['verwendungszweck', 'purpose', 'beschreibung'],
  amount: ['betrag', 'umsatz', 'betrageur', 'amount', 'umsatzineur'],
  debit: ['soll', 'ausgang', 'belastung'],
  credit: ['haben', 'eingang', 'gutschrift'],
  sign: ['sollhaben', 'sh'],
  currency: ['waehrung', 'currency'],
  creditorId: ['glaeubigerid', 'glaeubigeridentifikation', 'creditorid'],
  mandate: ['mandatsreferenz', 'mandatereference'],
  e2e: ['kundenreferenz', 'endtoendreferenz', 'kundenreferenzendtoend', 'e2ereference'],
  account: ['auftragskonto', 'ibanauftragskonto', 'accountiban', 'kontonummerauftragskonto'],
  status: ['status', 'info'],
  ultimate: ['abweichenderempfaengerauftraggeber', 'ultimatepayeepayer'],
};
// i18n-data-end

/** Which column of `header` holds what: the first exact match per role, in the order the roles are tried. */
function mapColumns(header: string[]): Partial<Record<Column, number>> {
  const folded = header.map(fold);
  const out: Partial<Record<Column, number>> = {};
  const taken = new Set<number>();
  // Most specific first, so "IBAN Auftragskonto" is the account, not the counterparty's IBAN.
  const order: Column[] = ['account', 'ultimate', 'valueDate', 'entryDate', 'name', 'iban', 'bic', 'bookingText', 'purpose',
    'creditorId', 'mandate', 'e2e', 'sign', 'amount', 'debit', 'credit', 'currency', 'status'];
  for (const col of order) {
    for (const word of COLUMNS[col]) {
      const at = folded.findIndex((h, i) => h === word && !taken.has(i));
      if (at >= 0) {
        out[col] = at;
        taken.add(at);
        break;
      }
    }
  }
  return out;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "03.11.2025", "3.11.25", "2025-11-03", "03/11/2025" → "2025-11-03"; '' for anything else. */
export function readDate(s: string): string {
  const v = String(s ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})$/.exec(v);
  if (!m) return '';
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const d = new Date(year, Number(m[2]) - 1, Number(m[1]));
  if (d.getDate() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * An amount as a bank's export writes it: "-1.234,56", "1234,56-", "+12,99",
 * "−12,99", "1,234.56", "12.99 €". Null for anything that is not one.
 */
export function readAmount(s: string): number | null {
  let v = String(s ?? '').replace(/\s|€|EUR/gi, '').replace(/[−–]/g, '-');
  if (!v) return null;
  let sign = 1;
  if (v.endsWith('-')) {
    sign = -1;
    v = v.slice(0, -1);
  }
  if (v.startsWith('-')) {
    sign = -sign;
    v = v.slice(1);
  } else if (v.startsWith('+')) v = v.slice(1);
  if (!/^[\d.,']+$/.test(v)) return null;
  // With both marks, the later one is the decimal mark. With one kind, it is
  // decimal when it occurs once with at most two digits after it ("12,5",
  // "12.99"); otherwise it groups thousands ("1.234", "1,234,567").
  const comma = v.lastIndexOf(',');
  const dot = v.lastIndexOf('.');
  const lone = (mark: string, at: number) => v.indexOf(mark) === at && v.length - at - 1 <= 2;
  const decimal = comma >= 0 && dot >= 0
    ? (comma > dot ? ',' : '.')
    : comma >= 0 ? (lone(',', comma) ? ',' : '') : dot >= 0 ? (lone('.', dot) ? '.' : '') : '';
  const plain = decimal
    ? v.replace(decimal === ',' ? /[.']/g : /[,']/g, '').replace(decimal, '.')
    : v.replace(/[.,']/g, '');
  const n = Number(plain);
  return Number.isFinite(n) ? sign * Math.round(n * 100) / 100 : null;
}

/** The separator a CSV uses: the one its header line has most of. */
function separatorOf(line: string): string {
  const counts = [';', ',', '\t'].map((sep) => [sep, line.split(sep).length] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Reads a bank's CSV export. The header is the first line that names a date
 * and an amount (banks put an account summary above it); every line after it
 * with a valid day and amount is a booking. A row the file marks as not booked
 * ("vorgemerkt", "noch nicht gebucht", "Umsatz vorgemerkt") is left out:
 * the history keeps booked Umsätze only.
 */
export function parseCsvExport(text: string): ParsedImport {
  const all = lines(text);
  let headerAt = -1;
  let sep = ';';
  let map: Partial<Record<Column, number>> = {};
  for (let i = 0; i < Math.min(all.length, 40); i++) {
    const candidate = separatorOf(all[i]);
    const m = mapColumns(cells(all[i], candidate));
    if (m.entryDate != null && (m.amount != null || (m.debit != null && m.credit != null))) {
      headerAt = i;
      sep = candidate;
      map = m;
      break;
    }
  }
  if (headerAt < 0) return { format: 'csv', txs: [], blocks: [], account: null, skipped: 0 };

  // An account summary above the header: "Kontonummer:;DE12…" (ING, DKB).
  let account: string | null = null;
  for (const line of all.slice(0, headerAt)) {
    const c = cells(line, sep);
    const iban = c.map((x) => x.replace(/\s+/g, '').toUpperCase()).find((x) => /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(x));
    if (iban) {
      account = iban;
      break;
    }
  }

  const txs: SerializedTransaction[] = [];
  let skipped = 0;
  const get = (row: string[], col: Column) => (map[col] != null ? row[map[col]!] ?? '' : '');
  for (const line of all.slice(headerAt + 1)) {
    const row = cells(line, sep);
    const entry = readDate(get(row, 'entryDate')) || readDate(get(row, 'valueDate'));
    const value = readDate(get(row, 'valueDate')) || entry;
    let amount = map.amount != null ? readAmount(get(row, 'amount')) : null;
    if (amount == null && map.debit != null && map.credit != null) {
      const debit = readAmount(get(row, 'debit'));
      const credit = readAmount(get(row, 'credit'));
      amount = debit ? -Math.abs(debit) : credit ? Math.abs(credit) : debit === 0 || credit === 0 ? 0 : null;
    }
    const sign = get(row, 'sign').trim().toUpperCase();
    if (amount != null && (sign === 'S' || sign === 'SOLL')) amount = -Math.abs(amount);
    const status = fold(get(row, 'status'));
    if (!entry || amount == null || /vorgemerkt|nichtgebucht|pending|notbooked|notyetbooked/.test(status)) {
      skipped++;
      continue;
    }
    if (!account) {
      const own = get(row, 'account').replace(/\s+/g, '').toUpperCase();
      if (own) account = own;
    }
    const currency = get(row, 'currency').trim().toUpperCase();
    const tx = sanitizeBooking({
      entryDate: entry,
      valueDate: value,
      amount,
      currency: /^[A-Z]{3}$/.test(currency) ? currency : 'EUR',
      purpose: get(row, 'purpose'),
      bookingText: get(row, 'bookingText'),
      remoteName: get(row, 'name'),
      remoteIban: get(row, 'iban').replace(/\s+/g, ''),
      remoteBic: get(row, 'bic').replace(/\s+/g, ''),
      creditorId: get(row, 'creditorId'),
      ultimateName: get(row, 'ultimate'),
      e2eReference: get(row, 'e2e'),
      mandateReference: get(row, 'mandate'),
    });
    if (tx) txs.push(tx);
    else skipped++;
  }
  return { format: 'csv', txs: newestFirst(txs), blocks: [], account, skipped };
}

// ---------------------------------------------------------------------------
// Into the kept history
// ---------------------------------------------------------------------------

/**
 * The days a parsed file vouches for: for MT940 and CAMT what their balances
 * say (deliveredSpan, as for a FinTS answer), for a CSV its first booking's
 * day to its last's. Never today or later — the bank's own answer covers
 * those. Null when it vouches for none.
 */
export function importSpan(parsed: ParsedImport, today: string): DaySpan | null {
  const days = parsed.txs.map(bookingDay).filter(Boolean).sort();
  if (!days.length) return null;
  const yesterday = (() => {
    const [y, m, d] = today.split('-').map(Number);
    const t = new Date(y, m - 1, d - 1);
    return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
  })();
  if (parsed.blocks.length) {
    const span = deliveredSpan({ asked: { from: days[0], to: yesterday }, txs: parsed.txs, blocks: parsed.blocks, today: yesterday });
    return span;
  }
  const to = days[days.length - 1] < yesterday ? days[days.length - 1] : yesterday;
  return days[0] <= to ? { from: days[0], to } : null;
}

/**
 * The parsed file as a kept history of one account, ready to fill gaps
 * (lib/history-store.ts fillKeptGaps): its bookings on the days it vouches
 * for, and the balances its own figures prove there.
 */
export function importHistory(parsed: ParsedImport, accountNumber: string, today: string): { data: HistoryData; span: DaySpan } | null {
  const span = importSpan(parsed, today);
  if (!span) return null;
  const txs = parsed.txs.filter((t) => {
    const d = bookingDay(t);
    return d >= span.from && d <= span.to;
  });
  // Only what the file's own balances prove, as for a FinTS answer (lib/history.ts mergeDelivery).
  let balances: AccountHistory['balances'] = [];
  if (parsed.blocks.length) {
    const proof = buildBalanceHistory({ txs, blocks: parsed.blocks, range: span });
    if (proof.verified) balances = balanceRuns(new Map(proof.points.map((p) => [p.date, Math.round(p.balance * 100)])));
  }
  return {
    span,
    data: {
      version: 1,
      accounts: { [accountNumber]: { txs: newestFirst(txs), coverage: [span], balances } },
      updatedAt: new Date(0).toISOString(),
    },
  };
}

/**
 * Which of the view's accounts a file is for: the one whose IBAN or account
 * number it names. Null when it names none of them — the user picks then.
 */
export function matchAccount(named: string | null, accounts: readonly { accountNumber: string; iban?: string | null }[]): string | null {
  const v = String(named ?? '').replace(/\s+/g, '').toUpperCase();
  if (!v) return null;
  const hit = accounts.find((a) => String(a.iban ?? '').replace(/\s+/g, '').toUpperCase() === v)
    ?? accounts.find((a) => {
      const number = bankNumberOf(a.accountNumber);
      return number === v || v.endsWith(number.padStart(10, '0'));
    });
  return hit?.accountNumber ?? null;
}
