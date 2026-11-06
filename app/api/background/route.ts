// "Neue Umsätze melden" (lib/background-check.ts): the PINs kept for the
// checks, and the check itself.
//
// One POST with an `op`; session ids and logins in the body, never in a URL:
//   status                               → { on }
//   state  {secret}                      → { on, amounts, logins }   the kept logins, without PINs
//   enroll {secret, sessionIds, amounts} → { on, count, skipped }    keeps the PINs of those sessions
//                                          the bank took and that have a remembered device
//   touch  {secret, sessionId, accountNumber?, keys?} → { kept }     a kept login takes the PIN the
//                                          bank just took, resumes, and counts these bookings as seen
//   forget {secret, login}               → { on }        one login's PIN
//   alerts {secret, accounts, set?}      → { on, prefs, amounts, accounts }  what the notices are about
//                                          and each account's limit (lib/payment-alerts.ts); `accounts`
//                                          names the page's accounts by session, `set` changes them
//   watch  {secret, contracts, income, drop} → { on }    Verträge & Abos' watch list
//   off                                  → { on: false } every PIN
//   check  {secret}                      → { checked, notices }       the desktop shell's six-hourly call;
//                                          the phone's job calls lib/background-check.ts itself
// `secret` is the shell's (src-tauri/src/secret.rs; BackgroundPlugin.java),
// mixed into the key and kept nowhere. PINs come from live sessions, never
// from the request. Nothing here is logged.
//
// Served only where lib/background-store.ts says: 404 anywhere else.

import { boundedBody, fail, json, sessionExpired, wrap } from '@/lib/api';
import { bankSide } from '@/lib/background-bank';
import { localKey } from '@/lib/account-key';
import {
  alertSettings, disable, enroll, enrolled, forget, isOn, limitsKey, parseSecret, runCheck, setAlerts, setWatch, touch,
  type CheckedLogin, type LimitChange,
} from '@/lib/background-check';
import { readCents, readWatch } from '@/lib/payment-alerts';
import { backgroundServed, backgroundStore } from '@/lib/background-store';
import { msgs } from '@/lib/i18n';
import { LINKED_BANK_LIMITS } from '@/lib/linked-banks';
import { loginOfSession } from '@/lib/linked-unlock';
import { getSession } from '@/lib/session';
import { hasProfile } from '@/lib/state-store';
import { readLoginName } from '@/lib/windows-hello';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type BackgroundBody = {
  op?: 'status' | 'state' | 'enroll' | 'touch' | 'forget' | 'off' | 'check' | 'alerts' | 'watch';
  secret?: string;
  sessionId?: string;
  sessionIds?: unknown;
  amounts?: unknown;
  login?: unknown;
  accountNumber?: unknown;
  keys?: unknown;
  accounts?: unknown;
  set?: unknown;
  contracts?: unknown;
  income?: unknown;
  drop?: unknown;
};

/** The page's accounts, at most this many, named by their session. */
const ACCOUNTS_MAX = 60;

/** An account of the page, `{ sessionId, accountNumber }`: its login and its own session's key, or null. */
function accountOf(v: unknown): { key: string; login: { blz: string; userId: string }; account: string } | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (typeof r.sessionId !== 'string' || typeof r.accountNumber !== 'string' || r.accountNumber.length > 80) return null;
  const login = loginOfSession(getSession(r.sessionId));
  if (!login) return null;
  // The page's key of a further bank's account may carry its BLZ (lib/account-key.ts); the check reads the bank's own.
  return { key: r.accountNumber, login: { blz: login.blz, userId: login.userId }, account: localKey(r.accountNumber) };
}

/** A statement's worth of booking keys at most. */
const REQUEST_MAX_BYTES = 256 * 1024;
const KEYS_MAX = 600;

export const POST = wrap(async (req: Request) => {
  const said = msgs().background.api;
  if (!backgroundServed()) return fail(said.unavailable, 404);
  const b = await boundedBody<BackgroundBody>(req, REQUEST_MAX_BYTES);
  if (!b) return fail(said.unknownAction, 413);
  const store = backgroundStore();

  if (b.op === 'status') return json({ on: await isOn(store) });
  if (b.op === 'off') {
    await disable(store);
    return json({ on: false });
  }

  const secret = parseSecret(b.secret);
  if (!secret) return fail(said.noSecret, 400);
  switch (b.op) {
    case 'state': {
      const found = await enrolled(store, secret);
      return json(found ? { on: true, ...found } : { on: false, amounts: true, logins: [] });
    }
    case 'enroll': {
      const ids = Array.isArray(b.sessionIds) ? b.sessionIds.filter((id): id is string => typeof id === 'string') : [];
      const logins: CheckedLogin[] = [];
      const skipped: string[] = [];
      for (const id of ids.slice(0, LINKED_BANK_LIMITS.count + 1)) {
        const s = getSession(id);
        const login = loginOfSession(s);
        if (!s || !login) continue;
        const bank = s.meta?.bankName || login.blz;
        // Only a PIN the bank took, and only where a check can open the login
        // without an approval: on its remembered device.
        if (!s.pinAccepted || !hasProfile(login.blz, login.userId)) {
          skipped.push(bank);
          continue;
        }
        logins.push({ ...login, bank });
      }
      if (!logins.length) return json({ on: await isOn(store), count: 0, skipped });
      const count = await enroll(store, secret, logins, b.amounts !== false);
      return json({ on: true, count, skipped });
    }
    case 'touch': {
      const s = getSession(b.sessionId ?? '');
      if (!s) return sessionExpired();
      const login = loginOfSession(s);
      if (!login || !s.pinAccepted) return json({ kept: false });
      // The check knows an account by its own session's key (lib/background-bank.ts): never the page's "@BLZ".
      const account = typeof b.accountNumber === 'string' ? localKey(b.accountNumber) : undefined;
      const keys = Array.isArray(b.keys)
        ? b.keys.filter((k): k is string => typeof k === 'string' && k.length <= 300).slice(0, KEYS_MAX)
        : undefined;
      return json({ kept: await touch(store, secret, login, account, keys) });
    }
    case 'forget': {
      const login = readLoginName(b.login);
      if (!login) return fail(said.unknownAction);
      await forget(store, secret, login);
      return json({ on: await isOn(store) });
    }
    case 'alerts': {
      const accounts = (Array.isArray(b.accounts) ? b.accounts : []).slice(0, ACCOUNTS_MAX).map(accountOf).filter((a) => !!a);
      const set = (b.set && typeof b.set === 'object' ? b.set : null) as Record<string, unknown> | null;
      if (set) {
        const prefs: Record<string, boolean> = {};
        for (const k of ['every', 'dearer', 'income'] as const) if (typeof set[k] === 'boolean') prefs[k] = set[k] as boolean;
        const limits: LimitChange[] = [];
        for (const raw of (Array.isArray(set.limits) ? set.limits : []).slice(0, ACCOUNTS_MAX)) {
          const a = accountOf(raw);
          if (!a) continue;
          const r = raw as Record<string, unknown>;
          const cents = r.cents === null ? null : readCents(r.cents);
          if (cents === null && r.cents !== null) continue;
          const label = typeof r.label === 'string' ? r.label : '';
          limits.push({ login: a.login, account: a.account, limit: cents === null ? null : { cents, label } });
        }
        const amounts = typeof set.amounts === 'boolean' ? set.amounts : undefined;
        if (!(await setAlerts(store, secret, { prefs, amounts, limits }))) return json({ on: await isOn(store) });
      }
      const found = await alertSettings(store, secret);
      if (!found) return json({ on: false });
      const byAccount: Record<string, { checked: boolean; cents: number | null }> = {};
      for (const a of accounts) {
        const lk = limitsKey(a.login);
        byAccount[a.key] = { checked: found.logins.includes(lk), cents: found.limits[lk]?.[a.account]?.cents ?? null };
      }
      return json({ on: true, prefs: found.prefs, amounts: found.amounts, accounts: byAccount });
    }
    case 'watch': {
      const next = readWatch({ contracts: b.contracts, income: b.income });
      const drop = (Array.isArray(b.drop) ? b.drop : []).filter((k): k is string => typeof k === 'string' && k.length <= 300).slice(0, 400);
      return json({ on: await setWatch(store, secret, { ...next, drop }) });
    }
    case 'check':
      // `on: false` tells the shell to stop planning checks (src-tauri/src/background.rs).
      return json(await runCheck(store, secret, bankSide));
    default:
      return fail(said.unknownAction);
  }
});
