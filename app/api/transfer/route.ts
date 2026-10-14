// SEPA-Überweisung (Einzel / Echtzeit). Requires TAN approval; the money
// leaves the account once the user confirms in their banking app.
//
// With a `schedule` the same order goes out as a terminierte Überweisung
// (HKCSE) or a Dauerauftrag (HKCDE) instead — lib/fints-orders.ts — checked
// against the bank's rules first, and with the same Namensabgleich, approval
// and "Status unklar" as any transfer.
//
// Where the bank performs a Namensabgleich (Verification of Payee) the order
// carries a HKVPP and the bank answers with its comparison of the payee name.
// Which of the three endings applies is decided by the bank's return codes, not
// by the check result — see lib/fints-vop.ts:
//
//   • challenge stands   → the usual TAN wait, result shown alongside it
//   • challenge voided   → park the order, ask the user, then /api/vop-confirm
//   • already executed   → nothing left to approve

import { body, fail, json, sessionExpired, wrap } from '@/lib/api';
import { isDefiniteRefusal } from '@/lib/bank-answer';
import { msgs } from '@/lib/i18n';
import { bankAnswerCodes, bankAnswerText, logResp, serializeVop, tanPayload } from '@/lib/serialize';
import { getSession } from '@/lib/session';
import { lookupBlz } from '@/lib/banks';
import {
  INSTANT_SEG, TRANSFER_SEG,
  parseAmount, sepaSanitize, validateBic, validateIban,
} from '@/lib/fints-sepa';
import { orderCaps, orderInteraction, orderSegId } from '@/lib/fints-orders';
import { VOP_CODES } from '@/lib/fints-vop';
import { ORDER_UNANSWERED_STATUS, OrderUnanswered, startOrder } from '@/lib/fints-order';
import type { TransferResponse } from '@/lib/fints-types';
import { isoDate } from '@/lib/format';
import { readSchedule, scheduleProblems } from '@/lib/order-schedule';
import { SEPA_NAME_MAX, SEPA_PURPOSE_MAX } from '@/lib/sepa-text';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type TransferBody = {
  sessionId: string;
  accountNumber: string;
  recipientName: string;
  iban: string;
  bic?: string;
  amount: string;
  purpose?: string;
  instant?: boolean;
  /** A terminierte Überweisung or a Dauerauftrag (lib/order-schedule.ts). */
  schedule?: unknown;
};

export const POST = wrap(async (req: Request) => {
  const {
    sessionId, accountNumber, recipientName, iban, bic, amount, purpose, instant, schedule: rawSchedule,
  } = await body<TransferBody>(req);
  const s = getSession(sessionId);
  if (!s) return sessionExpired();
  const words = msgs().transfer;

  // -- validate ------------------------------------------------------------
  // Name and purpose go out rewritten to the SEPA character set (ä → ae …),
  // which makes them longer. One that no longer fits is refused rather than
  // cut: a clipped purpose loses the end of an invoice or customer number,
  // a clipped name fails the Namensabgleich — neither of which the user saw
  // on the review step. The sheet counts the same way (lib/sepa-text.ts), so
  // this only catches a client that did not.
  const name = sepaSanitize(recipientName);
  if (!name) return fail(words.route.nameMissing);
  if (name.length > SEPA_NAME_MAX) {
    return fail(words.route.nameTooLong(SEPA_NAME_MAX));
  }
  const cleanIban = validateIban(iban);
  if (!cleanIban) return fail(words.route.ibanInvalid);
  const cleanBic = validateBic(bic);
  if (cleanBic === null) return fail(words.bicInvalid);
  const amountCents = parseAmount(amount);
  if (amountCents === null) return fail(words.route.amountInvalid);
  const cleanPurpose = sepaSanitize(purpose);
  if (cleanPurpose.length > SEPA_PURPOSE_MAX) {
    return fail(words.route.purposeTooLong(SEPA_PURPOSE_MAX));
  }

  const account = accountNumber
    ? (s.client.config.bankingInformation?.upd?.bankAccounts || [])
      .find((a) => a.accountNumber === accountNumber)
    : undefined;
  if (!accountNumber || !account) return fail(words.route.unknownAccount);
  if (cleanIban === account.iban) return fail(words.route.sameIban);

  // An order for later: its shape, then the bank's rules for it — the sheet
  // checks the same (lib/order-schedule.ts), so this only catches a client
  // that did not. Echtzeit is a transfer now and never scheduled.
  const later = msgs().orders;
  const schedule = rawSchedule == null ? null : readSchedule(rawSchedule);
  if (rawSchedule != null && !schedule) return fail(later.route.scheduleInvalid);
  if (schedule && instant) return fail(later.route.noInstant);

  const useInstant = !!instant;
  const segId = schedule ? orderSegId(false, schedule) : useInstant ? INSTANT_SEG : TRANSFER_SEG;

  if (!account.iban) return fail(words.route.noIban);
  if (schedule) {
    const caps = orderCaps(s.client.config, accountNumber)[schedule.kind];
    if (!caps?.create) return fail(later.route.unsupported(schedule.kind));
    const problems = scheduleProblems(schedule, caps.rules, isoDate(new Date()));
    if (Object.keys(problems).length) {
      console.log(`[transfer] ${segId} schedule refused: ${Object.values(problems).join(', ')}`);
      return fail(later.route.scheduleInvalid);
    }
  } else if (!s.client.config.isAccountTransactionSupported(accountNumber, segId)) {
    return fail(words.route.unsupported(useInstant));
  }

  const transfer = {
    creditorName: name,
    creditorIban: cleanIban,
    creditorBic: cleanBic || undefined,
    amountCents,
    purpose: cleanPurpose,
    debtorBic: lookupBlz(s.client.config.bankId)?.bic || s.meta?.bic || undefined,
  };
  const interaction = orderInteraction(accountNumber, transfer, { instant: useInstant, schedule });

  // The segment only: no IBAN, no amount, no name in a log line (owner's rule).
  console.log(`[transfer] ${segId} acct=...${String(accountNumber).slice(-4)}`);
  s.vopHold = null;
  // A connection that broke once the order was on its way is not a refusal:
  // the bank may have it (lib/fints-order.ts). The client shows "Status
  // unklar" for this answer and offers no resend.
  const resp = await startOrder(s.client, interaction).catch((err: unknown) => {
    if (err instanceof OrderUnanswered) return err;
    throw err;
  });
  if (resp instanceof OrderUnanswered) {
    console.error('[transfer] order sent, answer lost:', (resp.cause as Error)?.message || resp.cause);
    return fail(resp.message, ORDER_UNANSWERED_STATUS);
  }
  logResp('transfer', s, resp);

  const codes = bankAnswerCodes(resp);
  // Read the collector, not the response: when the bank spreads the check
  // result over several messages the VOP-ID lands in a later one.
  const vopResult = interaction.vop?.result || null;
  const vop = vopResult ? serializeVop(vopResult, name) : null;
  if (interaction.vop) {
    console.log(
      `[vop] checked=${interaction.vop.seen} polls=${interaction.vop.polls}`
      + ` verdict=${vopResult?.verdict || '-'} code=${vopResult?.code || '-'}`
      + ` vopId=${vopResult?.vopId ? 'yes' : 'no'}`,
    );
  }

  // The bank wants a Namensabgleich and we did not (or could not) send one.
  if (codes.has(VOP_CODES.required)) {
    return fail(words.route.vopRequired);
  }

  // 3945 — the challenge is void. Nothing can be approved until the user has
  // seen the result and the order goes out again with a HKVPA.
  if (codes.has(VOP_CODES.approvalVoided)) {
    s.pending = null;
    if (!vopResult?.vopId || !vop) {
      // The bank withheld the VOP-ID. Either its check is still running (and we
      // ran out of check requests), or it never delivered a result at all.
      const incomplete = codes.has(VOP_CODES.stillRunning) || codes.has(VOP_CODES.moreToCome);
      return fail(incomplete
        ? words.route.vopIncomplete
        : bankAnswerText(resp) || words.route.vopWithdrawn);
    }
    s.vopHold = {
      vopId: vopResult.vopId,
      accountNumber,
      segId,
      instant: useInstant,
      transfer,
      ...(schedule ? { schedule } : {}),
      descriptor: interaction.sepaDescriptor!,
      sepaMessage: interaction.sepaMessage!,
      vop,
      createdAt: Date.now(),
    };
    return json({ needsVop: true, accountNumber, vop } satisfies TransferResponse);
  }

  if (resp.requiresTan) {
    s.pending = { type: 'transfer', tanReference: resp.tanReference, accountNumber, segId };
    return json({ ...tanPayload(resp), accountNumber, ...(vop ? { vop } : {}) } satisfies TransferResponse);
  }
  if (!resp.success) {
    // The order went out and the bank answered it with an error. Only a clean
    // refusal means nothing was executed (lib/bank-answer.ts); a dialog abort
    // alone, or an error beside an execution code, leaves it unclear — and
    // an unclear order is never offered for sending again.
    return json({
      outcome: isDefiniteRefusal(codes) ? 'refused' : 'unclear', accountNumber, bankAnswers: bankAnswerText(resp),
    } satisfies TransferResponse);
  }
  // Executed without SCA (3076 — an exemption, or a bagatelle the bank waved
  // through after a clean Namensabgleich). Report it right away.
  return json({
    needsTan: false, accountNumber,
    transferResult: resp.transferResult || null,
    bankAnswers: bankAnswerText(resp),
    ...(vop ? { vop } : {}),
  } satisfies TransferResponse);
});
