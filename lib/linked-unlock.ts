// "Weitere Banken mit anmelden" on the desktop: logging in to the bank the
// app opens with logs the further banks in too, as a fingerprint does on
// Android (mobile/bridges/biometric.ts). Their PINs are kept beside that
// first login, in one sealed file per login:
//
// - The key takes two things. The first login's PIN — the one typed to log
//   in — and a secret of this computer's user account that the desktop shell
//   keeps under the system's own protection (Electron's safeStorage: DPAPI on
//   Windows, the keyring on Linux; src-tauri/src/secret.rs). The page hands
//   that secret along with each request and nobody keeps it here, so a copy
//   of the file opens with neither a guessed PIN nor the secret alone.
// - The PINs are taken from the live sessions (lib/session.ts), where the
//   route handlers keep them, and leave here only when the first login opens
//   them, for the page to log the further banks in.
// - The page asks for them only once the bank has taken the first login's
//   PIN in this session (FintsProvider openLinkedUnlock): a remembered device
//   opens on this computer alone, with an old PIN too.
// - A file that is not one of ours (damaged, cut short) is deleted. One that
//   does not open with the first login's PIN is deleted only once the bank
//   has taken that PIN in this session (Session.pinAccepted): then it was
//   sealed under an old PIN or an old secret, and nothing in it can be used
//   again. Before that the PIN may simply be wrong — a typo, a remembered
//   device opened with an old one — and the file stays as it is: losing it
//   would mean typing every further bank's PIN again.
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

/**
 * What the caller knows of the first login's PIN: `pinAccepted` once the bank
 * has taken it in this session (Session.pinAccepted). Only then is a file it
 * does not open known to be of no use.
 */
export type PinState = { pinAccepted: boolean };

/**
 * Sealing refused: the file is there and does not open with this PIN, and the
 * bank has not taken this PIN yet — it may be the wrong one, so the file and
 * every PIN in it stay as they are.
 */
export class LinkedUnlockLocked extends Error {
  constructor() {
    super('linked-unlock: the file does not open with a PIN the bank has not taken yet');
    this.name = 'LinkedUnlockLocked';
  }
}

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
 * route handlers (desktop/env.ts sets GIROVO_DESKTOP=1) and the development
 * server, `npm run dev`. Never the phone, which keeps them behind the
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
 * What reading the file came to: its salt and logins when it opened; null
 * when there is none; 'corrupt' when it is not a box of ours at all (damaged,
 * cut short, too large) and never will open; 'locked' when it is one but does
 * not open with this PIN and secret.
 */
type Read = { salt: Buffer; logins: SealedLogin[] } | null | 'corrupt' | 'locked';

/**
 * The file's logins opened with this login's PIN and the secret. A read that
 * fails for any other reason than a missing file throws: it may pass, and the
 * file must not be taken for unusable on its account.
 */
async function readLogins(first: SealedLogin, secret: Buffer, file: string): Promise<Read> {
  let raw: string;
  try {
    const stat = await fs.promises.stat(file);
    if (stat.size > FILE_MAX_BYTES) return 'corrupt';
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
  if (!box) return 'corrupt';
  const salt = boxSalt(box);
  let plain: Buffer;
  try {
    plain = openBox(await keyFor(first, salt, secret), box, aadFor(first));
  } catch {
    return 'locked'; // another PIN, another secret — or a wrong PIN
  }
  try {
    return { salt, logins: sanitizeLogins(JSON.parse(plain.toString('utf8')), first) };
  } catch {
    return 'corrupt';
  }
}

/**
 * Whether a file that did not open can go: one that is not ours, always; one
 * this PIN does not open, only once the bank has taken the PIN. Before that
 * the PIN may be wrong, and the file holds every further bank's PIN.
 */
const unusable = (found: 'corrupt' | 'locked', pin: PinState) => found === 'corrupt' || pin.pinAccepted === true;

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
 * Keeps `add` beside the first login (each replacing what was kept for the
 * same login) and turns the switch on (an empty `add` only does that).
 * A file that can never open again (unusable) starts over; one this PIN does
 * not open while the bank has not taken it is kept, and the seal refused
 * (LinkedUnlockLocked). Returns how many are kept.
 */
export function sealLogins(first: SealedLogin, secret: Buffer, add: readonly SealedLogin[], pin: PinState): Promise<number> {
  const file = linkedUnlockFile(first.blz, first.userId);
  return serialized(file, async () => {
    const found = await readLogins(first, secret, file);
    if (typeof found === 'string' && !unusable(found, pin)) throw new LinkedUnlockLocked();
    const opened = found && typeof found === 'object' ? found : null;
    const kept = opened ? opened.logins : [];
    const fresh = sanitizeLogins(add, first);
    // The newest first, so a full list drops the oldest further bank, never the one just added.
    const logins = sanitizeLogins([...fresh, ...kept.filter((l) => !fresh.some((n) => sameLogin(n, l)))], first);
    await writeLogins(first, secret, file, opened ? opened.salt : newSalt(), logins);
    return logins.length;
  });
}

/**
 * The further banks' logins with their PINs, opened by the first login's PIN
 * and the secret. A file that can never open again is deleted (`dropped`);
 * one this PIN does not open while the bank has not taken it stays, and
 * nothing opens.
 */
export function openLogins(first: SealedLogin, secret: Buffer, pin: PinState): Promise<OpenedLogins> {
  const file = linkedUnlockFile(first.blz, first.userId);
  return serialized(file, async () => {
    const found = await readLogins(first, secret, file);
    if (!found) return { on: false, linked: [] };
    if (typeof found === 'string') {
      if (!unusable(found, pin)) return { on: true, linked: [] };
      await removeAll(file);
      return { on: false, linked: [], dropped: true };
    }
    return { on: true, linked: found.logins };
  });
}

/**
 * Deletes one further bank's PIN (refused by its bank, or the bank removed);
 * the switch stays as it is. A file that can never open again goes; one this
 * PIN does not open while the bank has not taken it stays untouched.
 */
export function forgetLogin(first: SealedLogin, secret: Buffer, login: Pick<SealedLogin, 'blz' | 'userId'>, pin: PinState): Promise<{ on: boolean }> {
  const file = linkedUnlockFile(first.blz, first.userId);
  return serialized(file, async () => {
    const found = await readLogins(first, secret, file);
    if (!found) return { on: false };
    if (typeof found === 'string') {
      if (!unusable(found, pin)) return { on: true };
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
