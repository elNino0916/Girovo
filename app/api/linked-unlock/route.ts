// "Weitere Banken mit anmelden" on the desktop (lib/linked-unlock.ts): the
// further banks' PINs kept beside the first login, opened by its PIN.
//
// One POST with an `op`, the sessionId in the body, never in a URL:
//   seal   (secret) → { on, count }        keeps the PINs of the sessions in `linked` beside it
//   open   (secret) → { on, linked, dropped? }  the further banks' logins with their PINs —
//                                        none before the bank has taken this session's PIN
//   forget (secret) → { on }               one further bank's PIN (`login`)
//   off             → { on: false }        every PIN kept beside it
// `secret` is the desktop shell's (src-tauri/src/secret.rs), handed over by
// the page; it is mixed into the key and kept nowhere. The PINs to keep come
// from the live sessions, never from the request. Nothing here is logged.
//
// Served only where lib/linked-unlock.ts says (the desktop app's server):
// 404 anywhere else, so no other build keeps a PIN this way.

import { boundedBody, fail, json, sessionExpired, wrap } from '@/lib/api';
import { msgs } from '@/lib/i18n';
import { LINKED_BANK_LIMITS } from '@/lib/linked-banks';
import {
  forgetLogin, isOn, linkedUnlockServed, loginOfSession, openLogins, parseSecret, removeLinkedUnlock, sealLogins,
  type SealedLogin,
} from '@/lib/linked-unlock';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type LinkedUnlockBody = {
  sessionId?: string;
  op?: 'seal' | 'open' | 'forget' | 'off';
  secret?: string;
  linked?: unknown;
  login?: unknown;
};

/** A few session ids and a login: far below this. */
const REQUEST_MAX_BYTES = 8 * 1024;

export const POST = wrap(async (req: Request) => {
  const said = msgs().provider.linkedUnlock;
  if (!linkedUnlockServed()) return fail(said.unavailable, 404);
  const b = await boundedBody<LinkedUnlockBody>(req, REQUEST_MAX_BYTES);
  if (!b) return fail(said.unknownAction, 413);
  const s = getSession(b.sessionId ?? '');
  if (!s) return sessionExpired();
  const own = loginOfSession(s);
  if (!own) return fail(said.unavailable, 409);

  if (b.op === 'off') {
    await removeLinkedUnlock(own);
    return json({ on: false });
  }

  const secret = parseSecret(b.secret);
  if (!secret) return fail(said.noSecret, 400);
  switch (b.op) {
    case 'seal': {
      const ids = Array.isArray(b.linked) ? b.linked.filter((id): id is string => typeof id === 'string') : [];
      const logins = ids.slice(0, LINKED_BANK_LIMITS.count)
        .map((id) => (id === s.id ? null : loginOfSession(getSession(id))))
        .filter((l): l is SealedLogin => !!l);
      return json({ on: true, count: await sealLogins(own, secret, logins) });
    }
    case 'open':
      // A remembered device opens on this computer with an old PIN too: the
      // further banks' PINs wait for the bank's word on this one (Session.pinAccepted).
      if (!s.pinAccepted) return json({ on: isOn(own), linked: [] });
      return json(await openLogins(own, secret));
    case 'forget': {
      const login = b.login as { blz?: unknown; userId?: unknown } | null;
      if (!login || typeof login.blz !== 'string' || typeof login.userId !== 'string') return fail(said.unknownAction);
      return json(await forgetLogin(own, secret, { blz: login.blz, userId: login.userId }));
    }
    default:
      return fail(said.unknownAction);
  }
});
