// The bank's own Kontoauszüge over FinTS (HKEKA): fetched, and kept as they
// arrive (lib/doc-store.ts keepStatements).
//
// The bank hands out one statement per request and says when another is
// waiting (an Aufsetzpunkt, `nextOffset`). After the approval the rest come
// in the same dialog without one; should the bank ask again part-way, the
// read stops there and says that more are waiting — another read fetches
// them. Nothing is acknowledged to the bank (no receipt is sent), so a bank
// that wants one keeps offering the statement: nothing is lost on its side.

import { StatementFormat, type ElectronicStatement, type ElectronicStatementOptions, type ElectronicStatementResponse } from 'lib-fints';
import type { BankStatementsAnswer } from './fints-types';
import { keepStatements } from './doc-store.ts';
import type { Session } from './session';

/** Requests after the first in one read, at most. */
export const STATEMENT_ROUNDS = 36;

/** PDF where the bank offers it, else the bank's first format (lib-fints' default). */
export function statementOptions(s: Session): ElectronicStatementOptions {
  const params = s.client.config.getTransactionParameters<{ supportedFormats?: string[] }>('HKEKA');
  return params?.supportedFormats?.includes(StatementFormat.PDF) ? { format: StatementFormat.PDF } : {};
}

/** Collects the statements the bank has waiting after `first`, and keeps the new ones. */
export async function collectStatements(
  s: Session, accountNumber: string, first: ElectronicStatementResponse,
): Promise<BankStatementsAnswer> {
  const all: ElectronicStatement[] = [];
  let resp = first;
  let more = false;
  for (let round = 0; ; round++) {
    all.push(...(resp.statements ?? []));
    if (!resp.nextOffset) break;
    if (round >= STATEMENT_ROUNDS) { more = true; break; }
    const next = await s.client.getElectronicStatements(accountNumber, { ...statementOptions(s), offset: resp.nextOffset });
    if (next.requiresTan || !next.success) { more = true; break; }
    resp = next;
  }
  const kept = await keepStatements(s, accountNumber, all);
  console.log(`[bank-statements] received=${all.length} new=${kept.added.length} more=${more} held=${kept.held}`);
  return { received: all.length, added: kept.added.length, more, held: kept.held };
}
