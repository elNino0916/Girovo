// "Weitere Banken mit anmelden" on the desktop: logging in to the bank the
// app opens with logs the further banks in too, as a fingerprint does on
// Android (mobile/bridges/biometric.ts). Their PINs are kept beside that
// first login, in one sealed file per login:
//
// - The key takes two things. The first login's PIN — the one typed to log
//   in — and a secret of this computer's user account that the desktop shell
//   keeps under the system's own protection (Electron's safeStorage: DPAPI on
//   Windows, the keyring on Linux; electron/linked-unlock.cjs). The page hands
//   that secret along with each request and nobody keeps it here, so a copy
//   of the file opens with neither a guessed PIN nor the secret alone.
// - The PINs are taken from the live sessions (lib/session.ts), where the
//   route handlers keep them, and leave here only when the first login opens
//   them, for the page to log the further banks in.
// - The page asks for them only once the bank has taken the first login's
//   PIN in this session (FintsProvider openLinkedUnlock): a remembered device
//   opens on this computer alone, with an old PIN too.
// - A file the first login's PIN no longer opens (the PIN was changed at the
//   bank, the secret is new) is deleted: nothing in it can be used again.
//
// Named by a hash of BLZ and login name like the vault, so the directory says
// nothing about whose it is. Never in a backup, never logged. No
// 'server-only' marker, like vault.ts: node:fs keeps it out of the client and
// `node --test` exercises the real file round trip (lib/linked-unlock.test.ts).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { boxSalt, deriveKey, newSalt, openBox, parseBox, sealBox } from './crypto-box.ts';
import { LINKED_BANK_LIMITS, sameLogin } from './linked-banks.ts';
import { IS_ANDROID } from './platform.ts';
import { removeFamily, serialized, writeFileAtomic } from './sealed-file.ts';
import { STATE_DIR } from './state-store.ts';

/** A login with its PIN: the first one, or a further bank kept beside it. */
export type SealedLogin = { blz: string; userId: string; pin: string };

/**
 * What opening answers: the further banks' logins with their PINs, whether it
 * is on at all — and `dropped` when a file was there that no longer opened.
 */
export type OpenedLogins = { on: boolean; linked: SealedLogin[]; dropped?: true };

/** The shell's secret: 32 random bytes, base64 on the way. */
export const SECRET_BYTES = 32;

/** FinTS PINs are short; anything far longer is not one. */
const PIN_MAX = 64;
/** Eight logins with their PINs are well under a kilobyte. */
const FILE_MAX_BYTES = 16 * 1024;
/** Kept apart from every other key derived from a PIN (lib/crypto-box.ts AADs). */
const DOMAIN = 'girovo/linked-unlock/v1';

const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/**
 * Whether this server keeps further banks' PINs at all: the desktop app's
 * own server (the shell starts it with GIROVO_DESKTOP=1) and the development
 * server electron:dev opens. Never the phone, which keeps them behind the
 * fingerprint, and never a server that other people use.
 */
export function linkedUnlockServed(): boolean {
  return !IS_ANDROID && (process.env.GIROVO_DESKTOP === '1' || process.env.NODE_ENV === 'development');
}

/** The shell's secret from a request: exactly SECRET_BYTES in base64, else null. */
export function parseSecret(value: unknown): Buffer | null {
  if (typeof value !== 'string' || value.length > 64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const secret = Buffer.from(value, 'base64');
  return secret.length === SECRET_BYTES ? secret : null;
}

/** A login as this store takes it: a BLZ of eight digits, a login name on one line, a PIN. */
function readLogin(v: unknown): SealedLogin | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const blz = typeof r.blz === 'string' ? r.blz : '';
  const userId = typeof r.userId === 'string' ? r.userId : '';
  const pin = typeof r.pin === 'string' ? r.pin : '';
  if (!/^\d{8}$/.test(blz) || !userId || userId.length > LINKED_BANK_LIMITS.userId || CONTROLS.test(userId)) return null;
  if (!pin || pin.length > PIN_MAX || CONTROLS.test(pin)) return null;
  return { blz, userId, pin };
}

/** The further banks as kept: each login once, never the first login itself, at most LINKED_BANK_LIMITS.count. */
export function sanitizeLogins(v: unknown, first: Pick<SealedLogin, 'blz' | 'userId'>): SealedLogin[] {
  const out: SealedLogin[] = [];
  for (const raw of Array.isArray(v) ? v : []) {
    const login = readLogin(raw);
    if (!login || sameLogin(login, first) || out.some((l) => sameLogin(l, login))) continue;
    out.push(login);
    if (out.length === LINKED_BANK_LIMITS.count) break;
  }
  return out;
}

/** The login a live session belongs to, with its PIN (held by lib-fints' config, in memory only). */
export function loginOfSession(s: { meta?: { blz?: unknown }; client?: { config?: { userId?: unknown; pin?: unknown } } } | null | undefined): SealedLogin | null {
  return readLogin({ blz: s?.meta?.blz, userId: s?.client?.config?.userId, pin: s?.client?.config?.pin });
}

function baseName(blz: string, userId: string): string {
  return crypto.createHash('sha256').update(`${blz}|${userId}|linked-unlock`).digest('hex').slice(0, 32);
}

/** The file that keeps the further banks of the login (blz, userId). */
export function linkedUnlockFile(blz: string, userId: string): string {
  return path.join(STATE_DIR, `${baseName(blz, userId)}.linked`);
}

/** The key: the first login's PIN (scrypt, the file's salt) and the shell's secret, together. */
async function keyFor(first: SealedLogin, salt: Buffer, secret: Buffer): Promise<Buffer> {
  const fromPin = await deriveKey(first.pin, salt);
  return crypto.createHash('sha256').update(DOMAIN).update(secret).update(fromPin).digest();
}

/** Binds the box to its login, so one login's file cannot be passed off as another's. */
const aadFor = (first: SealedLogin) => Buffer.from(`${DOMAIN}|${baseName(first.blz, first.userId)}`, 'utf8');

/** Whether the login keeps further banks' PINs — the switch's state; needs no key. */
export function isOn(first: Pick<SealedLogin, 'blz' | 'userId'>): boolean {
  try {
    return fs.existsSync(linkedUnlockFile(first.blz, first.userId));
  } catch {
    return false;
  }
}

/**
 * The file's logins opened with this login's PIN and the secret: null when
 * there is no file, 'stale' when it does not open (or is not one of ours).
 */
async function readLogins(first: SealedLogin, secret: Buffer, file: string): Promise<{ salt: Buffer; logins: SealedLogin[] } | null | 'stale'> {
  let raw: string;
  try {
    const stat = await fs.promises.stat(file);
    if (stat.size > FILE_MAX_BYTES) return 'stale';
    raw = await fs.promises.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw err;
  }
  let box;
  try {
    box = parseBox(JSON.parse(raw));
  } catch {
    box = null;
  }
  if (!box) return 'stale';
  const salt = boxSalt(box);
  try {
    const plain = openBox(await keyFor(first, salt, secret), box, aadFor(first));
    return { salt, logins: sanitizeLogins(JSON.parse(plain.toString('utf8')), first) };
  } catch {
    return 'stale';
  }
}

/**
 * The file and every copy beside it — a temp file a write cut short leaves
 * behind opens with the same PIN and secret. Throws when one stays.
 */
async function removeAll(file: string): Promise<void> {
  const { failed } = await removeFamily(path.dirname(file), path.basename(file), (code) => {
    console.warn('[linked-unlock] could not delete a file:', code);
  });
  if (failed) throw new Error(`linked-unlock: ${failed} file(s) left`);
}

async function writeLogins(first: SealedLogin, secret: Buffer, file: string, salt: Buffer, logins: SealedLogin[]): Promise<void> {
  const plain = Buffer.from(JSON.stringify(sanitizeLogins(logins, first)), 'utf8');
  await writeFileAtomic(file, JSON.stringify(sealBox(await keyFor(first, salt, secret), salt, plain, aadFor(first))));
}

/**
 * Keeps `add` beside the first login — each replacing what was kept for the
 * same login — and turns the switch on (an empty `add` only does that).
 * A file that no longer opens starts over. Returns how many are kept.
 */
export function sealLogins(first: SealedLogin, secret: Buffer, add: readonly SealedLogin[]): Promise<number> {
  const file = linkedUnlockFile(first.blz, first.userId);
  return serialized(file, async () => {
    const found = await readLogins(first, secret, file);
    const kept = found && found !== 'stale' ? found.logins : [];
    const fresh = sanitizeLogins(add, first);
    // The newest first, so a full list drops the oldest further bank, never the one just added.
    const logins = sanitizeLogins([...fresh, ...kept.filter((l) => !fresh.some((n) => sameLogin(n, l)))], first);
    await writeLogins(first, secret, file, found && found !== 'stale' ? found.salt : newSalt(), logins);
    return logins.length;
  });
}

/** The further banks' logins with their PINs, opened by the first login's PIN and the secret. */
export function openLogins(first: SealedLogin, secret: Buffer): Promise<OpenedLogins> {
  const file = linkedUnlockFile(first.blz, first.userId);
  return serialized(file, async () => {
    const found = await readLogins(first, secret, file);
    if (!found) return { on: false, linked: [] };
    if (found === 'stale') {
      await removeAll(file);
      return { on: false, linked: [], dropped: true };
    }
    return { on: true, linked: found.logins };
  });
}

/** Deletes one further bank's PIN (refused by its bank, or the bank removed); the switch stays as it is. */
export function forgetLogin(first: SealedLogin, secret: Buffer, login: Pick<SealedLogin, 'blz' | 'userId'>): Promise<{ on: boolean }> {
  const file = linkedUnlockFile(first.blz, first.userId);
  return serialized(file, async () => {
    const found = await readLogins(first, secret, file);
    if (!found) return { on: false };
    if (found === 'stale') {
      await removeAll(file);
      return { on: false };
    }
    if (found.logins.some((l) => sameLogin(l, login))) {
      await writeLogins(first, secret, file, found.salt, found.logins.filter((l) => !sameLogin(l, login)));
    }
    return { on: true };
  });
}

/** Turns it off for the login: every further bank's PIN kept beside it goes, copies included. Needs no key. */
export function removeLinkedUnlock(first: Pick<SealedLogin, 'blz' | 'userId'>): Promise<void> {
  const file = linkedUnlockFile(first.blz, first.userId);
  return serialized(file, () => removeAll(file));
}
