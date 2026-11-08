// A security key (FIDO2: a YubiKey, say) in place of typing the first login's
// PIN on the desktop, beside Windows Hello (lib/windows-hello.ts). One sealed
// file per login and key, so a second key is a spare and losing one costs
// nothing but typing the PIN:
//
// - The key takes two things: what the security key answers after its own PIN
//   or touch (src-tauri/src/security_key.rs) and the shell's DPAPI secret
//   (src-tauri/src/secret.rs). The page hands both along with the request and
//   nobody keeps them here, so a copy of the file opens with neither alone.
// - Beside the box: the credential's id, which is not secret. The form names
//   it to Windows, which asks the key that holds it.
// - The PIN is taken from the live session, and only once the bank has taken
//   it (Session.pinAccepted), as for Windows Hello.
// - A file its key no longer opens is deleted: that key was reset, and nothing
//   in it can be used again. The other keys' files stay.
// - A PIN the bank turns down is deleted by the page at once, all keys' copies
//   of it, so it is never tried a second time.
//
// Named by a hash of BLZ and login name like the vault. Never in a backup,
// never logged. `node --test` runs the real file round trip
// (lib/security-key.test.ts).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { boxSalt, newSalt, openBox, parseBox, sealBox } from './crypto-box.ts';
import { sameLogin } from './linked-banks.ts';
import type { SealedLogin } from './linked-unlock.ts';
import { removeFamily, serialized, writeFileAtomic } from './sealed-file.ts';
import { STATE_DIR } from './state-store.ts';

type LoginName = Pick<SealedLogin, 'blz' | 'userId'>;

/** How many keys one login can have: the key and spares. */
export const KEYS_MAX = 5;

/** One login with its PIN and a credential id is well under this. */
const FILE_MAX_BYTES = 8 * 1024;
const PIN_MAX = 64;
const CREDENTIAL_MAX_CHARS = 1400;
/** A name like "YubiKey am Schlüsselbund". */
export const KEY_NAME_MAX = 40;
const SUFFIX = '.skey';
/** Kept apart from every other key (lib/windows-hello.ts, lib/linked-unlock.ts, lib/crypto-box.ts AADs). */
const DOMAIN = 'girovo/security-key/v1';

const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/** One key of a login, as the settings and the login form know it. */
export type SecurityKeyEntry = { id: string; credential: string; added: string; name?: string };

/** A credential id from a request: base64 of a sensible length, else null. */
export function parseCredential(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > CREDENTIAL_MAX_CHARS || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  return value;
}

/** A key id from a request: what keyIdOf makes. */
export function parseKeyId(value: unknown): string | null {
  return typeof value === 'string' && /^[0-9a-f]{16}$/.test(value) ? value : null;
}

/** A name the user gives a key: on one line, trimmed; '' for none, null when it can't be one. */
export function parseKeyName(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > KEY_NAME_MAX * 2 || CONTROLS.test(value)) return null;
  return value.trim().slice(0, KEY_NAME_MAX);
}

/** The short name a credential goes by here: its file's, and the page's. */
export function keyIdOf(credential: string): string {
  return crypto.createHash('sha256').update(credential).digest('hex').slice(0, 16);
}

function baseName(login: LoginName): string {
  return crypto.createHash('sha256').update(`${login.blz}|${login.userId}|security-key`).digest('hex').slice(0, 32);
}

const fileOf = (login: LoginName, id: string) => path.join(STATE_DIR, `${baseName(login)}.${id}${SUFFIX}`);

/**
 * The salt for this login. hmac-secret takes its strength from a secret that
 * stays on the key, so this one only has to be the login's own, and the same
 * each time: nothing to keep.
 */
export function saltOf(login: LoginName): string {
  return crypto.createHash('sha256').update(`${DOMAIN}|salt|${login.blz}|${login.userId}`).digest('base64');
}

/** Both keys together, with the box's salt: neither opens it alone. */
const keyFor = (salt: Buffer, securityKey: Buffer, secret: Buffer): Buffer =>
  crypto.createHash('sha256').update(DOMAIN).update(salt).update(secret).update(securityKey).digest();

/** Binds the box to its login and key, so one file cannot be passed off as another's. */
const aadFor = (login: LoginName, id: string) => Buffer.from(`${DOMAIN}|${baseName(login)}|${id}`, 'utf8');

/** One operation per login at a time. */
const lane = (login: LoginName) => path.join(STATE_DIR, `${baseName(login)}.lane`);

function readEntry(file: string): (SecurityKeyEntry & { box: unknown }) | null {
  try {
    if (fs.statSync(file).size > FILE_MAX_BYTES) return null;
    const kept = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    const credential = parseCredential(kept.credential);
    if (kept.v !== 1 || !credential || typeof kept.added !== 'string') return null;
    const name = typeof kept.name === 'string' && kept.name ? kept.name.slice(0, KEY_NAME_MAX) : undefined;
    return { id: keyIdOf(credential), credential, added: kept.added, box: kept.box, ...(name ? { name } : {}) };
  } catch {
    return null;
  }
}

function entries(login: LoginName): Array<SecurityKeyEntry & { box: unknown }> {
  const stem = `${baseName(login)}.`;
  let names: string[];
  try {
    names = fs.readdirSync(STATE_DIR);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.startsWith(stem) && n.endsWith(SUFFIX))
    .map((n) => readEntry(path.join(STATE_DIR, n)))
    .filter((e) => !!e)
    .sort((a, b) => (a.added < b.added ? -1 : a.added > b.added ? 1 : 0));
}

/** The login's keys, the oldest first — the settings' list, the login form's button. Needs no key. */
export function listKeys(login: LoginName): SecurityKeyEntry[] {
  return entries(login).map(({ id, credential, added, name }) => ({ id, credential, added, ...(name ? { name } : {}) }));
}

async function removeStem(stem: string): Promise<void> {
  const { failed } = await removeFamily(STATE_DIR, stem, (code) => {
    console.warn('[security-key] could not delete a file:', code);
  });
  if (failed) throw new Error(`security-key: ${failed} file(s) left`);
}

/** Keeps the login's PIN under this key. 'full' with KEYS_MAX other keys already. */
export function sealPin(login: SealedLogin, credential: string, securityKey: Buffer, secret: Buffer): Promise<'sealed' | 'full'> {
  if (!login.pin || login.pin.length > PIN_MAX || CONTROLS.test(login.pin)) {
    return Promise.reject(new Error('security-key: not a PIN'));
  }
  return serialized(lane(login), async () => {
    const id = keyIdOf(credential);
    if (entries(login).filter((e) => e.id !== id).length >= KEYS_MAX) return 'full';
    const salt = newSalt();
    const plain = Buffer.from(JSON.stringify({ blz: login.blz, userId: login.userId, pin: login.pin }), 'utf8');
    const box = sealBox(keyFor(salt, securityKey, secret), salt, plain, aadFor(login, id));
    await writeFileAtomic(fileOf(login, id), JSON.stringify({ v: 1, credential, added: new Date().toISOString(), box }));
    return 'sealed';
  });
}

/**
 * The login's PIN, opened with this key and the shell's secret: null when
 * this key has no file, `{ dropped: true }` when it did not open (and is gone now).
 */
export function openPin(
  login: LoginName, credential: string, securityKey: Buffer, secret: Buffer,
): Promise<{ pin: string } | { dropped: true } | null> {
  return serialized(lane(login), async () => {
    const id = keyIdOf(credential);
    const file = fileOf(login, id);
    if (!fs.existsSync(file)) return null;
    try {
      const entry = readEntry(file);
      const box = entry ? parseBox(entry.box) : null;
      if (!box) throw new Error('not a box');
      const plain = openBox(keyFor(boxSalt(box), securityKey, secret), box, aadFor(login, id));
      const kept = JSON.parse(plain.toString('utf8')) as Partial<SealedLogin>;
      if (!sameLogin({ blz: String(kept.blz), userId: String(kept.userId) }, login)) throw new Error('another login');
      const pin = typeof kept.pin === 'string' ? kept.pin : '';
      if (!pin || pin.length > PIN_MAX || CONTROLS.test(pin)) throw new Error('not a PIN');
      return { pin };
    } catch {
      await removeStem(path.basename(file));
      return { dropped: true as const };
    }
  });
}

/** Gives a key its name, '' taking it away. What the key opens stays as it is. */
export function renameKey(login: LoginName, id: string, name: string): Promise<void> {
  return serialized(lane(login), async () => {
    const file = fileOf(login, id);
    if (!readEntry(file)) return;
    const { name: _old, ...kept } = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    await writeFileAtomic(file, JSON.stringify(name ? { ...kept, name } : kept));
  });
}

/** One key goes. Made unopenable first, so a file the system will not let go of can never hand out that PIN again. */
export function removeKey(login: LoginName, id: string): Promise<void> {
  return serialized(lane(login), async () => {
    const file = fileOf(login, id);
    if (fs.existsSync(file)) await writeFileAtomic(file, '{}').catch(() => {});
    await removeStem(path.basename(file));
  });
}

/** Every key of the login goes: off, a refused PIN, a forgotten device. Needs no key. */
export function removeSecurityKeys(login: LoginName): Promise<void> {
  return serialized(lane(login), async () => {
    for (const e of entries(login)) await writeFileAtomic(fileOf(login, e.id), '{}').catch(() => {});
    await removeStem(baseName(login));
  });
}
