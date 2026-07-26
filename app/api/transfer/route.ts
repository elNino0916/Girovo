// SEPA-Überweisung (Einzel / Echtzeit). Requires TAN approval; the money
// leaves the account once the user confirms in their banking app.
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
import { bankAnswerCodes, bankAnswerText, logResp, serializeVop, tanPayload } from '@/lib/serialize';
import { getSession } from '@/lib/session';
import { lookupBlz } from '@/lib/banks';
import {
  INSTANT_SEG, SepaTransferInteraction, TRANSFER_SEG,
  parseAmount, sepaSanitize, validateBic, validateIban,
} from '@/lib/fints-sepa';
import { VOP_CODES } from '@/lib/fints-vop';
import type { TransferResponse } from '@/lib/fints-types';

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
};

export const POST = wrap(async (req: Request) => {
  const {
    sessionId, accountNumber, recipientName, iban, bic, amount, purpose, instant,
  } = await body<TransferBody>(req);
  const s = getSession(sessionId);
  if (!s) return sessionExpired();

  // -- validate ------------------------------------------------------------
  const name = sepaSanitize(recipientName, 70);
  if (!name) return fail('Bitte den Namen des Empfängers angeben.');
  const cleanIban = validateIban(iban);
  if (!cleanIban) return fail('Die IBAN ist ungültig (Prüfsumme oder Format).');
  const cleanBic = validateBic(bic);
  if (cleanBic === null) return fail('Die BIC ist ungültig.');
  const amountCents = parseAmount(amount);
  if (amountCents === null) return fail('Der Betrag ist ungültig.');
  const cleanPurpose = sepaSanitize(purpose, 140);

  const account = accountNumber
    ? (s.client.config.bankingInformation?.upd?.bankAccounts || [])
      .find((a) => a.accountNumber === accountNumber)
    : undefined;
  if (!accountNumber || !account) return fail('Unbekanntes Konto.');
  if (cleanIban === account.iban) return fail('Empfänger-IBAN und Auftraggeber-IBAN sind identisch.');

  const useInstant = !!instant;
  const segId = useInstant ? INSTANT_SEG : TRANSFER_SEG;

  if (!account.iban) return fail('Dieses Konto hat keine IBAN und unterstützt keine SEPA-Überweisungen.');
  if (!s.client.config.isAccountTransactionSupported(accountNumber, segId)) {
    return fail(`Dieses Konto unterstützt keine ${useInstant ? 'Echtzeitüberweisung' : 'SEPA-Überweisung'} über FinTS.`);
  }

  const transfer = {
    creditorName: name,
    creditorIban: cleanIban,
    creditorBic: cleanBic || undefined,
    amountCents,
    purpose: cleanPurpose,
    debtorBic: lookupBlz(s.client.config.bankId)?.bic || s.meta?.bic || undefined,
  };
  const interaction = new SepaTransferInteraction(accountNumber, transfer, useInstant);

  console.log(`[transfer] ${useInstant ? 'HKIPZ' : 'HKCCS'} acct=${accountNumber} → ${cleanIban} ${(amountCents / 100).toFixed(2)} EUR`);
  s.vopHold = null;
  const resp = await s.client.startCustomerOrderInteraction(interaction);
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
    return fail(
      'Diese Bank verlangt für Überweisungen einen Namensabgleich (Verification of Payee), '
      + 'meldet die dafür nötigen Geschäftsvorfälle aber nicht an. Bitte im Online-Banking der Bank überweisen.',
    );
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
        ? 'Die Bank prüft den Empfängernamen noch und hat das Ergebnis nicht vollständig geliefert. '
          + 'Bitte in einem Moment erneut versuchen.'
        : bankAnswerText(resp) || 'Die Bank hat die Freigabe zurückgezogen, ohne ein Prüfergebnis zu liefern.');
    }
    s.vopHold = {
      vopId: vopResult.vopId,
      accountNumber,
      segId,
      instant: useInstant,
      transfer,
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
    return fail(bankAnswerText(resp) || 'Die Bank hat die Überweisung abgelehnt.');
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
