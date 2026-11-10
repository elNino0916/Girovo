// Server-side session state and product registration.
//
// Security model: credentials (PIN) live only in this process's memory for the
// lifetime of a session and are never written to disk or logged. Run locally.
//
// A session owns one live `FinTSClient` — an open FinTS dialog with the bank —
// plus a record of the currently pending TAN-gated operation, so polling knows
// how to continue. None of that is serialisable, which is why the store is
// pinned to `globalThis`: Next.js re-evaluates route modules on hot reload, and
// a plain module-level Map would drop every logged-in user mid-approval. It
// also means the app must stay a single Node process (see next.config.ts).

import 'server-only';

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { FinTSClient, FinTSConfig } from 'lib-fints';
import type { BankMeta, BankOrderKind, FinTSClientEx, ReadBankOrder, SerializedVop } from './fints-types';
import type { TransferOrder } from './fints-sepa';
import type { DaySpan } from './history';
import type { StatementSeg } from './bank-statements';
import type { OrderSchedule } from './order-schedule';
import { isPinRefusal } from './bank-answer';
import { findSessionsWith } from './history-store';
import { fintsProductVersion } from './product-version';
import { removeSecurityKeys } from './security-key';
import { profileState, replacesAnotherPin, saveProfile, type DeviceProfile, type ProfileState } from './state-store';
import { noteTelemetry } from './telemetry';
import { removeWindowsHello } from './windows-hello';

/**
 * Widen a client to the members lib-fints declares private but this app needs
 * (see FinTSClientEx). The double assertion is the price of reaching past the
 * published surface; it is confined to this one function.
 */
export const asClientEx = (client: FinTSClient): FinTSClientEx =>
  client as unknown as FinTSClientEx;

// ---------------------------------------------------------------------------
// Product registration
//
// FinTS requires a product registration ID issued by the ZKA
// (https://www.hbci-zka.de/register/prod_register.htm). Without a valid,
// registered ID the bank rejects the dialog with 9078 ("Software nicht als
// FinTS-Produkt registriert").
//
// The ID is read (in order of priority) from:
//   1. the FINTS_PRODUCT_ID environment variable, or
//   2. config.json in the project root  { "productId": "...", … }
//
// The version beside it is Girovo's own major.minor unless one is set
// (lib/product-version.ts): FinTS allows it five characters.
// ---------------------------------------------------------------------------
type FileConfig = {
  productId?: string;
  fallbackProductId?: string;
  productVersion?: string;
  debug?: boolean;
  merchantLogos?: boolean;
  brandfetchClientId?: string;
};

let fileConfig: FileConfig = {};
try {
  fileConfig = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'config.json'), 'utf8'));
} catch { /* config.json is optional */ }

export const PLACEHOLDER_ID = 'MEINEBANKINGAPP0001';
export const PRODUCT_ID = process.env.FINTS_PRODUCT_ID || fileConfig.productId || PLACEHOLDER_ID;
/** Tried where a bank does not know PRODUCT_ID yet (9078) — lib/product-fallback.ts. */
export const FALLBACK_PRODUCT_ID = process.env.FINTS_FALLBACK_PRODUCT_ID || fileConfig.fallbackProductId || null;
export const PRODUCT_VERSION = fintsProductVersion(
  process.env.FINTS_PRODUCT_VERSION || fileConfig.productVersion,
  process.env.NEXT_PUBLIC_APP_VERSION,
);
export const DEBUG = !!(process.env.FINTS_DEBUG || fileConfig.debug);

// ---------------------------------------------------------------------------
// Merchant logos
//
// The one feature that contacts a host other than the bank: counterparty names
// are matched against Brandfetch (https://brandfetch.com) to show a company's
// logo on its transactions (lib/merchants.ts). Only names that look corporate
// are sent, and only the cleaned company core — but it is still transaction
// metadata leaving the machine, together with the user's IP address.
//
// So it is the user's decision, made in the app: logos stay off until they
// answer a one-time question that comes before the first lookup, and the
// Sitzung panel switches them later (the client holds every lookup until
// then — see resolveMerchants in components/FintsProvider.tsx).
//
// MERCHANT_LOGOS only says whether this build offers the feature at all. It
// is the hard kill switch above that choice: off, the app never asks, shows no
// switch, and talks to nothing but the bank.
//
//   config.json  { "merchantLogos": false }
//   environment  FINTS_MERCHANT_LOGOS=0
//
// Brandfetch requires a client ID (free, from https://developers.brandfetch.com)
// on every request. Without one the feature is not offered either, since there
// is nothing to call.
//
//   config.json  { "brandfetchClientId": "..." }
//   environment  BRANDFETCH_CLIENT_ID=...
// ---------------------------------------------------------------------------
export const BRANDFETCH_CLIENT_ID =
  process.env.BRANDFETCH_CLIENT_ID || fileConfig.brandfetchClientId || '';

/** Whether this build offers company logos (never whether the user agreed). */
export const MERCHANT_LOGOS = (() => {
  if (!BRANDFETCH_CLIENT_ID) return false;
  const env = process.env.FINTS_MERCHANT_LOGOS;
  if (env != null && env !== '') return !['0', 'false', 'no', 'off'].includes(env.toLowerCase());
  return fileConfig.merchantLogos !== false;
})();

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
export type PendingOperation =
  | { type: 'sync'; tanReference?: string }
  | { type: 'balance' | 'pending' | 'portfolio'; tanReference?: string; accountNumber: string }
  /** The bank's Kontoauszüge: over HKEKA or HKEKP (lib/bank-statements.ts). */
  | { type: 'bankStatements'; tanReference?: string; accountNumber: string; segId: StatementSeg }
  /** `asked`: the days the bank was asked for, which the kept Umsätze need once it answers (lib/history-store.ts). */
  | { type: 'statements'; tanReference?: string; accountNumber: string; asked: DaySpan }
  /** An order: a transfer (HKCCS/HKIPZ), a terminierte Überweisung (HKCSE) or a Dauerauftrag (HKCDE). */
  | { type: 'transfer'; tanReference?: string; accountNumber: string; segId: string }
  /** A Bestand read (HKCDB/HKCSB). */
  | { type: 'bankOrders'; tanReference?: string; accountNumber: string; segId: string; kind: BankOrderKind }
  /** Deleting one of them (HKCDL/HKCSL). */
  | { type: 'orderDelete'; tanReference?: string; accountNumber: string; segId: string; ref: string };

/**
 * A transfer parked between the Namensabgleich and the customer's decision.
 *
 * The bank has checked the payee name and voided the TAN challenge (return code
 * 3945); the order goes out again with HKVPA once the user has seen the result.
 * That re-submission must repeat the *identical* pain.001, so the built message
 * is kept here rather than regenerated — see lib/fints-vop.ts. A terminierte
 * Überweisung or a Dauerauftrag keeps its schedule too: HKCDE repeats its
 * Dauerauftragsdetails beside the pain.
 */
export type VopHold = {
  vopId: string;
  accountNumber: string;
  segId: string;
  instant: boolean;
  transfer: TransferOrder;
  schedule?: OrderSchedule;
  /** A change of a bank-held order (HKCSA/HKCDN): the order it changes. */
  change?: { orderId: string };
  descriptor: string;
  sepaMessage: string;
  vop: SerializedVop;
  createdAt: number;
};

/**
 * The orders of the last Bestand read, per handle (SerializedBankOrder.ref):
 * a deletion must send the bank's own pain message back unchanged, and the
 * browser never holds it — it names the handle, the server finds the rest.
 */
export type HeldBankOrder = ReadBankOrder & { accountNumber: string; kind: BankOrderKind };

export type Session = {
  id: string;
  client: FinTSClientEx;
  meta: BankMeta;
  pending: PendingOperation | null;
  /** Set only while a transfer waits for the user to accept a VoP result. */
  vopHold: VopHold | null;
  /** The last Bestand read of each account and kind, by handle (see HeldBankOrder). */
  bankOrders: Map<string, HeldBankOrder>;
  lastSeen: number;
  deviceSaved?: boolean;
  /**
   * A remembered device set up under the previous product ID, while this
   * login sets it up afresh because the bank knows Girovo's own ID now
   * (lib/product-fallback.ts). A bank that refuses the own ID only once the
   * Sicherheitsverfahren is chosen opens the device from it after all
   * (/api/select-tan), under `productId`.
   */
  remembered?: { profile: DeviceProfile; productId: string };
  /**
   * A further bank of the view ("Weitere Bank anmelden"): the id of the
   * primary login's session, whose vault decides whether this login keeps
   * its Umsätze on this computer (lib/history-store.ts). Set by /api/history
   * "follow"; this login's own vault, if it has one, belongs to another view.
   */
  keepChoiceFrom?: string;
  /**
   * The bank has taken this session's PIN: it synchronised the login, or
   * answered a read (or asked an approval for one). A remembered device opens
   * on this computer with an old PIN too, so until then nothing kept under
   * that PIN for other banks leaves (app/api/linked-unlock). Taken back when
   * the bank turns the PIN down later in the session (pinRefused): from then
   * on nothing may keep it either (app/api/windows-hello, app/api/security-key).
   */
  pinAccepted?: true;
  /**
   * How the remembered device stood to this session's PIN when it logged in
   * (lib/state-store.ts openProfile, app/api/connect), and 'opens' once this
   * session has saved it: saveSessionProfile need not open it a second time.
   */
  profileWas?: ProfileState;
};

/**
 * 30 min idle timeout. Exported for /api/keepalive, which reports it so the
 * browser can pace its pings well inside the window instead of guessing.
 */
export const SESSION_TTL_MS = 30 * 60 * 1000;

type SessionGlobal = typeof globalThis & {
  __girovoSessions?: Map<string, Session>;
  __girovoSweeper?: ReturnType<typeof setInterval>;
};
const g = globalThis as SessionGlobal;

const sessions: Map<string, Session> = (g.__girovoSessions ??= new Map());

if (!g.__girovoSweeper) {
  g.__girovoSweeper = setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) {
      if (now - s.lastSeen > SESSION_TTL_MS) sessions.delete(id);
    }
  }, 60 * 1000);
  g.__girovoSweeper.unref?.();
}

export function newSession(client: FinTSClientEx, meta: BankMeta): string {
  const id = crypto.randomBytes(24).toString('hex');
  sessions.set(id, { id, client, meta, pending: null, vopHold: null, bankOrders: new Map(), lastSeen: Date.now() });
  return id;
}

// The kept Umsätze look a primary login's session up again by its id
// (Session.keepChoiceFrom) — without counting it as activity.
findSessionsWith((id) => sessions.get(id) ?? null);

export function getSession(id: unknown): Session | null {
  if (typeof id !== 'string') return null;
  const s = sessions.get(id);
  if (!s) return null;
  s.lastSeen = Date.now();
  // Which bank a failing request was for — the one thing telemetry gets to know about a session.
  noteTelemetry({ blz: s.meta?.blz });
  return s;
}

/**
 * Whether someone is in this login right now: a session of it seen within
 * `withinMs` ("Neue Umsätze melden" leaves such a login to the app,
 * lib/background-check.ts). Counts as no activity itself.
 */
export function loginInUse(blz: string, userId: string, withinMs = SESSION_TTL_MS): boolean {
  const now = Date.now();
  for (const s of sessions.values()) {
    if (s.meta?.blz === blz && s.client?.config?.userId === userId && now - s.lastSeen < withinMs) return true;
  }
  return false;
}

export function dropSession(id: unknown): void {
  if (typeof id === 'string') sessions.delete(id);
}

/** The bank turned this session's PIN down: it is no longer one the bank took (Session.pinAccepted). */
export function pinRefused(s: Session): void {
  delete s.pinAccepted;
}

/** The same, read from the bank's answer to a call in the session: only its own codes for the PIN count (9931, 9942). */
export function notePinAnswer(s: Session, answer: string): void {
  if (isPinRefusal(answer)) pinRefused(s);
}

/**
 * A client for a remembered device: its Kundensystem-ID, cached BPD/UPD and
 * TAN method, under `productId` — the ID that Kundensystem-ID was issued
 * under (lib/product-fallback.ts). No bank traffic; it may throw on a
 * profile lib-fints cannot read.
 */
export function restoredClient(saved: DeviceProfile, productId: string, userId?: string, pin?: string): FinTSClientEx {
  const config = FinTSConfig.fromBankingInformation(
    productId, PRODUCT_VERSION, saved.bankingInformation, userId, pin,
    saved.tanMethodId, undefined, // media set manually below to avoid a throw
  );
  config.debugEnabled = DEBUG;
  if (saved.tanMediaName && config.selectedTanMethod) {
    const m = config.selectedTanMethod;
    m.activeTanMedia = Array.from(new Set([...(m.activeTanMedia || []), saved.tanMediaName]));
    config.tanMediaName = saved.tanMediaName;
  }
  return asClientEx(new FinTSClient(config));
}

/**
 * Remember this session's device profile (systemId + cached BPD/UPD + selected
 * TAN method), encrypted with the PIN, so future logins can skip a fresh SCA.
 * Called once we hold a real systemId and the account list.
 */
export function saveSessionProfile(s: Session): void {
  try {
    const cfg = s?.client?.config;
    if (!cfg?.pin || !s.meta?.blz || !cfg.userId) return;
    const systemId = cfg.bankingInformation?.systemId;
    if (!systemId || systemId === '0') return; // nothing worth remembering yet
    // Remembered before under a PIN that is not this one — the PIN was
    // changed at the bank: Windows Hello and the security keys still keep
    // the old one and would send it as this login's. They go first; queued
    // per file ahead of anything this session keeps afresh. The login opened
    // the device once already (Session.profileWas): not a second time here.
    if (replacesAnotherPin(s.profileWas ?? profileState(s.meta.blz, cfg.userId, cfg.pin))) {
      const login = { blz: s.meta.blz, userId: cfg.userId };
      void Promise.allSettled([removeWindowsHello(login), removeSecurityKeys(login)]).then((done) => {
        if (done.some((d) => d.status === 'rejected')) console.warn(`[state] a PIN kept under the old one could not be deleted (blz=${login.blz})`);
      });
    }
    const ok = saveProfile(s.meta.blz, cfg.userId, cfg.pin, {
      bankingInformation: cfg.bankingInformation,
      tanMethodId: cfg.tanMethodId,
      tanMediaName: cfg.tanMediaName,
      // The ID this session's Kundensystem-ID was issued under: the own one or, where the bank
      // does not know it yet, the previous (lib/product-fallback.ts).
      productId: cfg.productId,
    });
    if (ok) {
      s.deviceSaved = true;
      s.profileWas = 'opens';
      console.log(`[state] device profile saved (blz=${s.meta.blz})`);
    }
  } catch (err) {
    console.warn('[state] save failed:', (err as Error)?.message || err);
  }
}
