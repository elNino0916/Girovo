// The bank's Daueraufträge or terminierte Überweisungen for one account
// (HKCDB / HKCSB, lib/fints-orders.ts). Only ever on request — like any read
// it may need an approval, which /api/tan-poll then continues.
//
// The orders go to the browser under fresh handles; what a deletion has to
// send back (the bank's own pain message and details) stays here, in the
// session, until the next read of the same account and kind replaces it.

import { body, fail, json, sessionExpired, wrap } from '@/lib/api';
import { msgs } from '@/lib/i18n';
import { lookupBlz } from '@/lib/banks';
import { BankOrderListInteraction, holdBankOrders, orderCaps } from '@/lib/fints-orders';
import type { BankOrderKind, BankOrdersResponse } from '@/lib/fints-types';
import { bankAnswerText, logResp, tanPayload } from '@/lib/serialize';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type BankOrdersBody = { sessionId: string; accountNumber: string; kind: BankOrderKind };

export const POST = wrap(async (req: Request) => {
  const { sessionId, accountNumber, kind } = await body<BankOrdersBody>(req);
  const s = getSession(sessionId);
  if (!s) return sessionExpired();
  if (!accountNumber) return fail(msgs().transactions.api.noAccount);
  if (kind !== 'standing' && kind !== 'dated') return fail(msgs().orders.route.listFailed);
  const caps = orderCaps(s.client.config, accountNumber)[kind];
  if (!caps?.list) return fail(msgs().orders.route.unsupported(kind));

  const debtorBic = lookupBlz(s.client.config.bankId)?.bic || s.meta?.bic || undefined;
  const interaction = new BankOrderListInteraction(accountNumber, kind, debtorBic);
  const resp = await s.client.startCustomerOrderInteraction(interaction);
  logResp('bank-orders', s, resp);
  if (resp.requiresTan) {
    s.pending = { type: 'bankOrders', tanReference: resp.tanReference, accountNumber, segId: interaction.segId, kind };
    return json({ ...tanPayload(resp), accountNumber } satisfies BankOrdersResponse);
  }
  if (!resp.success) return fail(bankAnswerText(resp) || msgs().orders.route.listFailed);
  return json({
    needsTan: false, accountNumber, ...holdBankOrders(s, accountNumber, kind, resp.bankOrders ?? interaction.read, caps.remove),
  } satisfies BankOrdersResponse);
});
