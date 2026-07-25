// Poll the pending decoupled operation. Called repeatedly by the frontend
// while the user approves in their banking app. Returns the final data once
// the bank confirms the approval.

import { body, fail, json, sessionExpired, wrap } from '@/lib/api';
import {
  accountsFor, balanceFromStatements, bankAnswerText, logResp, logStatementDates,
  serializeBalance, serializeTransactions,
} from '@/lib/serialize';
import { getSession, saveSessionProfile } from '@/lib/session';
import { PENDING_SEG } from '@/lib/fints-pending';
import type { ClientResponseWithResult, TanPollResponse } from '@/lib/fints-types';
import type { AccountBalanceResponse, StatementResponse } from 'lib-fints';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = wrap(async (req: Request) => {
  const { sessionId } = await body<{ sessionId: string }>(req);
  const s = getSession(sessionId);
  if (!s) return sessionExpired();
  if (!s.pending) return fail('Kein offener Vorgang.');

  const pending = s.pending;
  const { type, tanReference } = pending;
  const accountNumber = 'accountNumber' in pending ? pending.accountNumber : undefined;

  let resp: ClientResponseWithResult;
  try {
    switch (type) {
      case 'sync':
        resp = await s.client.synchronizeWithTan(tanReference!);
        break;
      case 'balance':
        resp = await s.client.getAccountBalanceWithTan(tanReference!);
        break;
      case 'statements':
        resp = await s.client.getAccountStatementsWithTan(tanReference!);
        break;
      case 'pending':
        resp = await s.client.continueCustomerInteractionWithTan([PENDING_SEG], tanReference!);
        break;
      case 'transfer':
        resp = await s.client.continueCustomerInteractionWithTan([pending.segId], tanReference!);
        break;
      default:
        return fail('Unbekannter Vorgang.');
    }
  } catch (err) {
    // lib-fints throws this when the bank ended the FinTS dialog between status
    // polls (some banks, e.g. Sparkasse decoupled, close the dialog on each
    // still-pending status response). The library cannot resume such a dialog.
    if (/already ended/i.test((err as Error)?.message || '')) {
      console.log(`[tan-poll] dialog ended between polls (type=${type}). hasEnded=${s.client?.currentDialog?.hasEnded}`);
      s.pending = null;
      const ended: TanPollResponse = { status: 'dialog_ended', type, accountNumber };
      return json(ended);
    }
    throw err;
  }

  logResp('tan-poll', s, resp);

  if (resp.requiresTan) {
    // Not approved yet — keep the same reference and ask the client to poll again.
    s.pending = { ...pending, tanReference: resp.tanReference || tanReference };
    return json({ status: 'pending' } satisfies TanPollResponse);
  }

  if (!resp.success) {
    s.pending = null;
    return fail(bankAnswerText(resp) || 'Freigabe fehlgeschlagen oder abgelehnt.');
  }

  // Approved — deliver the result for whatever was pending.
  s.pending = null;

  if (type === 'sync') {
    saveSessionProfile(s); // remember the device now that we hold a systemId + UPD
    return json({
      status: 'done', kind: 'accounts',
      accounts: accountsFor(s), deviceSaved: s.deviceSaved || false,
    } satisfies TanPollResponse);
  }
  if (type === 'balance') {
    return json({
      status: 'done', kind: 'balance', accountNumber,
      balance: serializeBalance((resp as AccountBalanceResponse).balance),
    } satisfies TanPollResponse);
  }
  if (type === 'statements') {
    const statements = (resp as StatementResponse).statements;
    logStatementDates(accountNumber!, statements);
    return json({
      status: 'done', kind: 'statements', accountNumber,
      transactions: serializeTransactions(statements),
      balance: balanceFromStatements(statements),
    } satisfies TanPollResponse);
  }
  if (type === 'pending') {
    return json({
      status: 'done', kind: 'pending', accountNumber,
      pending: serializeTransactions(resp.pendingStatements),
    } satisfies TanPollResponse);
  }
  return json({
    status: 'done', kind: 'transfer', accountNumber,
    transferResult: resp.transferResult || null,
    bankAnswers: bankAnswerText(resp),
  } satisfies TanPollResponse);
});
