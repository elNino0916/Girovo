// Fetch current balance (Kontostand) for one account.

import { body, fail, json, sessionExpired, wrap } from '@/lib/api';
import { bankAnswerText, serializeBalance, tanPayload } from '@/lib/serialize';
import { getSession } from '@/lib/session';
import type { BalanceResponse } from '@/lib/fints-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type BalanceBody = { sessionId: string; accountNumber: string };

export const POST = wrap(async (req: Request) => {
  const { sessionId, accountNumber } = await body<BalanceBody>(req);
  const s = getSession(sessionId);
  if (!s) return sessionExpired();
  if (!accountNumber) return fail('Kein Konto angegeben.');

  const resp = await s.client.getAccountBalance(accountNumber);
  if (resp.requiresTan) {
    s.pending = { type: 'balance', tanReference: resp.tanReference, accountNumber };
    return json({ ...tanPayload(resp), accountNumber } satisfies BalanceResponse);
  }
  if (!resp.success) return fail(bankAnswerText(resp) || 'Kontostand konnte nicht geladen werden.');
  return json({
    needsTan: false, accountNumber, balance: serializeBalance(resp.balance),
  } satisfies BalanceResponse);
});
