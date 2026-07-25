// SEPA-Überweisung (Einzel / Echtzeit). Requires TAN approval; the money
// leaves the account once the user confirms in their banking app.

import { body, fail, json, sessionExpired, wrap } from '@/lib/api';
import { bankAnswerText, logResp, tanPayload } from '@/lib/serialize';
import { getSession } from '@/lib/session';
import { lookupBlz } from '@/lib/banks';
import {
  INSTANT_SEG, SepaTransferInteraction, TRANSFER_SEG,
  parseAmount, sepaSanitize, validateBic, validateIban,
} from '@/lib/fints-sepa';
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

  const account = (s.client.config.bankingInformation?.upd?.bankAccounts || [])
    .find((a) => a.accountNumber === accountNumber);
  if (!account) return fail('Unbekanntes Konto.');
  if (cleanIban === account.iban) return fail('Empfänger-IBAN und Auftraggeber-IBAN sind identisch.');

  const useInstant = !!instant;
  const segId = useInstant ? INSTANT_SEG : TRANSFER_SEG;

  const interaction = new SepaTransferInteraction(accountNumber!, {
    creditorName: name,
    creditorIban: cleanIban,
    creditorBic: cleanBic || undefined,
    amountCents,
    purpose: cleanPurpose,
    debtorBic: lookupBlz(s.client.config.bankId)?.bic || s.meta?.bic || undefined,
  }, useInstant);

  console.log(`[transfer] ${useInstant ? 'HKIPZ' : 'HKCCS'} acct=${accountNumber} → ${cleanIban} ${(amountCents / 100).toFixed(2)} EUR`);
  const resp = await s.client.startCustomerOrderInteraction(interaction);
  logResp('transfer', s, resp);

  if (resp.requiresTan) {
    s.pending = { type: 'transfer', tanReference: resp.tanReference, accountNumber: accountNumber!, segId };
    return json({ ...tanPayload(resp), accountNumber } satisfies TransferResponse);
  }
  if (!resp.success) {
    return fail(bankAnswerText(resp) || 'Die Bank hat die Überweisung abgelehnt.');
  }
  // Executed without SCA (rare, e.g. exemption) — report right away.
  return json({
    needsTan: false, accountNumber: accountNumber!,
    transferResult: resp.transferResult || null,
    bankAnswers: bankAnswerText(resp),
  } satisfies TransferResponse);
});
