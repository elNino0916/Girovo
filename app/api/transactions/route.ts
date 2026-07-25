// Fetch transactions (Umsätze) for one account, optional date range.

import { body, fail, json, sessionExpired, wrap } from '@/lib/api';
import {
  balanceFromStatements, bankAnswerText, logResp, logStatementDates,
  serializeTransactions, tanPayload,
} from '@/lib/serialize';
import { getSession } from '@/lib/session';
import type { TransactionsResponse } from '@/lib/fints-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** How many days of history the dashboard loads when no range is picked. */
const DEFAULT_STATEMENT_DAYS = 90;

type TransactionsBody = { sessionId: string; accountNumber: string; from?: string; to?: string };

export const POST = wrap(async (req: Request) => {
  const { sessionId, accountNumber, from, to } = await body<TransactionsBody>(req);
  const s = getSession(sessionId);
  if (!s) return sessionExpired();
  if (!accountNumber) return fail('Kein Konto angegeben.');

  // With no `from`, the bank returns statements from the start of its retention
  // window and caps the response at maxEntries — so an active account gets the
  // OLDEST slice (ending long ago) with a stale closing balance, never the
  // current one. Default to the last ~90 days so recent bookings and the
  // current Kontostand come back. An explicit range from the UI overrides this.
  const fromDate = from
    ? new Date(from)
    : new Date(Date.now() - DEFAULT_STATEMENT_DAYS * 86400000);
  const toDate = to ? new Date(to) : undefined;

  const resp = await s.client.getAccountStatements(accountNumber, fromDate, toDate);
  logResp('transactions', s, resp);
  if (resp.requiresTan) {
    s.pending = { type: 'statements', tanReference: resp.tanReference, accountNumber };
    return json({ ...tanPayload(resp), accountNumber } satisfies TransactionsResponse);
  }
  if (!resp.success) return fail(bankAnswerText(resp) || 'Umsätze konnten nicht geladen werden.');
  logStatementDates(accountNumber, resp.statements);
  return json({
    needsTan: false, accountNumber,
    transactions: serializeTransactions(resp.statements),
    balance: balanceFromStatements(resp.statements),
  } satisfies TransactionsResponse);
});
