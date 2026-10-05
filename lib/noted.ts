// Vorgemerkte Umsätze that come along with the Umsätze.
//
// A bank may answer a statement request with two payloads: the booked
// Umsätze and, optionally, the "nicht gebuchte Umsätze" — an MT942 beside the
// MT940 in HIKAZ (DE 2), one camt.052 beside the booked camt documents in
// HICAZ (DE 4). Sparkassen send their Vormerkposten this way and offer no
// HKVMK at all (lib/fints-pending.ts). lib-fints decodes that second payload
// and then drops it; this module turns it into statements of its own, apart
// from the booked ones, which it never touches.
//
// Pure apart from lib-fints' own parsers, so the `node --test` suite can run it
// under Node's type stripping.

import { Mt940Parser } from 'lib-fints';
import type { Statement, Transaction } from 'lib-fints';
import { CamtParser } from './fints-internals.js';

/** What lib-fints decodes the field into: a string in HIKAZ, a list of documents in HICAZ. */
export type NotedField = string | readonly string[] | undefined | null;

/**
 * The noted payloads of a response's HIKAZ/HICAZ segments.
 *
 * `undefined` when no segment carries the field at all — the bank said
 * nothing about Vormerkposten. `[]` when it sent the field empty (`@0@`).
 * A response spread over several messages may repeat the same part in each;
 * a repeat is listed once.
 */
export function collectNoted(segments: readonly { notedTransactions?: NotedField }[]): string[] | undefined {
  const fields = segments.map((s) => s.notedTransactions).filter((f) => f != null);
  if (!fields.length) return undefined;
  const parts = fields.flatMap((f) => (typeof f === 'string' ? [f] : [...(f as readonly string[])]));
  return [...new Set(parts.filter((p) => typeof p === 'string' && p.trim() !== ''))];
}

/**
 * MT942 the way lib-fints' MT940 parser reads it: CRLF line breaks (with LF
 * alone it loses the name, IBAN and BIC of every entry), each `:20:` at the
 * start of a line, and no `-` record terminators — before a `:20:` one hides
 * the whole statement, after a `:86:` it ends up in the payee's name.
 */
export function normalizeMt94x(raw: string): string {
  return raw
    .replace(/@@/g, '\r\n')
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/^-(?=:\d\d[A-Z]?:)/, ''))
    .filter((line) => line.trim() !== '-')
    .join('\r\n');
}

/**
 * Vormerkposten from MT942 (HIKAZ DE 2, or HIVMK). The statements have no
 * opening or closing balance: MT942 carries none.
 */
export function parseMt942(payloads: readonly string[]): Statement[] {
  // One stream, like the booked MT940 a parted answer spreads over its portions.
  const text = normalizeMt94x(payloads.join(''));
  return text.trim() ? new Mt940Parser(text).parse() : [];
}

/** The lib-fints CamtParser members this module overrides or calls (all private in its .d.ts). */
type CamtInternals = {
  parse(): Statement[];
  getValueFromPath(obj: unknown, path: string): string | undefined;
  parseTransactions(report: unknown, reportNumber: number): Transaction[];
  parseTransaction(entry: unknown): Transaction | null;
};
const CamtBase = CamtParser as unknown as new (xml: string) => CamtInternals;

/** camt.052 entry statuses: booked, pending, information only. */
const BOOKED = 'BOOK';

/**
 * lib-fints' CAMT parser, fitted to a report of Vormerkposten:
 *  - it has no balances, which lib-fints refuses ("No balance information");
 *  - its entries have no Buchungstag, for which lib-fints puts in the moment
 *    of parsing — the Valuta is the day the bank does name;
 *  - an entry the report itself calls booked is in the booked documents too.
 */
class NotedCamtParser extends CamtBase {
  parseReport(report: unknown, reportNumber: number): Statement {
    // No openingBalance/closingBalance: there are none, and none is made up.
    return {
      account: this.getValueFromPath(report, 'Acct.Id.IBAN'),
      number: this.getValueFromPath(report, 'Id'),
      transactionReference: this.getValueFromPath(report, 'ElctrncSeqNb'),
      transactions: this.parseTransactions(report, reportNumber),
    } as Statement;
  }

  parseTransaction(entry: unknown): Transaction | null {
    // <Sts>PDNG</Sts> up to camt.052.001.02, <Sts><Cd>PDNG</Cd></Sts> from .001.08 on.
    const status = (this.getValueFromPath(entry, 'Sts.Cd') || this.getValueFromPath(entry, 'Sts') || '').trim().toUpperCase();
    if (status === BOOKED) return null; // lib-fints' parseTransactions skips it
    const tx = super.parseTransaction(entry);
    if (!tx) return null;
    const booked = this.getValueFromPath(entry, 'BookgDt.DtTm') || this.getValueFromPath(entry, 'BookgDt.Dt')
      || this.getValueFromPath(entry, 'BookgDt');
    // Without a Valuta either, both dates stay the day of the fetch.
    if (!booked) tx.entryDate = tx.valueDate;
    return tx;
  }
}

/**
 * Vormerkposten from camt.052 documents (HICAZ DE 4). Each document stands
 * on its own: one that cannot be read is counted, and the rest still are.
 */
export function parseNotedCamt(docs: readonly string[]): { statements: Statement[]; failed: number } {
  const statements: Statement[] = [];
  let failed = 0;
  for (const doc of docs) {
    try {
      statements.push(...new NotedCamtParser(utf8Camt(doc)).parse());
    } catch (err) {
      failed++;
      // The parser's message names the element, never its content.
      console.warn('[stmt-noted] camt document not readable:', (err as Error)?.message || err);
    }
  }
  return { statements, failed };
}

/**
 * lib-fints hands over binary data as latin1; a document that declares UTF-8
 * is read again as UTF-8, as lib-fints does for the booked documents — or
 * every umlaut in a name comes out as two characters.
 */
function utf8Camt(doc: string): string {
  return /<\?xml[^>]*encoding="UTF-8"[^>]*\?>/i.test(doc) ? Buffer.from(doc, 'latin1').toString('utf8') : doc;
}

/** How many entries of the booked camt documents call themselves pending — for the log only. */
export function countPendingInBooked(docs: readonly string[]): number {
  let n = 0;
  for (const doc of docs) n += (doc.match(/<(?:\w+:)?Sts>\s*(?:<(?:\w+:)?Cd>\s*)?PDNG\b/g) || []).length;
  return n;
}
