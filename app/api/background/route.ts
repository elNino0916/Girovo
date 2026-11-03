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
//   off                                  → { on: false } every PIN
//   check  {secret}                      → { checked, notices }       the desktop shell's six-hourly call;
//                                          the phone's job calls lib/background-check.ts itself
// `secret` is the shell's (electron/linked-unlock.cjs; BackgroundPlugin.java),
// mixed into the key and kept nowhere. PINs come from live sessions, never
// from the request. Nothing here is logged.
//
// Served only where lib/background-store.ts says: 404 anywhere else.

import { boundedBody, fail, json, sessionExpired, wrap } from '@/lib/api';
import { bankSide } from '@/lib/background-bank';
import { disable, enroll, enrolled, forget, isOn, parseSecret, runCheck, touch, type CheckedLogin } from '@/lib/background-check';
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
  op?: 'status' | 'state' | 'enroll' | 'touch' | 'forget' | 'off' | 'check';
  secret?: string;
  sessionId?: string;
  sessionIds?: unknown;
  amounts?: unknown;
  login?: unknown;
  accountNumber?: unknown;
  keys?: unknown;
};

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
      const account = typeof b.accountNumber === 'string' ? b.accountNumber : undefined;
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
    case 'check':
      return json(await runCheck(store, secret, bankSide));
    default:
      return fail(said.unknownAction);
  }
});
