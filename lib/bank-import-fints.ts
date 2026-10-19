// MT940 and camt.052/053 exports from the online banking, read with
// lib-fints' own parsers — the very ones a FinTS statement goes through — and
// mapped like one (lib/serialize.ts). The CSV formats and everything after
// reading are lib/bank-import.ts; this is only the part that needs lib-fints
// and the server's serialisers.

import { Mt940Parser } from 'lib-fints';
import type { Statement } from 'lib-fints';
import { detectFormat, parseCsvExport, type ParsedImport } from './bank-import';
import { CamtParser } from './fints-internals.js';
import { normalizeMt94x } from './noted';
import { serializeTransactions, statementBlocks } from './serialize';

/** The account a statement names: a camt IBAN, or MT940's ":25:" (BLZ/Kontonummer) as its account number. */
function accountOf(statements: readonly Statement[]): string | null {
  for (const st of statements) {
    const raw = String((st as { account?: unknown }).account ?? '').replace(/\s+/g, '').toUpperCase();
    if (!raw) continue;
    const slash = raw.lastIndexOf('/');
    return slash >= 0 ? raw.slice(slash + 1).replace(/^0+/, '') : raw;
  }
  return null;
}

/** Reads an export of any format this knows; null when the text is none of them. */
export function parseBankExport(text: string): ParsedImport | null {
  const format = detectFormat(text);
  if (format === 'csv') return parseCsvExport(text);
  if (format === 'mt940') {
    const statements = new Mt940Parser(normalizeMt94x(text)).parse();
    return { format, txs: serializeTransactions(statements), blocks: statementBlocks(statements), account: accountOf(statements), skipped: 0 };
  }
  if (format === 'camt') {
    // A file may hold several documents back to back; lib-fints reads one.
    const docs = text.split(/(?=<\?xml)/).filter((d) => d.trim());
    const statements = docs.flatMap((doc) => new CamtParser(doc).parse() as Statement[]);
    return { format, txs: serializeTransactions(statements), blocks: statementBlocks(statements), account: accountOf(statements), skipped: 0 };
  }
  return null;
}
