// Step 1: connect + first synchronisation (fetches BPD incl. available TAN methods).
//
// The browser sends an attempt id with the login. "Abbrechen" on the login
// form posts it to ./cancel, which ends the bank request and makes sure no
// session (and so no PIN) outlives the cancelled login (lib/connect-attempts.ts).

import { FinTSClient, FinTSConfig } from 'lib-fints';
import type { SynchronizeResponse } from 'lib-fints';
import { lookupBlz } from '@/lib/banks';
import { body, fail, json, wrap } from '@/lib/api';
import { bankErrorKind, withBankSignal } from '@/lib/bank-fetch';
import { beginAttempt, settleAttempt, type ConnectAttempt } from '@/lib/connect-attempts';
import { accountsFor, bankAnswerText, logResp, serializeTanMethod } from '@/lib/serialize';
import { DEBUG, PRODUCT_ID, PRODUCT_VERSION, asClientEx, getSession, newSession } from '@/lib/session';
import { loadProfile } from '@/lib/state-store';
import type { BankMeta, ConnectResponse, FinTSClientEx } from '@/lib/fints-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ConnectBody = { blz: string; userId: string; pin: string; attemptId?: string };

/** The login was called off; the browser has stopped listening already. */
const CANCELLED = 'Die Anmeldung wurde abgebrochen.';

export const POST = wrap(async (req: Request) => {
  const { blz, userId, pin, attemptId } = await body<ConnectBody>(req);

  const bankId = String(blz || '').trim();
  if (!/^\d{8}$/.test(bankId)) return fail('Bitte eine gültige 8-stellige Bankleitzahl angeben.');
  const dbEntry = lookupBlz(bankId);
  // Every listed bank has an address; a BLZ without one has left the list
  // (the browser checks a remembered bank at start, so this is the rare race).
  if (!dbEntry?.url) {
    return fail('Diese Bank steht nicht mehr in der Liste – vielleicht hat sie fusioniert. Wähle sie über „Ändern“ neu aus.');
  }
  if (!userId || !pin) return fail('Bitte Anmeldename und PIN angeben.');

  const attempt = beginAttempt(attemptId);
  try {
    return await login(attempt, bankId, dbEntry, userId, pin);
  } catch (err) {
    if (attempt.signal.aborted) return fail(CANCELLED, 409);
    throw err;
  } finally {
    // Over: a late cancel still finds the session it created, if any.
    settleAttempt(attempt);
  }
});

async function login(
  attempt: ConnectAttempt,
  bankId: string,
  dbEntry: NonNullable<ReturnType<typeof lookupBlz>>,
  userId: string,
  pin: string,
) {
  /** A session for this login — unless it was called off meanwhile. */
  const open = (client: FinTSClientEx, meta: BankMeta): string | null => {
    if (attempt.signal.aborted) return null;
    const sessionId = newSession(client, meta);
    settleAttempt(attempt, sessionId);
    return sessionId;
  };

  const buildMeta = (): BankMeta => ({
    blz: bankId,
    bankName: dbEntry.name || `BLZ ${bankId}`,
    brand: dbEntry.brand || 'generic',
    bic: dbEntry.bic || null,
  });

  // ---- Fast path: a remembered device -------------------------------------
  // If we have an encrypted profile for (BLZ, user) that the PIN unlocks, we
  // restore the systemId + cached accounts + TAN method and go straight to the
  // dashboard — no synchronisation SCA. The bank may then serve reads TAN-free
  // within its exemption window. ANY failure here falls through to first-time.
  const saved = loadProfile(bankId, userId, pin);
  if (saved?.bankingInformation?.systemId && saved.bankingInformation.systemId !== '0') {
    try {
      const config = FinTSConfig.fromBankingInformation(
        PRODUCT_ID, PRODUCT_VERSION, saved.bankingInformation, userId, pin,
        saved.tanMethodId, undefined, // media set manually below to avoid a throw
      );
      config.debugEnabled = DEBUG;
      if (saved.tanMediaName && config.selectedTanMethod) {
        const m = config.selectedTanMethod;
        m.activeTanMedia = Array.from(new Set([...(m.activeTanMedia || []), saved.tanMediaName]));
        config.tanMediaName = saved.tanMediaName;
      }
      const client = asClientEx(new FinTSClient(config));
      const meta: BankMeta = {
        ...buildMeta(),
        bankName: config.bankingInformation?.bpd?.bankName || buildMeta().bankName,
      };
      const sessionId = open(client, meta);
      if (!sessionId) return fail(CANCELLED, 409);
      const s = getSession(sessionId)!;
      const accounts = accountsFor(s);
      const selMethod = config.selectedTanMethod;
      console.log(`[connect] restored device profile (blz=${bankId}) accounts=${accounts.length}`);
      const payload: ConnectResponse = {
        sessionId, bank: meta, restored: true, accounts,
        selectedTanMethod: selMethod ? serializeTanMethod(selMethod) : null,
      };
      return json(payload);
    } catch (err) {
      console.warn('[connect] profile restore failed — first-time flow:', (err as Error)?.message || err);
      // fall through
    }
  }

  const trySync = async (bankUrl: string) => {
    const config = FinTSConfig.forFirstTimeUse(
      PRODUCT_ID, PRODUCT_VERSION, bankUrl, bankId, userId, pin,
    );
    config.debugEnabled = DEBUG;
    const client = asClientEx(new FinTSClient(config));
    // Called off → the bank request ends now, not when the bank answers.
    const sync = await withBankSignal(attempt.signal, () => client.synchronize());
    return { client, sync };
  };

  let client: FinTSClientEx;
  let sync: SynchronizeResponse;
  try {
    ({ client, sync } = await trySync(dbEntry.url));
  } catch (err) {
    // The institute DB carries an alternate URL for some banks — if the
    // primary endpoint failed on the way (dead host, error page, no answer),
    // as opposed to the bank refusing the login, try that before giving up.
    const kind = bankErrorKind(err);
    if (dbEntry.urlAlt && kind && kind !== 'cancelled') {
      const e = err as { message?: string; cause?: { code?: string } };
      console.log(`[connect] ${dbEntry.url} failed (${e?.cause?.code || e.message}) — trying alternate ${dbEntry.urlAlt}`);
      ({ client, sync } = await trySync(dbEntry.urlAlt));
    } else {
      throw err;
    }
  }

  logResp('connect', { client }, sync);
  console.log(`[connect] blz=${bankId} upd=${!!client.config.bankingInformation?.upd} accounts=${client.config.bankingInformation?.upd?.bankAccounts?.length ?? 0} tanMethods=${client.config.availableTanMethods?.length ?? 0}`);
  if (!sync.success && (!client.config.availableTanMethods || client.config.availableTanMethods.length === 0)) {
    return fail(bankAnswerText(sync) || 'Deine Bank hat die Anmeldung abgelehnt. Prüfe Anmeldename und PIN.');
  }

  const bankName = client.config.bankingInformation?.bpd?.bankName || dbEntry.name || `BLZ ${bankId}`;
  const meta: BankMeta = { blz: bankId, bankName, brand: dbEntry.brand || 'generic', bic: dbEntry.bic || null };
  const sessionId = open(client, meta);
  if (!sessionId) return fail(CANCELLED, 409);
  const payload: ConnectResponse = {
    sessionId,
    bank: meta,
    tanMethods: client.config.availableTanMethods.map(serializeTanMethod),
    bankMessages: sync.bankingInformation?.bankMessages || [],
  };
  return json(payload);
}
