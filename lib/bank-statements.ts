// The bank's own Kontoauszüge over FinTS: fetched, and kept as they arrive
// (lib/doc-store.ts keepStatements). Over HKEKA where the account offers it —
// the PDF format where the bank does — and over HKEKP ("Kontoauszug im
// PDF-Format", lib/fints-statement-pdf.ts) where that is all it offers, as
// some Sparkassen do. Both answers come in one shape.
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
import { PDF_STATEMENT_SEG, PdfStatementInteraction } from './fints-statement-pdf.ts';
import type { Session } from './session';

/** The two ways a bank hands out its Kontoauszüge. */
export type StatementSeg = 'HKEKA' | typeof PDF_STATEMENT_SEG;

/** How this account's statements are fetched: HKEKA where the account offers it, else HKEKP; null for neither. */
export function statementSeg(s: Session, accountNumber: string): StatementSeg | null {
  const config = s.client.config;
  if (config.isAccountTransactionSupported(accountNumber, 'HKEKA')) return 'HKEKA';
  if (config.isAccountTransactionSupported(accountNumber, PDF_STATEMENT_SEG)) return PDF_STATEMENT_SEG;
  return null;
}

/** One request for the account's waiting statements, from `offset` on — each a dialog of its own, as lib-fints runs HKEKA. */
export async function requestStatements(
  s: Session, accountNumber: string, seg: StatementSeg, offset?: string,
): Promise<ElectronicStatementResponse> {
  if (seg === 'HKEKA') return s.client.getElectronicStatements(accountNumber, { ...statementOptions(s), offset });
  return (await s.client.startCustomerOrderInteraction(new PdfStatementInteraction(accountNumber, { offset }))) as ElectronicStatementResponse;
}

/** The answer after the approval of a statement request. */
export async function continueStatements(
  s: Session, seg: StatementSeg, tanReference: string, tan?: string,
): Promise<ElectronicStatementResponse> {
  if (seg === 'HKEKA') return s.client.getElectronicStatementsWithTan(tanReference, tan);
  return (await s.client.continueCustomerInteractionWithTan([seg], tanReference, tan)) as ElectronicStatementResponse;
}

/** Requests after the first in one read, at most. */
export const STATEMENT_ROUNDS = 36;

/** PDF where the bank offers it, else the bank's first format (lib-fints' default). */
export function statementOptions(s: Session): ElectronicStatementOptions {
  const params = s.client.config.getTransactionParameters<{ supportedFormats?: string[] }>('HKEKA');
  return params?.supportedFormats?.includes(StatementFormat.PDF) ? { format: StatementFormat.PDF } : {};
}

/** Collects the statements the bank has waiting after `first`, and keeps the new ones. */
export async function collectStatements(
  s: Session, accountNumber: string, first: ElectronicStatementResponse, seg: StatementSeg = 'HKEKA',
): Promise<BankStatementsAnswer> {
  const all: ElectronicStatement[] = [];
  let resp = first;
  let more = false;
  for (let round = 0; ; round++) {
    all.push(...(resp.statements ?? []));
    if (!resp.nextOffset) break;
    if (round >= STATEMENT_ROUNDS) { more = true; break; }
    const next = await requestStatements(s, accountNumber, seg, resp.nextOffset);
    if (next.requiresTan || !next.success) { more = true; break; }
    resp = next;
  }
  const kept = await keepStatements(s, accountNumber, all);
  console.log(`[bank-statements] ${seg} received=${all.length} new=${kept.added.length} more=${more} held=${kept.held}`);
  return { received: all.length, added: kept.added.length, more, held: kept.held };
}
