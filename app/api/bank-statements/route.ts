// Fetch the bank's own Kontoauszüge for one account (HKEKA, else HKEKP) and keep them on
// this machine (lib/bank-statements.ts). Like any read it may ask for an
// approval; /api/tan-poll then finishes it.

import { body, fail, json, sessionExpired, wrap } from '@/lib/api';
import { collectStatements, requestStatements, statementSeg } from '@/lib/bank-statements';
import { DocError } from '@/lib/doc-store';
import { bankAnswerText, tanPayload } from '@/lib/serialize';
import { getSession } from '@/lib/session';
import type { BankStatementsResponse } from '@/lib/fints-types';
import { msgs } from '@/lib/i18n';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type StatementsBody = { sessionId: string; accountNumber: string };

export const POST = wrap(async (req: Request) => {
  const { sessionId, accountNumber } = await body<StatementsBody>(req);
  const s = getSession(sessionId);
  if (!s) return sessionExpired();
  if (!accountNumber) return fail(msgs().transactions.api.noAccount);

  const seg = statementSeg(s, accountNumber);
  if (!seg) return fail(msgs().docs.statements.failed);
  const resp = await requestStatements(s, accountNumber, seg);
  if (resp.requiresTan) {
    s.pending = { type: 'bankStatements', tanReference: resp.tanReference, accountNumber, segId: seg };
    return json({ ...tanPayload(resp, s), accountNumber } satisfies BankStatementsResponse);
  }
  if (!resp.success) return fail(bankAnswerText(resp) || msgs().docs.statements.failed);
  try {
    return json({ needsTan: false, accountNumber, ...(await collectStatements(s, accountNumber, resp, seg)) } satisfies BankStatementsResponse);
  } catch (err) {
    if (err instanceof DocError) return fail(err.message, err.status);
    throw err;
  }
});
