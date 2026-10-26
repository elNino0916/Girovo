// Read a Depot's holdings (HKWPD): what it holds, at which prices, and its
// total — like the balance, a read that may ask for an approval.

import { bankAccountOf } from '@/lib/account-key';
import { body, fail, json, sessionExpired, wrap } from '@/lib/api';
import { accountCurrency, bankAnswerText, serializePortfolio, tanPayload } from '@/lib/serialize';
import { getSession } from '@/lib/session';
import type { PortfolioResponse } from '@/lib/fints-types';
import { msgs } from '@/lib/i18n';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PortfolioBody = { sessionId: string; accountNumber: string };

export const POST = wrap(async (req: Request) => {
  const { sessionId, accountNumber } = await body<PortfolioBody>(req);
  const s = getSession(sessionId);
  if (!s) return sessionExpired();
  if (!accountNumber) return fail(msgs().transactions.api.noAccount);

  const resp = await s.client.getPortfolio(bankAccountOf(s.client.config, accountNumber));
  if (resp.requiresTan) {
    s.pending = { type: 'portfolio', tanReference: resp.tanReference, accountNumber };
    return json({ ...tanPayload(resp, s), accountNumber } satisfies PortfolioResponse);
  }
  if (!resp.success) return fail(bankAnswerText(resp) || msgs().depot.api.failed);
  return json({
    needsTan: false, accountNumber, portfolio: serializePortfolio(resp, accountCurrency(s, accountNumber)),
  } satisfies PortfolioResponse);
});
