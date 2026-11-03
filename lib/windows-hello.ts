// Windows Hello in place of typing the first login's PIN on the desktop: the
// counterpart of Android's fingerprint login (mobile/bridges/biometric.ts).
// The login's PIN is kept in one sealed file per login:
//
// - The key takes two things. The key the desktop shell derives from a
//   Windows Hello signature (electron/windows-hello.cjs), which only the
//   face, the fingerprint or the Windows Hello PIN brings about, and the
//   shell's DPAPI secret (electron/linked-unlock.cjs). The page hands both
//   along with the request and nobody keeps them here, so a copy of the file
//   opens with neither alone.
// - The PIN is taken from the live session (lib/session.ts), and only once
//   the bank has taken it (Session.pinAccepted): a remembered device opens on
//   this computer with an old PIN too, and that one is never kept.
// - A file the key no longer opens is deleted: the Windows Hello key was
//   replaced, and nothing in it can be used again.
// - A PIN the bank turns down is deleted by the page at once (Credentials,
//   FintsProvider's PIN_REFUSED_EVENT), so it is never tried a second time.
//
// Further banks follow as before: the first login's PIN opens their PINs
// (lib/linked-unlock.ts), whether it was typed or opened here.
//
// Named by a hash of BLZ and login name like the vault. Never in a backup,
// never logged. `node --test` runs the real file round trip
// (lib/windows-hello.test.ts).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { boxSalt, newSalt, openBox, parseBox, sealBox } from './crypto-box.ts';
import { sameLogin } from './linked-banks.ts';
import type { SealedLogin } from './linked-unlock.ts';
import { removeFamily, serialized, writeFileAtomic } from './sealed-file.ts';
import { STATE_DIR } from './state-store.ts';

/** The shell's key from a Windows Hello signature: a SHA-256, base64 on the way. */
export const HELLO_KEY_BYTES = 32;

/** One login with its PIN is a few hundred bytes. */
const FILE_MAX_BYTES = 4 * 1024;
const PIN_MAX = 64;
/** Kept apart from every other key (lib/linked-unlock.ts, lib/crypto-box.ts AADs). */
const DOMAIN = 'girovo/windows-hello/v1';

const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/** The shell's key from a request: exactly HELLO_KEY_BYTES in base64, else null. */
export function parseHelloKey(value: unknown): Buffer | null {
  if (typeof value !== 'string' || value.length > 64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const key = Buffer.from(value, 'base64');
  return key.length === HELLO_KEY_BYTES ? key : null;
}

/** A login as a request names it: a BLZ of eight digits and a login name on one line. */
export function readLoginName(v: unknown): Pick<SealedLogin, 'blz' | 'userId'> | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const blz = typeof r.blz === 'string' ? r.blz : '';
  const userId = typeof r.userId === 'string' ? r.userId : '';
  if (!/^\d{8}$/.test(blz) || !userId || userId.length > 64 || CONTROLS.test(userId)) return null;
  return { blz, userId };
}

function baseName(blz: string, userId: string): string {
  return crypto.createHash('sha256').update(`${blz}|${userId}|windows-hello`).digest('hex').slice(0, 32);
}

/** The file that keeps the PIN of the login (blz, userId). */
export function windowsHelloFile(blz: string, userId: string): string {
  return path.join(STATE_DIR, `${baseName(blz, userId)}.hello`);
}

/** Both keys together, with the file's salt: neither opens it alone. */
const keyFor = (salt: Buffer, helloKey: Buffer, secret: Buffer): Buffer =>
  crypto.createHash('sha256').update(DOMAIN).update(salt).update(secret).update(helloKey).digest();

/** Binds the box to its login, so one login's file cannot be passed off as another's. */
const aadFor = (login: Pick<SealedLogin, 'blz' | 'userId'>) =>
  Buffer.from(`${DOMAIN}|${baseName(login.blz, login.userId)}`, 'utf8');

/** Whether the login opens with Windows Hello — the switch's state, the login form's button; needs no key. */
export function isOn(login: Pick<SealedLogin, 'blz' | 'userId'>): boolean {
  try {
    return fs.existsSync(windowsHelloFile(login.blz, login.userId));
  } catch {
    return false;
  }
}

async function removeAll(file: string): Promise<void> {
  const { failed } = await removeFamily(path.dirname(file), path.basename(file), (code) => {
    console.warn('[windows-hello] could not delete a file:', code);
  });
  if (failed) throw new Error(`windows-hello: ${failed} file(s) left`);
}

/** Keeps the login's PIN under both keys, replacing what was kept for it. */
export function sealPin(login: SealedLogin, helloKey: Buffer, secret: Buffer): Promise<void> {
  if (!login.pin || login.pin.length > PIN_MAX || CONTROLS.test(login.pin)) {
    return Promise.reject(new Error('windows-hello: not a PIN'));
  }
  const file = windowsHelloFile(login.blz, login.userId);
  return serialized(file, async () => {
    const salt = newSalt();
    const plain = Buffer.from(JSON.stringify({ blz: login.blz, userId: login.userId, pin: login.pin }), 'utf8');
    await writeFileAtomic(file, JSON.stringify(sealBox(keyFor(salt, helloKey, secret), salt, plain, aadFor(login))));
  });
}

/**
 * The login's PIN, opened with both keys: null when there is no file,
 * `{ dropped: true }` when it did not open (and is gone now).
 */
export function openPin(
  login: Pick<SealedLogin, 'blz' | 'userId'>, helloKey: Buffer, secret: Buffer,
): Promise<{ pin: string } | { dropped: true } | null> {
  const file = windowsHelloFile(login.blz, login.userId);
  return serialized(file, async () => {
    let raw: string;
    try {
      const stat = await fs.promises.stat(file);
      if (stat.size > FILE_MAX_BYTES) throw Object.assign(new Error('too big'), { code: 'EFBIG' });
      raw = await fs.promises.readFile(file, 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') return null;
      if (code !== 'EFBIG') throw err;
      raw = '';
    }
    try {
      const box = parseBox(JSON.parse(raw));
      if (!box) throw new Error('not a box');
      const plain = openBox(keyFor(boxSalt(box), helloKey, secret), box, aadFor(login));
      const kept = JSON.parse(plain.toString('utf8')) as Partial<SealedLogin>;
      if (!sameLogin({ blz: String(kept.blz), userId: String(kept.userId) }, login)) throw new Error('another login');
      const pin = typeof kept.pin === 'string' ? kept.pin : '';
      if (!pin || pin.length > PIN_MAX || CONTROLS.test(pin)) throw new Error('not a PIN');
      return { pin };
    } catch {
      await removeAll(file);
      return { dropped: true as const };
    }
  });
}

/** Turns it off for the login: its kept PIN goes, copies included. Needs no key. */
export function removeWindowsHello(login: Pick<SealedLogin, 'blz' | 'userId'>): Promise<void> {
  const file = windowsHelloFile(login.blz, login.userId);
  return serialized(file, () => removeAll(file));
}
