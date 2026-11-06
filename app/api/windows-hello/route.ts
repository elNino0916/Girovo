// Windows Hello in place of typing the first login's PIN on the desktop
// (lib/windows-hello.ts): the login's PIN kept under a key from a Windows
// Hello gesture and the shell's DPAPI secret.
//
// One POST with an `op`; a login and session ids in the body, never in a URL:
//   status {login}                    → { on }        whether the login opens with Windows Hello
//   seal   {sessionId, key, secret}   → { on: true }  keeps this session's PIN — only once the bank took it
//   open   {login, key, secret}       → { pin } | { on: false, dropped? }
//   forget {login}                    → { on: false }
// `key` comes from the shell after the gesture (src-tauri/src/hello.rs),
// `secret` from src-tauri/src/secret.rs; both are mixed into the key and
// kept nowhere. The PIN to keep comes from the live session, never from the
// request. Nothing here is logged.
//
// Served only where the desktop app's server keeps PINs at all
// (lib/linked-unlock.ts linkedUnlockServed): 404 anywhere else.

import { boundedBody, fail, json, sessionExpired, wrap } from '@/lib/api';
import { msgs } from '@/lib/i18n';
import { linkedUnlockServed, loginOfSession, parseSecret } from '@/lib/linked-unlock';
import { getSession } from '@/lib/session';
import { isOn, openPin, parseHelloKey, readLoginName, removeWindowsHello, sealPin } from '@/lib/windows-hello';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type WindowsHelloBody = {
  op?: 'status' | 'seal' | 'open' | 'forget';
  sessionId?: string;
  login?: unknown;
  key?: string;
  secret?: string;
};

const REQUEST_MAX_BYTES = 4 * 1024;

export const POST = wrap(async (req: Request) => {
  const said = msgs().provider.windowsHello;
  if (!linkedUnlockServed()) return fail(said.unavailable, 404);
  const b = await boundedBody<WindowsHelloBody>(req, REQUEST_MAX_BYTES);
  if (!b) return fail(said.unknownAction, 413);

  if (b.op === 'seal') {
    const s = getSession(b.sessionId ?? '');
    if (!s) return sessionExpired();
    const own = loginOfSession(s);
    if (!own) return fail(said.unavailable, 409);
    // A remembered device opens with an old PIN too: only a PIN the bank took is kept.
    if (!s.pinAccepted) return fail(said.notYet, 409);
    const key = parseHelloKey(b.key);
    const secret = parseSecret(b.secret);
    if (!key || !secret) return fail(said.noKey, 400);
    await sealPin(own, key, secret);
    return json({ on: true });
  }

  const login = readLoginName(b.login);
  if (!login) return fail(said.unknownAction);
  switch (b.op) {
    case 'status':
      return json({ on: isOn(login) });
    case 'open': {
      const key = parseHelloKey(b.key);
      const secret = parseSecret(b.secret);
      if (!key || !secret) return fail(said.noKey, 400);
      const opened = await openPin(login, key, secret);
      if (!opened) return json({ on: false });
      if ('dropped' in opened) return json({ on: false, dropped: true });
      return json({ pin: opened.pin });
    }
    case 'forget':
      await removeWindowsHello(login);
      return json({ on: false });
    default:
      return fail(said.unknownAction);
  }
});
