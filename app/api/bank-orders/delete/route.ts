// Deleting one of the bank's Daueraufträge or terminierten Überweisungen
// (HKCDL / HKCSL, lib/fints-orders.ts). The browser names the order by the
// handle the last read gave it; the bank's own pain message and details,
// which the deletion sends back, never left the server.
//
// A deletion is an order like any other: it may need an approval, and once it
// went out an answer that did not come back leaves it unclear — "Status
// unklar", never sent again by itself (lib/fints-order.ts). Reading the list
// again says how it stands.

import { body, fail, json, sessionExpired, wrap } from '@/lib/api';
import { isDefiniteRefusal } from '@/lib/bank-answer';
import { lookupBlz } from '@/lib/banks';
import { msgs } from '@/lib/i18n';
import { BankOrderDeleteInteraction, orderCaps } from '@/lib/fints-orders';
import { ORDER_UNANSWERED_STATUS, OrderUnanswered, startOrder } from '@/lib/fints-order';
import type { DeleteOrderResponse } from '@/lib/fints-types';
import { bankAnswerCodes, bankAnswerText, logResp, tanPayload } from '@/lib/serialize';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type DeleteBody = { sessionId: string; accountNumber: string; ref: string };

export const POST = wrap(async (req: Request) => {
  const { sessionId, accountNumber, ref } = await body<DeleteBody>(req);
  const s = getSession(sessionId);
  if (!s) return sessionExpired();
  const words = msgs().orders.route;

  const held = typeof ref === 'string' ? s.bankOrders.get(ref) : undefined;
  if (!held || held.accountNumber !== accountNumber) return fail(words.unknownOrder);
  const caps = orderCaps(s.client.config, accountNumber)[held.kind];
  if (!caps?.remove || !held.order.deletable) return fail(words.unsupported(held.kind));

  const debtorBic = lookupBlz(s.client.config.bankId)?.bic || s.meta?.bic || undefined;
  const interaction = new BankOrderDeleteInteraction(accountNumber, held, debtorBic);
  console.log(`[orders] ${interaction.segId} acct=...${String(accountNumber).slice(-4)} orderId=${held.order.orderId ? 'yes' : 'no'}`);
  // A handle names one order of one read: used once, whatever comes of it.
  s.bankOrders.delete(ref as string);
  s.vopHold = null;

  const resp = await startOrder(s.client, interaction).catch((err: unknown) => {
    if (err instanceof OrderUnanswered) return err;
    throw err;
  });
  if (resp instanceof OrderUnanswered) {
    console.error('[orders] deletion sent, answer lost:', (resp.cause as Error)?.message || resp.cause);
    return fail(resp.message, ORDER_UNANSWERED_STATUS);
  }
  logResp('order-delete', s, resp);

  if (resp.requiresTan) {
    s.pending = { type: 'orderDelete', tanReference: resp.tanReference, accountNumber, segId: interaction.segId, ref: ref as string };
    return json({ ...tanPayload(resp, s), accountNumber } satisfies DeleteOrderResponse);
  }
  if (!resp.success) {
    // As for a transfer: only a clean refusal says nothing was done.
    return json({
      outcome: isDefiniteRefusal(bankAnswerCodes(resp)) ? 'refused' : 'unclear', accountNumber, bankAnswers: bankAnswerText(resp),
    } satisfies DeleteOrderResponse);
  }
  return json({ needsTan: false, accountNumber, bankAnswers: bankAnswerText(resp) } satisfies DeleteOrderResponse);
});
