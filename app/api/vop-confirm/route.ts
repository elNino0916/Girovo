// Step two of a Namensabgleich: the user has read the bank's payee-name check
// and wants the transfer executed anyway.
//
// The order goes out again — same account, same pain.001, byte for byte — now
// accompanied by HKVPA carrying the VOP-ID, which *is* the customer's
// confirmation. The bank issues a fresh TAN challenge for it (the first one was
// voided with 3945), so from here the flow rejoins the normal approval wait.

import { body, fail, json, sessionExpired, wrap } from '@/lib/api';
import { isDefiniteRefusal } from '@/lib/bank-answer';
import { bankAnswerCodes, bankAnswerText, logResp, tanPayload } from '@/lib/serialize';
import { getSession } from '@/lib/session';
import { SepaTransferInteraction } from '@/lib/fints-sepa';
import { ORDER_UNANSWERED_STATUS, OrderUnanswered, startOrder } from '@/lib/fints-order';
import type { TransferResponse } from '@/lib/fints-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A VOP-ID is short-lived on the bank side; don't replay a stale one. */
const HOLD_TTL_MS = 10 * 60 * 1000;

export const POST = wrap(async (req: Request) => {
  const { sessionId } = await body<{ sessionId: string }>(req);
  const s = getSession(sessionId);
  if (!s) return sessionExpired();

  const hold = s.vopHold;
  if (!hold) return fail('Kein Auftrag wartet auf die Bestätigung des Namensabgleichs.');
  if (Date.now() - hold.createdAt > HOLD_TTL_MS) {
    s.vopHold = null;
    return fail('Das Prüfergebnis ist zu alt. Bitte die Überweisung noch einmal starten.');
  }

  const interaction = new SepaTransferInteraction(
    hold.accountNumber,
    hold.transfer,
    hold.instant,
    { vopId: hold.vopId },
    { descriptor: hold.descriptor, sepaMessage: hold.sepaMessage },
  );

  console.log(`[vop-confirm] ${hold.segId} + HKVPA acct=${hold.accountNumber} verdict=${hold.vop.verdict}`);
  const resp = await startOrder(s.client, interaction).catch((err: unknown) => {
    if (err instanceof OrderUnanswered) return err;
    throw err;
  });
  if (resp instanceof OrderUnanswered) {
    // The order (and its VOP-ID) may have reached the bank: the hold is
    // spent, and the client shows "Status unklar" (lib/fints-order.ts).
    s.vopHold = null;
    console.error('[vop-confirm] order sent, answer lost:', (resp.cause as Error)?.message || resp.cause);
    return fail(resp.message, ORDER_UNANSWERED_STATUS);
  }
  logResp('vop-confirm', s, resp);

  // The hold is spent either way: a VOP-ID may only be used once.
  s.vopHold = null;

  if (resp.requiresTan) {
    s.pending = {
      type: 'transfer',
      tanReference: resp.tanReference,
      accountNumber: hold.accountNumber,
      segId: hold.segId,
    };
    // The check result travels with the approval prompt, so the user still
    // sees what the Namensabgleich said while confirming in the app.
    return json({ ...tanPayload(resp), accountNumber: hold.accountNumber, vop: hold.vop } satisfies TransferResponse);
  }
  if (!resp.success) {
    // As in /api/transfer: only a clean refusal says nothing was executed.
    return json({
      outcome: isDefiniteRefusal(bankAnswerCodes(resp)) ? 'refused' : 'unclear',
      accountNumber: hold.accountNumber,
      bankAnswers: bankAnswerText(resp),
    } satisfies TransferResponse);
  }
  return json({
    needsTan: false,
    accountNumber: hold.accountNumber,
    transferResult: resp.transferResult || null,
    bankAnswers: bankAnswerText(resp),
  } satisfies TransferResponse);
});
