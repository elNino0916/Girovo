// Girovo 7 on the desktop: the profile above all banks (issue #22).
//
// Until 6.x the first bank logged in was the "Hauptbank": its vault, keyed by
// that bank's PIN (lib/vault.ts), held the personal data of the whole view,
// and every further bank hung off it. The profile replaces that, the way
// Banking4's vault does: one sealed file per data folder, opened with a
// password of the user's own (or Windows Hello), holding
//
//   - the vault's data (VaultData, still sanitised by lib/vault.ts), and
//   - every bank of the view, all of equal rank: BLZ, name, login name and
//     the PIN, so one unlock logs every bank in.
//
// How it is sealed:
//   - The content is sealed under a random key K (AES-256-GCM, lib/crypto-box).
//   - K itself is sealed once per way in ("locks"): under the password, under
//     Windows Hello and under each security key (FIDO2 hmac-secret, the
//     shell's src-tauri/src/security_key.rs). Each lock's key also takes the shell's DPAPI
//     secret (src-tauri/src/secret.rs), so a copy of the file taken off this
//     computer cannot be tried against passwords elsewhere. The password's
//     part goes through scrypt like every PIN here.
//   - Changing the password or turning Windows Hello on or off reseals K,
//     never the content; a forgotten password cannot be helped, the file can
//     only be set aside (`.bak`) and a new profile begun.
//
// While open, K and the content stay in this module's memory: the in-page
// server is the app's own process, and closing the window drops them.
// lockProfile drops them sooner (Abmelden, the automatic logout).
//
// The profile name and its picture (the one chosen in the Sitzung panel) are
// kept outside the seal: the unlock screen shows them before anything opens,
// as fints.lastBank shows a bank today. Nothing else is.
//
// No 'server-only' marker, like vault.ts: `node --test` runs the real file
// round trip (lib/profile.test.ts). Never log the content, a PIN, the password
// or a key, not even on an error path.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { boxSalt, deriveKey, newSalt, openBox, parseBox, sealBox, type SealedBox } from './crypto-box.ts';
import { isAvatarChoice, isAvatarImage, OWN_PICTURE, type AvatarChoice } from './avatars.ts';
import { isRecord } from './guards.ts';
import { LINKED_BANK_LIMITS, sameLogin, sanitizeLinkedBanks, type LinkedBankRef } from './linked-banks.ts';
import { sanitizeLogins } from './linked-unlock.ts';
import { KEYS_MAX, keyIdOf, parseCredential, parseKeyName } from './security-key.ts';
import { moveAside, removeFamily, serialized, writeFileAtomic } from './sealed-file.ts';
import { PROFILE_PASSWORD_MIN } from './profile-client.ts';
import { STATE_DIR } from './state-store.ts';

/** A bank of the profile; `pin` only once the bank has taken it here. */
export type ProfileBank = LinkedBankRef & { pin?: string };

/** What a lock's key is made of: the password typed, the shell's key after a Windows Hello gesture, or a security key's touch. */
export type ProfileWay = { password: string } | { helloKey: Buffer } | { securityKey: Buffer; credential: string };

/** A security key of the profile as anyone may see it: what the shell asks the reader for. */
export type ProfileKeyInfo = { id: string; credential: string; added: string; name?: string };

/** The open profile as the routes hand it on. */
export type ProfileContent = { name: string; banks: ProfileBank[]; vault: unknown };

/** What anyone may know before it opens: whether there is one, its name, the ways in. */
/** The picture the unlock screen shows: a glyph, or the own picture with its image. */
export type ProfileFace = { avatar: AvatarChoice; image?: string };

export type ProfileStatus =
  | { exists: false }
  | {
    exists: true; name: string; hello: boolean; open: boolean; damaged?: true; face?: ProfileFace;
    /** The security keys that open it, and the salt the shell hands the reader (both needed before it opens). */
    keys?: ProfileKeyInfo[]; keySalt?: string;
  };

export const PROFILE_LIMITS = {
  /** Characters of the profile's name. */
  name: 40,
  /** Every bank of the view: the one that once was the Hauptbank and the further ones. */
  banks: LINKED_BANK_LIMITS.count + 1,
  /** Characters; the same floor the backup's password has. */
  passwordMin: PROFILE_PASSWORD_MIN,
  passwordMax: 200,
  /** The plaintext: a full vault (lib/vault.ts VAULT_LIMITS.bytes) and the banks beside it. */
  bytes: 512 * 1024 + 32 * 1024,
};

/** A file this big is not one of ours: base64 of the plaintext plus the envelope and the locks. */
const FILE_MAX_BYTES = Math.ceil((PROFILE_LIMITS.bytes * 4) / 3) + 128 * 1024;
const KEY_BYTES = 32;
/** Every key and box of the profile is kept apart from all others by these. */
const DOMAIN = 'girovo/profile/v1';
const CONTENT_AAD = Buffer.from(`${DOMAIN}|content`, 'utf8');
const lockAad = (kind: string) => Buffer.from(`${DOMAIN}|lock|${kind}`, 'utf8');
/** The lock a way in opens: its kind, and a security key's id. */
const kindOf = (way: ProfileWay) => ('password' in way ? 'password' : 'helloKey' in way ? 'hello' : `key|${keyIdOf(way.credential)}`);

/**
 * A refusal the route turns into an HTTP status. `code` says which, so the
 * route words it in the request's language (msgs().profile.server).
 */
export class ProfileError extends Error {
  code: 'exists' | 'missing' | 'locked' | 'wrong' | 'short' | 'name' | 'damaged' | 'tooLarge' | 'full' | 'keysFull' | 'keyExists' | 'keyBad' | 'io';
  status: number;
  constructor(code: ProfileError['code'], status: number) {
    super(code);
    this.name = 'ProfileError';
    this.code = code;
    this.status = status;
  }
}

/** The one profile of this data folder. */
export function profileFile(): string {
  return path.join(STATE_DIR, 'girovo.profile');
}

/** What sync keeps beside the profile is named after this (lib/sync-meta.ts). */
export const PROFILE_BASE = 'girovo-profile';

// ---------------------------------------------------------------------------
// Sanitising
// ---------------------------------------------------------------------------

const isControl = (cp: number) => cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || cp === 0x2028 || cp === 0x2029;

/** The profile's name on one line, clipped by code point; '' when nothing is left. */
export function profileName(v: unknown): string {
  if (typeof v !== 'string') return '';
  const plain = Array.from(v).map((ch) => (isControl(ch.codePointAt(0) ?? 0) ? ' ' : ch)).join('');
  const chars = Array.from(plain.replace(/\s+/g, ' ').trim());
  return chars.slice(0, PROFILE_LIMITS.name).join('').trimEnd();
}

/** Whether a password is one the profile takes. */
export function passwordOk(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const n = Array.from(v).length;
  return n >= PROFILE_LIMITS.passwordMin && n <= PROFILE_LIMITS.passwordMax;
}

/**
 * The banks as the profile keeps them: each login once, at most
 * PROFILE_LIMITS.banks, in the order given. A PIN stays only where it is one
 * (lib/linked-unlock.ts's rule); anything else an entry carries is dropped.
 */
export function sanitizeBanks(v: unknown): ProfileBank[] {
  const out: ProfileBank[] = [];
  for (const raw of Array.isArray(v) ? v : []) {
    const [ref] = sanitizeLinkedBanks([raw]);
    if (!ref || out.some((b) => sameLogin(b, ref))) continue;
    const pin = isRecord(raw) ? sanitizeLogins([{ blz: ref.blz, userId: ref.userId, pin: raw.pin }], { blz: '', userId: '' })[0]?.pin : undefined;
    out.push(pin ? { ...ref, pin } : ref);
    if (out.length === PROFILE_LIMITS.banks) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------

type KeyLock = ProfileKeyInfo & { box: SealedBox };
type Locks = { password: SealedBox; hello?: SealedBox; keys?: KeyLock[] };
type ProfileFileShape = { v: 1; name: string; face?: ProfileFace; keySalt?: string; locks: Locks; box: SealedBox };

const ISO = /^\d{4}-\d{2}-\d{2}T/;

/** The security keys' locks as this version reads them: well formed, each once, at most KEYS_MAX. */
function keyLocks(v: unknown): KeyLock[] {
  const out: KeyLock[] = [];
  for (const raw of Array.isArray(v) ? v : []) {
    if (!isRecord(raw)) continue;
    const credential = parseCredential(raw.credential);
    const box = parseBox(raw.box);
    if (!credential || !box || raw.id !== keyIdOf(credential) || out.some((k) => k.id === raw.id)) continue;
    const name = parseKeyName(raw.name);
    const added = typeof raw.added === 'string' && ISO.test(raw.added) ? raw.added : new Date(0).toISOString();
    out.push({ id: keyIdOf(credential), credential, added, ...(name ? { name } : {}), box });
    if (out.length === KEYS_MAX) break;
  }
  return out;
}

const keyInfo = ({ box: _box, ...info }: KeyLock): ProfileKeyInfo => info;

/** A picture as the unlock screen may show it: a known glyph, or the own picture with an image that is one. */
export function profileFace(v: unknown): ProfileFace | undefined {
  if (!isRecord(v) || !isAvatarChoice(v.avatar)) return undefined;
  if (v.avatar !== OWN_PICTURE) return { avatar: v.avatar };
  return isAvatarImage(v.image) ? { avatar: OWN_PICTURE, image: v.image } : undefined;
}

function parseFile(raw: string): ProfileFileShape | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.v !== 1 || !isRecord(parsed.locks)) return null;
  const password = parseBox(parsed.locks.password);
  const hello = parsed.locks.hello === undefined ? undefined : parseBox(parsed.locks.hello);
  const box = parseBox(parsed.box);
  if (!password || hello === null || !box) return null;
  const face = profileFace(parsed.face);
  const keys = keyLocks(parsed.locks.keys);
  const keySalt = typeof parsed.keySalt === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(parsed.keySalt) ? parsed.keySalt : undefined;
  return {
    v: 1, name: profileName(parsed.name), ...(face ? { face } : {}), ...(keySalt ? { keySalt } : {}),
    locks: { password, ...(hello ? { hello } : {}), ...(keys.length ? { keys } : {}) }, box,
  };
}

type Read = { kind: 'missing' } | { kind: 'damaged' } | { kind: 'file'; file: ProfileFileShape };

async function readFile(): Promise<Read> {
  let raw: string;
  try {
    const st = await fs.promises.stat(profileFile());
    if (!st.isFile() || st.size > FILE_MAX_BYTES) return { kind: 'damaged' };
    raw = await fs.promises.readFile(profileFile(), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return { kind: 'missing' };
    console.warn('[profile] read failed:', (err as NodeJS.ErrnoException)?.code || 'unknown');
    throw new ProfileError('io', 500);
  }
  const file = parseFile(raw);
  return file ? { kind: 'file', file } : { kind: 'damaged' };
}

async function writeFile(file: ProfileFileShape): Promise<void> {
  try {
    await writeFileAtomic(profileFile(), JSON.stringify(file));
  } catch (err) {
    console.warn('[profile] write failed:', (err as NodeJS.ErrnoException)?.code || 'unknown');
    throw new ProfileError('io', 500);
  }
}

/** A lock's key: the way in and the shell's secret together, neither alone. */
async function lockKey(way: ProfileWay, salt: Buffer, secret: Buffer): Promise<Buffer> {
  const h = crypto.createHash('sha256').update(DOMAIN).update(salt).update(secret);
  if ('password' in way) h.update('password').update(await deriveKey(way.password, salt));
  else if ('helloKey' in way) h.update('hello').update(way.helloKey);
  else h.update(kindOf(way)).update(way.securityKey);
  return h.digest();
}

async function sealLock(k: Buffer, way: ProfileWay, secret: Buffer): Promise<SealedBox> {
  const salt = newSalt();
  return sealBox(await lockKey(way, salt, secret), salt, k, lockAad(kindOf(way)));
}

/** K from one lock, or null when this way does not open it. */
async function openLock(box: SealedBox, way: ProfileWay, secret: Buffer): Promise<Buffer | null> {
  try {
    const k = openBox(await lockKey(way, boxSalt(box), secret), box, lockAad(kindOf(way)));
    return k.length === KEY_BYTES ? k : null;
  } catch {
    return null;
  }
}

type Content = { banks: ProfileBank[]; vault: unknown };

function sealContent(k: Buffer, content: Content): SealedBox {
  const plain = Buffer.from(JSON.stringify({ v: 1, banks: content.banks, vault: content.vault ?? null }), 'utf8');
  if (plain.length > PROFILE_LIMITS.bytes) throw new ProfileError('tooLarge', 413);
  return sealBox(k, newSalt(), plain, CONTENT_AAD);
}

function openContent(k: Buffer, box: SealedBox): Content | null {
  try {
    const parsed = JSON.parse(openBox(k, box, CONTENT_AAD).toString('utf8')) as unknown;
    if (!isRecord(parsed) || parsed.v !== 1) return null;
    return { banks: sanitizeBanks(parsed.banks), vault: parsed.vault ?? null };
  } catch {
    // Not rethrown: a parser's message could quote the decrypted text.
    return null;
  }
}

// ---------------------------------------------------------------------------
// The open profile
// ---------------------------------------------------------------------------

type Opened = { k: Buffer; file: ProfileFileShape; content: Content };

let opened: Opened | null = null;

/** Every change goes through here, one at a time, onto the file as it is now. */
function change<T>(fn: (o: Opened) => Promise<{ next: Opened; result: T }>): Promise<T> {
  return serialized(profileFile(), async () => {
    const o = opened;
    if (!o) throw new ProfileError('locked', 409);
    const { next, result } = await fn(o);
    // Nothing changed (a bank kept again as it was): nothing to write.
    if (next === o) return result;
    await writeFile(next.file);
    // Locked meanwhile (Abmelden while the write ran): nothing is held again.
    if (opened === o) opened = next;
    return result;
  });
}

const contentChange = (o: Opened, content: Content): Opened => ({
  k: o.k, content, file: { ...o.file, box: sealContent(o.k, content) },
});

const handOut = (o: Opened): ProfileContent => ({
  name: o.file.name, banks: o.content.banks.map((b) => ({ ...b })), vault: o.content.vault,
});

/** Whether a profile is open in this process: the vault then is the profile's (lib/vault.ts). */
export function isProfileOpen(): boolean {
  return opened !== null;
}

/** Before it opens: whether there is a profile, its name, whether Windows Hello opens it. Needs no key. */
export async function profileStatus(): Promise<ProfileStatus> {
  const r = await readFile();
  if (r.kind === 'missing') return { exists: false };
  // A damaged file is still a profile: never offered a new one over it unasked.
  if (r.kind === 'damaged') return { exists: true, name: '', hello: false, open: false, damaged: true };
  const keys = (r.file.locks.keys ?? []).map(keyInfo);
  return {
    exists: true, name: r.file.name, hello: !!r.file.locks.hello, open: opened !== null, ...(r.file.face ? { face: r.file.face } : {}),
    ...(keys.length ? { keys } : {}), ...(r.file.keySalt ? { keySalt: r.file.keySalt } : {}),
  };
}

/**
 * Begins the profile, opened at once: `banks` with the PINs the bank has
 * taken, `vault` the data the Hauptbank's vault held (or none). Refused while
 * one exists, damaged or not: that one is set aside first, by asking.
 */
export async function createProfile(input: {
  name: unknown; password: unknown; secret: Buffer; banks: unknown; vault: unknown;
}): Promise<ProfileContent> {
  const name = profileName(input.name);
  // The unlock screen always has a name to show.
  if (!name) throw new ProfileError('name', 400);
  if (!passwordOk(input.password)) throw new ProfileError('short', 400);
  const password = input.password;
  return serialized(profileFile(), async () => {
    if ((await readFile()).kind !== 'missing') throw new ProfileError('exists', 409);
    const k = crypto.randomBytes(KEY_BYTES);
    const content: Content = { banks: sanitizeBanks(input.banks), vault: input.vault ?? null };
    const file: ProfileFileShape = {
      v: 1, name, locks: { password: await sealLock(k, { password }, input.secret) }, box: sealContent(k, content),
    };
    await writeFile(file);
    opened = { k, file, content };
    return handOut(opened);
  });
}

/**
 * Opens the profile with the password or Windows Hello. `wrong` when this
 * way does not open it (a mistyped password, a Windows Hello key that was
 * replaced, or a secret that is not this computer's).
 */
export async function unlockProfile(way: ProfileWay, secret: Buffer): Promise<ProfileContent> {
  return serialized(profileFile(), async () => {
    const r = await readFile();
    if (r.kind === 'missing') throw new ProfileError('missing', 404);
    if (r.kind === 'damaged') throw new ProfileError('damaged', 409);
    const box = 'password' in way ? r.file.locks.password
      : 'helloKey' in way ? r.file.locks.hello
        : r.file.locks.keys?.find((key) => key.id === keyIdOf(way.credential))?.box;
    if (!box) throw new ProfileError('wrong', 403);
    const k = await openLock(box, way, secret);
    if (!k) throw new ProfileError('wrong', 403);
    const content = openContent(k, r.file.box);
    if (!content) throw new ProfileError('damaged', 409);
    opened = { k, file: r.file, content };
    return handOut(opened);
  });
}

/** Closes it: K and the content leave memory. Harmless when nothing is open. */
export function lockProfile(): void {
  opened = null;
}

/** The open profile's content, or null while none is open. */
export function openProfile(): ProfileContent | null {
  return opened ? handOut(opened) : null;
}

/**
 * The key what is kept beside the profile is sealed with (lib/sync-meta.ts),
 * shaped like lib/vault.ts vaultKeyOf's answer. Null while none is open.
 */
export function profileKey(): { key: Buffer; salt: Buffer; base: string } | null {
  if (!opened) return null;
  return { key: opened.k, salt: boxSalt(opened.file.box), base: PROFILE_BASE };
}

/** The vault's data as the profile keeps it (lib/vault.ts sanitises it). */
export function profileVault(): unknown {
  return opened?.content.vault ?? null;
}

/** Replaces the vault's data. lib/vault.ts has sanitised and stamped it. */
export function saveProfileVault(vault: unknown): Promise<void> {
  return change(async (o) => ({ next: contentChange(o, { ...o.content, vault }), result: undefined }));
}

/**
 * Keeps a bank and its PIN: one the profile has gets its PIN (and name)
 * replaced in place, a new one goes to the end. Refused when the profile is
 * full. Answers the banks as kept now.
 */
export function keepBank(bank: ProfileBank): Promise<ProfileBank[]> {
  return change(async (o) => {
    const [clean] = sanitizeBanks([bank]);
    if (!clean) throw new ProfileError('damaged', 400);
    const at = o.content.banks.findIndex((b) => sameLogin(b, clean));
    if (at < 0 && o.content.banks.length >= PROFILE_LIMITS.banks) throw new ProfileError('full', 409);
    const banks = at < 0
      ? [...o.content.banks, clean]
      : o.content.banks.map((b, i) => (i === at ? { ...b, ...clean, accounts: clean.accounts ?? b.accounts } : b));
    const same = JSON.stringify(banks) === JSON.stringify(o.content.banks);
    const next = same ? o : contentChange(o, { ...o.content, banks });
    return { next, result: handOut(next).banks };
  });
}

/** A bank's PIN goes (its bank turned it down); the bank stays, to be logged in by hand. */
export function forgetBankPin(login: { blz: string; userId: string }): Promise<ProfileBank[]> {
  return change(async (o) => {
    const banks = o.content.banks.map((b) => {
      if (!sameLogin(b, login) || !b.pin) return b;
      const { pin: _gone, ...rest } = b;
      return rest;
    });
    const next = contentChange(o, { ...o.content, banks });
    return { next, result: handOut(next).banks };
  });
}

/** A bank leaves the profile, its PIN with it (Entfernen). */
export function removeBank(login: { blz: string; userId: string }): Promise<ProfileBank[]> {
  return change(async (o) => {
    const next = contentChange(o, { ...o.content, banks: o.content.banks.filter((b) => !sameLogin(b, login)) });
    return { next, result: handOut(next).banks };
  });
}

/** Puts the banks in this order (the first logs in first); banks not named keep their place after them. */
export function orderBanks(order: readonly { blz: string; userId: string }[]): Promise<ProfileBank[]> {
  return change(async (o) => {
    const named = order.flatMap((l) => o.content.banks.filter((b) => sameLogin(b, l)));
    const banks = [...new Set([...named, ...o.content.banks])];
    const next = contentChange(o, { ...o.content, banks });
    return { next, result: handOut(next).banks };
  });
}

/** The picture the unlock screen shows from now on (null: the initials). Unchanged, nothing is written. */
export function setProfileFace(input: unknown): Promise<ProfileFace | null> {
  const face = profileFace(input) ?? null;
  return change(async (o) => {
    if (JSON.stringify(face ?? null) === JSON.stringify(o.file.face ?? null)) return { next: o, result: face };
    const { face: _old, ...rest } = o.file;
    return { next: { ...o, file: face ? { ...rest, face } : rest }, result: face };
  });
}

/**
 * The salt the shell hands a security key (hmac-secret): the profile's own,
 * made the first time a key is added and kept beside the name, since the
 * unlock screen needs it before anything opens.
 */
export function profileKeySalt(): Promise<string> {
  return change(async (o) => {
    if (o.file.keySalt) return { next: o, result: o.file.keySalt };
    const keySalt = crypto.randomBytes(32).toString('base64');
    return { next: { ...o, file: { ...o.file, keySalt } }, result: keySalt };
  });
}

/**
 * One more security key opens the profile (its touch's key from the shell's
 * register). Needs the password, as changing it does: a key someone brings to
 * an unlocked computer would let them in for good. Answers the keys.
 */
export function addProfileKey(credential: unknown, securityKey: Buffer, secret: Buffer, password: unknown): Promise<ProfileKeyInfo[]> {
  return change(async (o) => {
    if (typeof password !== 'string' || !(await openLock(o.file.locks.password, { password }, secret))) {
      throw new ProfileError('wrong', 403);
    }
    const cred = parseCredential(credential);
    if (!cred || !o.file.keySalt) throw new ProfileError('keyBad', 400);
    const keys = o.file.locks.keys ?? [];
    if (keys.some((k) => k.id === keyIdOf(cred))) throw new ProfileError('keyExists', 409);
    if (keys.length >= KEYS_MAX) throw new ProfileError('keysFull', 409);
    const lock: KeyLock = {
      id: keyIdOf(cred), credential: cred, added: new Date().toISOString(),
      box: await sealLock(o.k, { securityKey, credential: cred }, secret),
    };
    const next = { ...o, file: { ...o.file, locks: { ...o.file.locks, keys: [...keys, lock] } } };
    return { next, result: next.file.locks.keys.map(keyInfo) };
  });
}

/** A key's name ('' takes it away). Answers the keys. */
export function renameProfileKey(id: unknown, name: unknown): Promise<ProfileKeyInfo[]> {
  const clean = parseKeyName(name);
  return change(async (o) => {
    if (clean === null) throw new ProfileError('name', 400);
    const keys = (o.file.locks.keys ?? []).map((k) => {
      if (k.id !== id) return k;
      const { name: _old, ...rest } = k;
      return clean ? { ...rest, name: clean } : rest;
    });
    const next = { ...o, file: { ...o.file, locks: { ...o.file.locks, keys } } };
    return { next, result: keys.map(keyInfo) };
  });
}

/** A key no longer opens the profile. Answers the keys left. */
export function removeProfileKey(id: unknown): Promise<ProfileKeyInfo[]> {
  return change(async (o) => {
    const keys = (o.file.locks.keys ?? []).filter((k) => k.id !== id);
    const { keys: _all, ...rest } = o.file.locks;
    const next = { ...o, file: { ...o.file, locks: keys.length ? { ...rest, keys } : rest } };
    return { next, result: keys.map(keyInfo) };
  });
}

/** A new name for the profile; '' is refused (the unlock screen always has one to show). */
export function renameProfile(name: unknown): Promise<string> {
  const clean = profileName(name);
  return change(async (o) => {
    if (!clean) throw new ProfileError('name', 400);
    return { next: { ...o, file: { ...o.file, name: clean } }, result: clean };
  });
}

/**
 * A new password, the current one asked for first even though the profile
 * is open: someone at an unlocked computer must not take it over. K stays,
 * so Windows Hello keeps opening it.
 */
export function changePassword(current: unknown, next: unknown, secret: Buffer): Promise<void> {
  return change(async (o) => {
    if (typeof current !== 'string' || !(await openLock(o.file.locks.password, { password: current }, secret))) {
      throw new ProfileError('wrong', 403);
    }
    if (!passwordOk(next)) throw new ProfileError('short', 400);
    const password = await sealLock(o.k, { password: next }, secret);
    return { next: { ...o, file: { ...o.file, locks: { ...o.file.locks, password } } }, result: undefined };
  });
}

/** Windows Hello opens the profile from now on (`helloKey` from the shell's enroll), or no longer (null). */
export function setHello(helloKey: Buffer | null, secret: Buffer): Promise<boolean> {
  return change(async (o) => {
    const { hello: _old, ...rest } = o.file.locks;
    const locks: Locks = helloKey ? { ...rest, hello: await sealLock(o.k, { helloKey }, secret) } : rest;
    return { next: { ...o, file: { ...o.file, locks } }, result: !!helloKey };
  });
}

/**
 * "Passwort vergessen": the profile is set aside (`.bak`, never deleted
 * here: a password remembered later still opens it) and none is open. The
 * next start offers the bank's login and a new profile.
 */
export async function setProfileAside(): Promise<boolean> {
  return serialized(profileFile(), async () => {
    opened = null;
    try {
      return await moveAside(profileFile());
    } catch (err) {
      console.warn('[profile] could not set the file aside:', (err as NodeJS.ErrnoException)?.code || 'unknown');
      throw new ProfileError('io', 500);
    }
  });
}

/** Whether `password` opens the open profile: asked before "Profil löschen" deletes anything around it. */
export async function checkProfilePassword(password: unknown, secret: Buffer): Promise<boolean> {
  const o = opened;
  if (!o || typeof password !== 'string') return false;
  return !!(await openLock(o.file.locks.password, { password }, secret));
}

/**
 * "Profil löschen": the file, every copy set aside and any temp file go for
 * good, since each opens with a password someone could try offline. Needs
 * the password, like changing it.
 */
export function deleteProfile(password: unknown, secret: Buffer): Promise<number> {
  return serialized(profileFile(), async () => {
    const o = opened;
    if (!o) throw new ProfileError('locked', 409);
    if (typeof password !== 'string' || !(await openLock(o.file.locks.password, { password }, secret))) {
      throw new ProfileError('wrong', 403);
    }
    opened = null;
    const { removed, failed } = await removeFamily(STATE_DIR, path.basename(profileFile()), (code) => {
      console.warn('[profile] could not delete a file:', code);
    });
    if (failed) throw new ProfileError('io', 500);
    return removed;
  });
}
