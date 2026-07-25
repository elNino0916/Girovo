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
import type { FinTSClient } from 'lib-fints';
import type { BankMeta, FinTSClientEx } from './fints-types';
import { saveProfile } from './state-store';

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
// ---------------------------------------------------------------------------
type FileConfig = {
  productId?: string;
  productVersion?: string;
  debug?: boolean;
  merchantLogos?: boolean;
};

let fileConfig: FileConfig = {};
try {
  fileConfig = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'config.json'), 'utf8'));
} catch { /* config.json is optional */ }

export const PLACEHOLDER_ID = 'MEINEBANKINGAPP0001';
export const PRODUCT_ID = process.env.FINTS_PRODUCT_ID || fileConfig.productId || PLACEHOLDER_ID;
export const PRODUCT_VERSION = process.env.FINTS_PRODUCT_VERSION || fileConfig.productVersion || '1.0';
export const DEBUG = !!(process.env.FINTS_DEBUG || fileConfig.debug);

// ---------------------------------------------------------------------------
// Merchant logos
//
// The one feature that contacts a host other than the bank: counterparty names
// are matched against Wikidata to show a company's logo on its transactions
// (lib/merchants.ts). Only names that look corporate are sent, and only the
// cleaned company core — but it is still transaction metadata leaving the
// machine, so it is switchable:
//
//   config.json  { "merchantLogos": false }
//   environment  FINTS_MERCHANT_LOGOS=0
//
// Off means the app talks to nothing but your bank, and every transaction keeps
// its plain avatar.
// ---------------------------------------------------------------------------
export const MERCHANT_LOGOS = (() => {
  const env = process.env.FINTS_MERCHANT_LOGOS;
  if (env != null && env !== '') return !['0', 'false', 'no', 'off'].includes(env.toLowerCase());
  return fileConfig.merchantLogos !== false; // default on
})();

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
export type PendingOperation =
  | { type: 'sync'; tanReference?: string }
  | { type: 'balance' | 'statements' | 'pending'; tanReference?: string; accountNumber: string }
  | { type: 'transfer'; tanReference?: string; accountNumber: string; segId: string };

export type Session = {
  id: string;
  client: FinTSClientEx;
  meta: BankMeta;
  pending: PendingOperation | null;
  lastSeen: number;
  deviceSaved?: boolean;
};

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min idle timeout

type SessionGlobal = typeof globalThis & {
  __sooskasseSessions?: Map<string, Session>;
  __sooskasseSweeper?: ReturnType<typeof setInterval>;
};
const g = globalThis as SessionGlobal;

const sessions: Map<string, Session> = (g.__sooskasseSessions ??= new Map());

if (!g.__sooskasseSweeper) {
  g.__sooskasseSweeper = setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) {
      if (now - s.lastSeen > SESSION_TTL_MS) sessions.delete(id);
    }
  }, 60 * 1000);
  g.__sooskasseSweeper.unref?.();
}

export function newSession(client: FinTSClientEx, meta: BankMeta): string {
  const id = crypto.randomBytes(24).toString('hex');
  sessions.set(id, { id, client, meta, pending: null, lastSeen: Date.now() });
  return id;
}

export function getSession(id: unknown): Session | null {
  if (typeof id !== 'string') return null;
  const s = sessions.get(id);
  if (!s) return null;
  s.lastSeen = Date.now();
  return s;
}

export function dropSession(id: unknown): void {
  if (typeof id === 'string') sessions.delete(id);
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
    const ok = saveProfile(s.meta.blz, cfg.userId, cfg.pin, {
      bankingInformation: cfg.bankingInformation,
      tanMethodId: cfg.tanMethodId,
      tanMediaName: cfg.tanMediaName,
    });
    if (ok) {
      s.deviceSaved = true;
      console.log(`[state] device profile saved (blz=${s.meta.blz})`);
    }
  } catch (err) {
    console.warn('[state] save failed:', (err as Error)?.message || err);
  }
}
