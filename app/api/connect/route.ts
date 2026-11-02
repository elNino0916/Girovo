// Step 1: connect + first synchronisation (fetches BPD incl. available TAN methods).
//
// The browser sends an attempt id with the login. "Abbrechen" on the login
// form posts it to ./cancel, which ends the bank request and makes sure no
// session (and so no PIN) outlives the cancelled login (lib/connect-attempts.ts).

import { FinTSClient, FinTSConfig } from 'lib-fints';
import { lookupBlz } from '@/lib/banks';
import { body, fail, json, wrap } from '@/lib/api';
import { bankErrorKind, withBankSignal } from '@/lib/bank-fetch';
import { beginAttempt, settleAttempt, type ConnectAttempt } from '@/lib/connect-attempts';
import { msgs } from '@/lib/i18n';
import { UNREGISTERED, restorePlan, withProductFallback } from '@/lib/product-fallback';
import { accountsFor, bankAnswerCodes, bankAnswerText, logResp, serializeTanMethod } from '@/lib/serialize';
import {
  DEBUG, FALLBACK_PRODUCT_ID, PRODUCT_ID, PRODUCT_VERSION, asClientEx, getSession, newSession, restoredClient,
  type Session,
} from '@/lib/session';
import { loadProfile, type DeviceProfile } from '@/lib/state-store';
import { noteTelemetry, reportEvent } from '@/lib/telemetry';
import type { BankMeta, ConnectResponse, FinTSClientEx } from '@/lib/fints-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ConnectBody = { blz: string; userId: string; pin: string; attemptId?: string };

/** The login was called off; the browser has stopped listening already. */
const cancelled = () => fail(msgs().auth.api.cancelled, 409);

export const POST = wrap(async (req: Request) => {
  const { blz, userId, pin, attemptId } = await body<ConnectBody>(req);

  const bankId = String(blz || '').trim();
  if (!/^\d{8}$/.test(bankId)) return fail(msgs().auth.api.invalidBlz);
  const dbEntry = lookupBlz(bankId);
  // Every listed bank has an address; a BLZ without one has left the list
  // (the browser checks a remembered bank at start, so this is the rare race).
  if (!dbEntry?.url) return fail(msgs().auth.api.bankGone);
  if (!userId || !pin) return fail(msgs().auth.api.missingCredentials);

  // Telemetry: which bank and how the login went — never who logged in.
  noteTelemetry({ blz: bankId });
  const started = Date.now();
  const outcome: LoginOutcome = (result, extra = {}) =>
    reportEvent('login_result', { blz: bankId, outcome: result, ms: Date.now() - started, ...extra });

  const attempt = beginAttempt(attemptId);
  try {
    return await login(attempt, bankId, dbEntry, userId, pin, outcome);
  } catch (err) {
    if (attempt.signal.aborted) {
      outcome('cancelled');
      return cancelled();
    }
    outcome(bankErrorKind(err) ?? 'error');
    throw err;
  } finally {
    // Over: a late cancel still finds the session it created, if any.
    settleAttempt(attempt);
  }
});

type LoginOutcome = (
  result: string,
  // `product`: whether the bank took Girovo's own ID or only the previous one; `relogin`: a
  // remembered device set up afresh because its bank knows the own one now (lib/product-fallback.ts).
  extra?: { restored?: boolean; tanMethods?: number; product?: 'own' | 'previous'; relogin?: boolean },
) => void;

async function login(
  attempt: ConnectAttempt,
  bankId: string,
  dbEntry: NonNullable<ReturnType<typeof lookupBlz>>,
  userId: string,
  pin: string,
  outcome: LoginOutcome,
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

  /** Which ID the bank took, for telemetry: banks still on the previous one keep the fallback needed. */
  const productOf = (id: string) => (id === PRODUCT_ID ? 'own' : 'previous');

  // ---- Fast path: a remembered device -------------------------------------
  // If we have an encrypted profile for (BLZ, user) that the PIN unlocks, we
  // restore the systemId + cached accounts + TAN method and go straight to the
  // dashboard — no synchronisation SCA. The bank may then serve reads TAN-free
  // within its exemption window. ANY failure here falls through to first-time.
  const saved = loadProfile(bankId, userId, pin);
  // Its Kundensystem-ID belongs to the product ID it was issued under: beside any other the bank refuses it (9391).
  const plan = restorePlan(saved, PRODUCT_ID, FALLBACK_PRODUCT_ID);
  if (saved && plan.kind === 'fresh') {
    console.log(`[connect] device profile from a product ID no longer sent (blz=${bankId}) — synchronising afresh`);
  }

  /** The remembered device, opened as it is under `productId` — null where that fails. */
  const restore = (profile: DeviceProfile, productId: string) => {
    try {
      const client = restoredClient(profile, productId, userId, pin);
      const { config } = client;
      const meta: BankMeta = {
        ...buildMeta(),
        bankName: config.bankingInformation?.bpd?.bankName || buildMeta().bankName,
      };
      const sessionId = open(client, meta);
      if (!sessionId) {
        outcome('cancelled');
        return cancelled();
      }
      const s = getSession(sessionId)!;
      const accounts = accountsFor(s);
      const selMethod = config.selectedTanMethod;
      console.log(`[connect] restored device profile (blz=${bankId}) accounts=${accounts.length}`);
      outcome('ok', { restored: true, product: productOf(productId) });
      const payload: ConnectResponse = {
        sessionId, bank: meta, restored: true, accounts,
        selectedTanMethod: selMethod ? serializeTanMethod(selMethod) : null,
      };
      return json(payload);
    } catch (err) {
      console.warn('[connect] profile restore failed — first-time flow:', (err as Error)?.message || err);
      return null;
    }
  };

  if (saved && plan.kind === 'restore') {
    const restored = restore(saved, plan.productId);
    if (restored) return restored;
  }

  const trySync = async (bankUrl: string, fallback: string | null) => {
    const config = FinTSConfig.forFirstTimeUse(
      PRODUCT_ID, PRODUCT_VERSION, bankUrl, bankId, userId, pin,
    );
    config.debugEnabled = DEBUG;
    const client = asClientEx(new FinTSClient(config));
    // Called off → the bank request ends now, not when the bank answers. A
    // bank that does not know Girovo's own ID yet is asked once more with `fallback`.
    const sync = await withBankSignal(attempt.signal, () => withProductFallback(
      client.config, fallback, bankAnswerCodes, () => client.synchronize(),
    ));
    return { client, sync };
  };

  const firstSync = async (fallback: string | null) => {
    try {
      return await trySync(dbEntry.url, fallback);
    } catch (err) {
      // The institute DB carries an alternate URL for some banks — if the
      // primary endpoint failed on the way (dead host, error page, no answer),
      // as opposed to the bank refusing the login, try that before giving up.
      const kind = bankErrorKind(err);
      if (!dbEntry.urlAlt || !kind || kind === 'cancelled') throw err;
      const e = err as { message?: string; cause?: { code?: string } };
      console.log(`[connect] ${dbEntry.url} failed (${e?.cause?.code || e.message}) — trying alternate ${dbEntry.urlAlt}`);
      return trySync(dbEntry.urlAlt, fallback);
    }
  };

  // ---- A device set up under the previous product ID ----------------------
  // The bank is asked with Girovo's own ID first (lib/product-fallback.ts).
  // Where it takes it, this login is a full one — the Sicherheitsverfahren
  // and one approval — and the device is remembered afresh, under the own ID.
  // Where it does not know it yet (9078), or cannot be reached, the device
  // opens as it is under the previous ID, without an approval. Any other
  // refusal (a PIN the bank no longer takes) is this login's answer.
  type FirstSync = Awaited<ReturnType<typeof firstSync>>;
  let first: FirstSync | null = null;
  let remembered: Session['remembered'];
  if (saved && plan.kind === 'ask') {
    let asked: FirstSync | null = null;
    try {
      asked = await firstSync(null);
    } catch (err) {
      if (attempt.signal.aborted) throw err;
      console.warn(`[product] could not ask the bank about the own product ID (blz=${bankId}):`, (err as Error)?.message || err);
    }
    if (asked && !bankAnswerCodes(asked.sync).has(UNREGISTERED)) {
      first = asked;
      remembered = { profile: saved, productId: plan.productId };
    } else {
      if (asked) console.log(`[product] the bank does not know the own product ID yet (9078, blz=${bankId}) — the device opens under the previous one`);
      const restored = restore(saved, plan.productId);
      if (restored) return restored;
    }
  }

  const { client, sync } = first ?? await firstSync(FALLBACK_PRODUCT_ID);

  logResp('connect', { client }, sync);
  console.log(`[connect] blz=${bankId} upd=${!!client.config.bankingInformation?.upd} accounts=${client.config.bankingInformation?.upd?.bankAccounts?.length ?? 0} tanMethods=${client.config.availableTanMethods?.length ?? 0}`);
  if (!sync.success && (!client.config.availableTanMethods || client.config.availableTanMethods.length === 0)) {
    outcome('refused');
    return fail(bankAnswerText(sync) || msgs().auth.api.refused);
  }

  const bankName = client.config.bankingInformation?.bpd?.bankName || dbEntry.name || `BLZ ${bankId}`;
  const meta: BankMeta = { blz: bankId, bankName, brand: dbEntry.brand || 'generic', bic: dbEntry.bic || null };
  const sessionId = open(client, meta);
  if (!sessionId) {
    outcome('cancelled');
    return cancelled();
  }
  if (remembered) {
    console.log(`[product] the bank takes the own product ID now (blz=${bankId}) — this login sets the device up afresh`);
    // Kept for /api/select-tan, where a bank may still refuse the own ID.
    getSession(sessionId)!.remembered = remembered;
  }
  outcome('ok', {
    restored: false, tanMethods: client.config.availableTanMethods.length,
    product: productOf(client.config.productId), relogin: remembered ? true : undefined,
  });
  const payload: ConnectResponse = {
    sessionId,
    bank: meta,
    tanMethods: client.config.availableTanMethods.map(serializeTanMethod),
    bankMessages: sync.bankingInformation?.bankMessages || [],
    ...(remembered ? { productChanged: true as const } : {}),
  };
  return json(payload);
}
