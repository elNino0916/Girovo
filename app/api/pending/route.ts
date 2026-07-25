// Fetch vorgemerkte Umsätze (pending / not-yet-booked entries) via HKVMK —
// where an incoming SEPA-Lastschrift appears before it books. Loaded on demand
// so it doesn't add an approval to every account view.

import { body, fail, json, sessionExpired, wrap } from '@/lib/api';
import { bankAnswerText, logResp, serializeTransactions, tanPayload } from '@/lib/serialize';
import { getSession } from '@/lib/session';
import { PendingInteraction } from '@/lib/fints-pending';
import type { PendingResponse } from '@/lib/fints-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PendingBody = { sessionId: string; accountNumber: string };

export const POST = wrap(async (req: Request) => {
  const { sessionId, accountNumber } = await body<PendingBody>(req);
  const s = getSession(sessionId);
  if (!s) return sessionExpired();
  if (!accountNumber) return fail('Kein Konto angegeben.');

  const resp = await s.client.startCustomerOrderInteraction(new PendingInteraction(accountNumber));
  logResp('pending', s, resp);
  if (resp.requiresTan) {
    s.pending = { type: 'pending', tanReference: resp.tanReference, accountNumber };
    return json({ ...tanPayload(resp), accountNumber } satisfies PendingResponse);
  }
  if (!resp.success) return fail(bankAnswerText(resp) || 'Vorgemerkte Umsätze konnten nicht geladen werden.');
  return json({
    needsTan: false, accountNumber, pending: serializeTransactions(resp.pendingStatements),
  } satisfies PendingResponse);
});
