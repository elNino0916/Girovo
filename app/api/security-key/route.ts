// A security key in place of typing the first login's PIN on the desktop
// (lib/security-key.ts): the login's PIN kept under what the key answers and
// the shell's DPAPI secret.
//
// One POST with an `op`; a login and session ids in the body, never in a URL:
//   status {login}                                → { keys, salt }  the login's keys and its salt; needs no key
//   seal   {sessionId, credential, key, secret}   → { keys }        keeps this session's PIN — only once the bank took it
//   open   {login, credential, key, secret}       → { pin } | { on: false, dropped? }
//   rename {login, id, name}                      → { keys }        a key's name, '' for none
//   forget {login, id?}                           → { keys }        one key, or all of them
// `key` comes from the shell after the gesture (src-tauri/src/security_key.rs),
// `secret` from src-tauri/src/secret.rs; both are mixed into the key and kept
// nowhere. The PIN to keep comes from the live session, never from the
// request. Nothing here is logged.
//
// Served only where the desktop app's server keeps PINs at all
// (lib/linked-unlock.ts linkedUnlockServed): 404 anywhere else.

import { boundedBody, fail, json, sessionExpired, wrap } from '@/lib/api';
import { msgs } from '@/lib/i18n';
import { linkedUnlockServed, loginOfSession, parseSecret } from '@/lib/linked-unlock';
import {
  listKeys, openPin, parseCredential, parseKeyId, parseKeyName, removeKey, removeSecurityKeys, renameKey, saltOf, sealPin,
} from '@/lib/security-key';
import { getSession } from '@/lib/session';
import { parseHelloKey, readLoginName } from '@/lib/windows-hello';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SecurityKeyBody = {
  op?: 'status' | 'seal' | 'open' | 'forget' | 'rename';
  sessionId?: string;
  login?: unknown;
  credential?: unknown;
  id?: unknown;
  name?: unknown;
  key?: string;
  secret?: string;
};

const REQUEST_MAX_BYTES = 8 * 1024;

export const POST = wrap(async (req: Request) => {
  const said = msgs().provider.securityKey;
  if (!linkedUnlockServed()) return fail(said.unavailable, 404);
  const b = await boundedBody<SecurityKeyBody>(req, REQUEST_MAX_BYTES);
  if (!b) return fail(said.unknownAction, 413);

  if (b.op === 'seal') {
    const s = getSession(b.sessionId ?? '');
    if (!s) return sessionExpired();
    const own = loginOfSession(s);
    if (!own) return fail(said.unavailable, 409);
    // A remembered device opens with an old PIN too: only a PIN the bank took is kept.
    if (!s.pinAccepted) return fail(said.notYet, 409);
    const credential = parseCredential(b.credential);
    const key = parseHelloKey(b.key);
    const secret = parseSecret(b.secret);
    if (!credential || !key || !secret) return fail(said.noKey, 400);
    if ((await sealPin(own, credential, key, secret)) === 'full') return fail(said.tooMany, 409);
    return json({ keys: listKeys(own) });
  }

  const login = readLoginName(b.login);
  if (!login) return fail(said.unknownAction);
  switch (b.op) {
    case 'status':
      return json({ keys: listKeys(login), salt: saltOf(login) });
    case 'open': {
      const credential = parseCredential(b.credential);
      const key = parseHelloKey(b.key);
      const secret = parseSecret(b.secret);
      if (!credential || !key || !secret) return fail(said.noKey, 400);
      const opened = await openPin(login, credential, key, secret);
      if (!opened) return json({ on: false });
      if ('dropped' in opened) return json({ on: false, dropped: true });
      return json({ pin: opened.pin });
    }
    case 'rename': {
      const id = parseKeyId(b.id);
      const name = parseKeyName(b.name);
      if (!id || name === null) return fail(said.unknownAction);
      await renameKey(login, id, name);
      return json({ keys: listKeys(login) });
    }
    case 'forget': {
      if (b.id === undefined) {
        await removeSecurityKeys(login);
        return json({ keys: [] });
      }
      const id = parseKeyId(b.id);
      if (!id) return fail(said.unknownAction);
      await removeKey(login, id);
      return json({ keys: listKeys(login) });
    }
    default:
      return fail(said.unknownAction);
  }
});
