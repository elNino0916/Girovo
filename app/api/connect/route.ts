// Step 1: connect + first synchronisation (fetches BPD incl. available TAN methods).

import { FinTSClient, FinTSConfig } from 'lib-fints';
import type { SynchronizeResponse } from 'lib-fints';
import { lookupBlz } from '@/lib/banks';
import { body, fail, json, wrap } from '@/lib/api';
import { accountsFor, bankAnswerText, logResp, serializeTanMethod } from '@/lib/serialize';
import { DEBUG, PRODUCT_ID, PRODUCT_VERSION, asClientEx, getSession, newSession } from '@/lib/session';
import { loadProfile } from '@/lib/state-store';
import type { BankMeta, ConnectResponse, FinTSClientEx } from '@/lib/fints-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ConnectBody = { blz: string; userId: string; pin: string; customUrl?: string };

export const POST = wrap(async (req: Request) => {
  const { blz, userId, pin, customUrl } = await body<ConnectBody>(req);

  const bankId = String(blz || '').trim();
  if (!/^\d{8}$/.test(bankId)) return fail('Bitte eine gültige 8-stellige Bankleitzahl angeben.');
  const dbEntry = lookupBlz(bankId);
  const url = (customUrl || '').trim() || dbEntry?.url;
  if (!url) return fail('Für diese BLZ ist keine FinTS-URL bekannt. Bitte URL manuell angeben.');
  if (!/^https:\/\//.test(url)) return fail('Die FinTS-URL muss mit https:// beginnen.');
  if (!userId || !pin) return fail('Bitte Anmeldename und PIN angeben.');

  const buildMeta = (): BankMeta => ({
    blz: bankId,
    bankName: dbEntry?.name || `BLZ ${bankId}`,
    brand: dbEntry?.brand || 'generic',
    bic: dbEntry?.bic || null,
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
      const sessionId = newSession(client, meta);
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
    const sync = await client.synchronize();
    return { client, sync };
  };

  // Transport-level failures (dead host, HTTP error page) — as opposed to a
  // FinTS-level rejection, which means the URL is fine but the login isn't.
  const isTransportError = (err: unknown) => {
    const e = err as { message?: string; cause?: { code?: string } };
    return (
      e?.message === 'fetch failed' ||
      ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(e?.cause?.code || '') ||
      /request failed with status code/i.test(e?.message || '') ||
      /error decoding/i.test(e?.message || '')
    );
  };

  let client: FinTSClientEx;
  let sync: SynchronizeResponse;
  try {
    ({ client, sync } = await trySync(url));
  } catch (err) {
    // The institute DB carries an alternate URL for some banks — if the
    // primary endpoint is unreachable, try that before giving up.
    if (!customUrl && dbEntry?.urlAlt && isTransportError(err)) {
      const e = err as { message?: string; cause?: { code?: string } };
      console.log(`[connect] ${url} failed (${e?.cause?.code || e.message}) — trying alternate ${dbEntry.urlAlt}`);
      ({ client, sync } = await trySync(dbEntry.urlAlt));
    } else {
      throw err;
    }
  }

  logResp('connect', { client }, sync);
  console.log(`[connect] blz=${bankId} upd=${!!client.config.bankingInformation?.upd} accounts=${client.config.bankingInformation?.upd?.bankAccounts?.length ?? 0} tanMethods=${client.config.availableTanMethods?.length ?? 0}`);
  if (!sync.success && (!client.config.availableTanMethods || client.config.availableTanMethods.length === 0)) {
    return fail(bankAnswerText(sync) || 'Synchronisation fehlgeschlagen. Prüfe BLZ, Anmeldename und PIN.');
  }

  const bankName = client.config.bankingInformation?.bpd?.bankName || dbEntry?.name || `BLZ ${bankId}`;
  const meta: BankMeta = { blz: bankId, bankName, brand: dbEntry?.brand || 'generic', bic: dbEntry?.bic || null };
  const sessionId = newSession(client, meta);
  const payload: ConnectResponse = {
    sessionId,
    bank: meta,
    tanMethods: client.config.availableTanMethods.map(serializeTanMethod),
    bankMessages: sync.bankingInformation?.bankMessages || [],
  };
  return json(payload);
});
