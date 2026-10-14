// Fetch transactions (Umsätze) for one account, optional date range.

import { body, fail, json, sessionExpired, wrap } from '@/lib/api';
import {
  balanceFromStatements, bankAnswerText, logResp, logStatementDates,
  serializeNoted, serializeTransactions, statementBlocks, tanPayload,
} from '@/lib/serialize';
import { getSession } from '@/lib/session';
import { fetchStatements } from '@/lib/fints-statements';
import type { TransactionsResponse } from '@/lib/fints-types';
import { isoDate } from '@/lib/format';
import { isDay } from '@/lib/history';
import { noteDelivery } from '@/lib/history-store';
import { msgs } from '@/lib/i18n';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** How many days of history the dashboard loads when no range is picked. */
const DEFAULT_STATEMENT_DAYS = 90;

type TransactionsBody = { sessionId: string; accountNumber: string; from?: string; to?: string };

export const POST = wrap(async (req: Request) => {
  const { sessionId, accountNumber, from, to } = await body<TransactionsBody>(req);
  const s = getSession(sessionId);
  if (!s) return sessionExpired();
  if (!accountNumber) return fail(msgs().transactions.api.noAccount);

  // With no `from`, the bank returns statements from the start of its retention
  // window and caps the response at maxEntries — so an active account gets the
  // OLDEST slice (ending long ago) with a stale closing balance, never the
  // current one. Default to the last ~90 days so recent bookings and the
  // current Kontostand come back. An explicit range from the UI overrides this.
  const fromDate = from
    ? new Date(from)
    : new Date(Date.now() - DEFAULT_STATEMENT_DAYS * 86400000);
  const toDate = to ? new Date(to) : undefined;
  // The same request in local days, for the Umsätze kept on this computer
  // (lib/history-store.ts): the client sends yyyy-mm-dd, and an open end
  // means up to today.
  const asked = { from: isDay(from) ? from : isoDate(fromDate), to: isDay(to) ? to : isoDate(new Date()) };

  // lib-fints' getAccountStatements, keeping the Vormerkposten a bank sends
  // beside the Umsätze (Sparkassen do, and offer no HKVMK).
  const resp = await fetchStatements(s.client, accountNumber, fromDate, toDate);
  logResp('transactions', s, resp);
  if (resp.requiresTan) {
    s.pending = { type: 'statements', tanReference: resp.tanReference, accountNumber, asked };
    return json({ ...tanPayload(resp), accountNumber } satisfies TransactionsResponse);
  }
  if (!resp.success) return fail(bankAnswerText(resp) || msgs().transactions.api.transactionsFailed);
  logStatementDates(accountNumber, resp.statements);
  const transactions = serializeTransactions(resp.statements);
  // Per-block opening/closing balances — what a Kontoverlauf is checked against.
  const blocks = statementBlocks(resp.statements);
  // Kept on this computer if the vault says so — once this answer is on its
  // way; the Vorgemerkte never are.
  noteDelivery(s, accountNumber, asked, transactions, blocks);
  return json({
    needsTan: false, accountNumber,
    transactions,
    balance: balanceFromStatements(resp.statements),
    blocks,
    pending: serializeNoted(s, accountNumber, resp.notedStatements),
  } satisfies TransactionsResponse);
});
