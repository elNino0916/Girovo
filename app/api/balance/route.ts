// Fetch current balance (Kontostand) for one account.

import { body, fail, json, sessionExpired, wrap } from '@/lib/api';
import { bankAnswerText, serializeBalance, tanPayload } from '@/lib/serialize';
import { getSession } from '@/lib/session';
import type { BalanceResponse } from '@/lib/fints-types';
import { msgs } from '@/lib/i18n';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type BalanceBody = { sessionId: string; accountNumber: string };

export const POST = wrap(async (req: Request) => {
  const { sessionId, accountNumber } = await body<BalanceBody>(req);
  const s = getSession(sessionId);
  if (!s) return sessionExpired();
  if (!accountNumber) return fail(msgs().transactions.api.noAccount);

  const resp = await s.client.getAccountBalance(accountNumber);
  if (resp.requiresTan) {
    s.pending = { type: 'balance', tanReference: resp.tanReference, accountNumber };
    return json({ ...tanPayload(resp), accountNumber } satisfies BalanceResponse);
  }
  if (!resp.success) return fail(bankAnswerText(resp) || msgs().transactions.api.balanceFailed);
  return json({
    needsTan: false, accountNumber, balance: serializeBalance(resp.balance),
  } satisfies BalanceResponse);
});
