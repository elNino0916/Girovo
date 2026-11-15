// Girovo 7 on the desktop: the profile above all banks (lib/profile.ts).
//
// One POST with an `op`; session ids, logins and passwords in the body,
// never in a URL:
//   status                                   → { exists, name?, hello?, open? }   needs nothing
//   create  {sessionId, linked, banks, name, password, secret}
//                                            → { name, banks }   begins it, opened; takes the 6.x vault over
//   unlock  {password | key, secret}         → { name, banks (with PINs), hello }
//   lock                                     → { open: false }
//   keep    {sessionId, name, accounts?}     → { pin }   the session's bank joins (or stays), its PIN once the bank took it
//   forgetPin {login}  remove {login}  order {logins}   → { banks }   (no PINs)
//   name    {name}                           → { name }
//   password {current, next, secret}         → { ok }
//   hello   {key | null, secret}             → { hello }
//   aside                                    → { exists: false }   "Passwort vergessen": set aside as .bak
//   delete  {password, secret}               → { removed }
//
// `secret` is the shell's DPAPI secret (src-tauri/src/secret.rs) and `key`
// the shell's key after a Windows Hello gesture (src-tauri/src/hello.rs):
// both are mixed into the profile's locks and kept nowhere. A PIN to keep
// comes from the live session, never from the request; the PINs leave only
// with `unlock`, to the page that logs the banks in. Nothing here is logged.
//
// Served only where the desktop app's server keeps PINs at all
// (lib/linked-unlock.ts linkedUnlockServed): 404 anywhere else.

import { boundedBody, fail, json, sessionExpired, wrap } from '@/lib/api';
import { msgs } from '@/lib/i18n';
import { sanitizeLinkedBanks, sameLogin } from '@/lib/linked-banks';
import { linkedUnlockServed, loginOfSession, openLogins, parseSecret, removeLinkedUnlock } from '@/lib/linked-unlock';
import {
  PROFILE_BASE, PROFILE_LIMITS, ProfileError, changePassword, createProfile, deleteProfile, forgetBankPin, keepBank,
  lockProfile, openProfile, orderBanks, profileStatus, removeBank, renameProfile, setHello, setProfileAside, unlockProfile,
  type ProfileBank, type ProfileContent,
} from '@/lib/profile';
import { getSession, type Session } from '@/lib/session';
import { readMeta, removeMeta, syncMetaFile, writeMeta } from '@/lib/sync-meta';
import { removeFamily } from '@/lib/sealed-file';
import { removeSecurityKeys } from '@/lib/security-key';
import { loadVault, removeLegacyVault } from '@/lib/vault';
import { parseHelloKey, readLoginName, removeWindowsHello } from '@/lib/windows-hello';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ProfileBody = {
  op?: string;
  sessionId?: string;
  linked?: unknown;
  banks?: unknown;
  name?: unknown;
  accounts?: unknown;
  password?: unknown;
  current?: unknown;
  next?: unknown;
  key?: unknown;
  secret?: unknown;
  login?: unknown;
  logins?: unknown;
};

const REQUEST_MAX_BYTES = 16 * 1024;

/** The banks without their PINs: what every answer but `unlock` hands back. */
const withoutPins = (banks: ProfileBank[]) => banks.map(({ pin, ...ref }) => ({ ...ref, hasPin: !!pin }));

function refusal(err: unknown) {
  if (!(err instanceof ProfileError)) throw err;
  const said = msgs().profile.server;
  const text = err.code === 'short' ? said.short(PROFILE_LIMITS.passwordMin)
    : err.code === 'full' ? said.full(PROFILE_LIMITS.banks)
      : err.code === 'name' ? said.name
      : said[err.code];
  return fail(text, err.status);
}

/**
 * The banks a new profile begins with: the order and names the page shows,
 * and a PIN for each from where the server holds one. The live sessions'
 * (the first login's only once its bank took it; a further bank's as 6.x's
 * "Weitere Banken mit anmelden" kept it), and for banks not logged in now,
 * what 6.x kept beside the first login (lib/linked-unlock.ts).
 */
async function startingBanks(s: Session, linked: Session[], shown: unknown, secret: Buffer): Promise<ProfileBank[]> {
  const own = loginOfSession(s);
  const pins: { blz: string; userId: string; pin: string }[] = [];
  if (own && s.pinAccepted) {
    pins.push(own);
    const kept = await openLogins(own, secret, { pinAccepted: true }).catch(() => null);
    for (const l of kept?.linked ?? []) pins.push(l);
  }
  for (const l of linked) {
    const login = loginOfSession(l);
    // A live session's PIN beats one kept earlier: it may be newer. Only once
    // its bank took it: a remembered device opens with an old PIN too.
    if (login && l.pinAccepted) pins.unshift(login);
  }
  const refs = Array.isArray(shown) ? shown.flatMap((r) => sanitizeLinkedBanks([r])) : [];
  return refs.map((ref) => {
    const pin = pins.find((p) => sameLogin(p, ref))?.pin;
    return pin ? { ...ref, pin } : ref;
  });
}

export const POST = wrap(async (req: Request) => {
  const said = msgs().profile.server;
  if (!linkedUnlockServed()) return fail(said.unavailable, 404);
  const b = await boundedBody<ProfileBody>(req, REQUEST_MAX_BYTES);
  if (!b) return fail(said.unknown, 413);

  try {
    switch (b.op) {
      case 'status':
        return json(await profileStatus());

      case 'create': {
        const s = getSession(b.sessionId ?? '');
        if (!s) return sessionExpired();
        const secret = parseSecret(b.secret);
        if (!secret) return fail(said.noKey, 400);
        const linked = (Array.isArray(b.linked) ? b.linked : []).map((id) => getSession(id)).filter((x): x is Session => !!x);
        // The 6.x vault of the first login, read with its PIN while no profile
        // is open yet: what it holds moves into the profile. Unreadable, the
        // profile begins empty and the old file stays as it is.
        const old = await loadVault(s).catch(() => null);
        const vault = old?.status === 'ready' ? old.data : null;
        // Its sync settings too, sealed with the old key: read now, written
        // under the profile's once it is open, so this device stays in its group.
        const meta = await readMeta(s).catch(() => null);
        const banks = await startingBanks(s, linked, b.banks, secret);
        const made: ProfileContent = await createProfile({ name: b.name, password: b.password, secret, banks, vault });
        if (meta) await writeMeta(s, meta).catch(() => { /* the device joins its group again */ });
        return json({ name: made.name, banks: withoutPins(made.banks) });
      }

      case 'unlock': {
        const secret = parseSecret(b.secret);
        if (!secret) return fail(said.noKey, 400);
        const helloKey = b.key === undefined ? null : parseHelloKey(b.key);
        if (b.key !== undefined && !helloKey) return fail(said.noKey, 400);
        const opened = await unlockProfile(helloKey ? { helloKey } : { password: typeof b.password === 'string' ? b.password : '' }, secret);
        const status = await profileStatus();
        return json({ name: opened.name, banks: opened.banks, hello: status.exists && status.hello });
      }

      case 'lock':
        lockProfile();
        return json({ open: false });

      case 'keep': {
        const s = getSession(b.sessionId ?? '');
        if (!s) return sessionExpired();
        const login = loginOfSession(s);
        if (!login) return fail(said.locked, 409);
        const [ref] = sanitizeLinkedBanks([{ blz: login.blz, userId: login.userId, name: b.name, accounts: b.accounts }]);
        if (!ref) return fail(said.unknown, 400);
        // A remembered device opens on this computer with an old PIN too: only a PIN the bank took is kept.
        const banks = await keepBank(s.pinAccepted ? { ...ref, pin: login.pin } : ref);
        return json({ pin: !!s.pinAccepted, banks: withoutPins(banks) });
      }

      case 'forgetPin':
      case 'remove': {
        const login = readLoginName(b.login);
        if (!login) return fail(said.unknown, 400);
        const banks = b.op === 'remove' ? await removeBank(login) : await forgetBankPin(login);
        return json({ banks: withoutPins(banks) });
      }

      case 'order': {
        const logins = (Array.isArray(b.logins) ? b.logins : []).map(readLoginName).filter((l): l is NonNullable<typeof l> => !!l);
        return json({ banks: withoutPins(await orderBanks(logins)) });
      }

      case 'name':
        return json({ name: await renameProfile(b.name) });

      case 'password': {
        const secret = parseSecret(b.secret);
        if (!secret) return fail(said.noKey, 400);
        await changePassword(b.current, b.next, secret);
        return json({ ok: true });
      }

      case 'hello': {
        const secret = parseSecret(b.secret);
        if (!secret) return fail(said.noKey, 400);
        const helloKey = b.key === null ? null : parseHelloKey(b.key);
        if (b.key !== null && !helloKey) return fail(said.noKey, 400);
        return json({ hello: await setHello(helloKey, secret) });
      }

      case 'aside':
        await setProfileAside();
        return json({ exists: false });

      case 'delete': {
        const secret = parseSecret(b.secret);
        if (!secret) return fail(said.noKey, 400);
        const banks = openProfile()?.banks ?? [];
        const removed = await deleteProfile(b.password, secret);
        // What sync kept beside it goes with it: it opened only with the profile's key.
        const meta = syncMetaFile(PROFILE_BASE);
        await removeFamily(path.dirname(meta), path.basename(meta), () => {}).catch(() => {});
        // And what 6.x kept for each of its banks: the old vault the profile
        // was made from, the PINs beside it, its sync settings. Left behind,
        // the next bank login would bring the deleted data back.
        for (const bank of banks) {
          const login = { blz: bank.blz, userId: bank.userId };
          await Promise.allSettled([
            removeLegacyVault(login.blz, login.userId), removeLinkedUnlock(login), removeWindowsHello(login),
            removeSecurityKeys(login), removeMeta(login.blz, login.userId),
          ]);
        }
        return json({ removed });
      }

      default:
        return fail(said.unknown);
    }
  } catch (err) {
    return refusal(err);
  }
});
