// Umsätze, with the Vormerkposten the bank sends beside them.
//
// lib-fints' statement interactions (HKCAZ → HICAZ, HKKAZ → HIKAZ) read the
// booked Umsätze only and drop the optional "nicht gebuchte Umsätze" the bank
// may send in the same answer — the one place Sparkassen put their
// Vormerkposten (lib/noted.ts). The subclasses here keep lib-fints' request
// and its reading of the booked part exactly as they are, and add the noted
// part as `notedStatements`.
//
// They keep the library's segment ids, so getAccountStatementsWithTan finds
// them after an approval too: the dialog continues with the very instance
// passed to startCustomerOrderInteraction, and the TAN-poll route reads
// `notedStatements` from that answer like this one does.

import type { FinTSConfig, Message, Segment, Statement, StatementResponse } from 'lib-fints';
import { StatementInteractionCAMT, StatementInteractionMT940 } from './fints-internals.js';
import type { ClientResponseWithResult, FinTSClientEx } from './fints-types';
import { msgs } from './i18n/index.ts';
import { collectNoted, countPendingInBooked, parseMt942, parseNotedCamt, type NotedField } from './noted.ts';

type NotedSegment = Segment & { bookedTransactions?: NotedField; notedTransactions?: NotedField };
type Format = 'camt' | 'mt940';

/**
 * A statement answer, with the Vormerkposten it carried: undefined when it
 * carried none, null when it carried some the app could not read.
 */
export type StatementsResponse = StatementResponse & ClientResponseWithResult;

const RESPONSE_SEG: Record<Format, string> = { camt: 'HICAZ', mt940: 'HIKAZ' };

/**
 * Reads the noted part of `response` into `clientResponse.notedStatements`.
 * Whatever goes wrong here stays here: the booked statements are already
 * read, and a Vormerkposten the app cannot read must not cost the Umsätze.
 */
function readNoted(format: Format, account: unknown, response: Message, clientResponse: StatementsResponse): void {
  const segs = response.findAllSegments<NotedSegment>(RESPONSE_SEG[format]);
  let noted: string[] | undefined;
  let failed = 0;
  let error = '';
  try {
    noted = collectNoted(segs);
    if (noted) {
      if (format === 'camt') {
        const read = parseNotedCamt(noted);
        failed = read.failed;
        // Part of the list is still not the list: shown as complete, the
        // rest would read as booked or gone.
        clientResponse.notedStatements = failed ? null : read.statements;
      } else {
        clientResponse.notedStatements = parseMt942(noted);
      }
    }
  } catch (err) {
    // Unreadable is not "nothing vorgemerkt": the app keeps the list it has.
    clientResponse.notedStatements = null;
    error = (err as Error)?.name || 'Error';
    console.warn('[stmt-noted] noted part not readable:', (err as Error)?.message || err);
  }
  logNoted(format, account, segs, noted, clientResponse.notedStatements, failed, error);
}

/**
 * One line per statement read, for "the Vorgemerkt panel never shows" reports:
 * whether the bank sent a noted part and what became of it. Sizes and counts
 * only — never a name, an IBAN, an amount or a reference.
 */
function logNoted(
  format: Format,
  account: unknown,
  segs: readonly NotedSegment[],
  noted: string[] | undefined,
  statements: Statement[] | null | undefined,
  failed: number,
  error: string,
): void {
  const acct = String(typeof account === 'string' ? account : (account as { accountNumber?: string } | null)?.accountNumber ?? '');
  const booked = segs.flatMap((s) => (s.bookedTransactions == null ? [] : typeof s.bookedTransactions === 'string' ? [s.bookedTransactions] : [...s.bookedTransactions]));
  const parts = noted === undefined ? 'absent' : `[${noted.map((p) => `${p.length}B`).join(',')}]`;
  const txs = statements === null ? 'unreadable'
    : statements ? statements.reduce((n, st) => n + (st.transactions?.length ?? 0), 0) : '-';
  const pdngInBooked = format === 'camt' ? ` pdngInBooked=${countPendingInBooked(booked)}` : '';
  console.log(
    `[stmt-noted] acct=...${acct.slice(-4)} fmt=${format} segs=${segs.length} noted=${parts} tx=${txs}`
    + `${failed ? ` failedDocs=${failed}` : ''}${pdngInBooked}${error ? ` err=${error}` : ''}`,
  );
}

export class NotedStatementInteractionCAMT extends StatementInteractionCAMT {
  handleResponse(response: Message, clientResponse: StatementResponse): void {
    super.handleResponse(response, clientResponse);
    readNoted('camt', this.account, response, clientResponse);
  }
}

export class NotedStatementInteractionMT940 extends StatementInteractionMT940 {
  handleResponse(response: Message, clientResponse: StatementResponse): void {
    super.handleResponse(response, clientResponse);
    readNoted('mt940', this.account, response, clientResponse);
  }
}

/** Whether the account's Umsätze come as camt (HKCAZ) or MT940 (HKKAZ) — lib-fints' own choice. */
export function statementFormat(config: FinTSConfig, accountNumber: string): Format | null {
  // getAccountStatements prefers camt whenever the account has it.
  if (config.isAccountTransactionSupported(accountNumber, 'HKCAZ')) return 'camt';
  if (config.isAccountTransactionSupported(accountNumber, 'HKKAZ')) return 'mt940';
  return null;
}

/**
 * client.getAccountStatements, with the Vormerkposten kept. Continue an
 * approval with client.getAccountStatementsWithTan as before.
 */
export async function fetchStatements(
  client: FinTSClientEx,
  accountNumber: string,
  from?: Date,
  to?: Date,
): Promise<StatementsResponse> {
  const format = statementFormat(client.config, accountNumber);
  if (!format) throw new Error(msgs().transactions.api.noStatements);
  const interaction = format === 'camt'
    ? new NotedStatementInteractionCAMT(accountNumber, from, to)
    : new NotedStatementInteractionMT940(accountNumber, from, to);
  return (await client.startCustomerOrderInteraction(interaction)) as StatementsResponse;
}
