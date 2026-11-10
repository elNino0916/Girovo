// Encrypted device-profile persistence.
//
// To avoid a fresh Strong Customer Authentication (SCA/TAN) on every login, we
// remember the bank's *Kundensystem-ID* (systemId) plus the cached BPD/UPD and
// the selected TAN method. Restoring these makes the bank recognise a returning
// device, so it may grant its no-TAN window for balance/last-90-days reads
// instead of demanding SCA each time.
//
// Security:
//   - The PIN is NEVER stored. It is used only to derive the encryption key.
//   - Each profile is encrypted with AES-256-GCM; the key is scrypt(PIN, salt).
//     Without the correct PIN the file cannot be decrypted (GCM auth tag fails).
//     The cipher itself lives in lib/crypto-box.ts, shared with the vault; the
//     file layout it writes is the one this module has always written.
//   - Files live in .fints-state/ (gitignored), named by a hash of blz+userId
//     so the directory listing doesn't reveal which banks/users are stored.
//   - A numeric PIN is low-entropy: this protects the file if it is copied off
//     the machine, but a determined attacker with the file could brute-force a
//     short PIN offline (scrypt only slows this). Keep the machine trusted.
//
// Beside a profile there may be a note that the bank turned a PIN down
// (markPinRefused): sealed with that PIN the same way, so it says no more than
// the profile did. A copy of that PIN kept somewhere this code cannot reach —
// beside another login, behind a fingerprint — is known by it and never sent
// a second time (app/api/connect). It goes with the next device remembered.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { BankingInformation } from 'lib-fints';
import { openWithPin, parseBox, sealWithPin } from './crypto-box.ts';
import { IN_PAGE_SERVER } from './platform.ts';

// Defaults to .fints-state/ in the project root. The desktop build installs the
// server into a read-only program directory, so Electron overrides this with a
// per-user path (src-tauri/src/paths.rs). The vault (lib/vault.ts) lives alongside.
export const STATE_DIR = process.env.FINTS_STATE_DIR || path.join(process.cwd(), '.fints-state');

/** What a remembered device profile holds. */
export type DeviceProfile = {
  bankingInformation: BankingInformation;
  tanMethodId?: number;
  tanMediaName?: string;
  /**
   * The product ID the bank issued the profile's Kundensystem-ID under: the
   * bank refuses the Kundensystem-ID beside any other ("9391 Kundensystem-ID
   * ungültig"). Absent in profiles from before 5.15.2, all of them made under
   * the ID Girovo sent before it had its own (lib/product-fallback.ts).
   */
  productId?: string;
};

// Profiles older than this are treated as expired and ignored — the bank's own
// SCA-exemption window is ~90 days, so a full re-sync before then is prudent
// (also refreshes cached accounts).
export const PROFILE_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;

function profileFile(blz: string, userId: string): string {
  const id = crypto.createHash('sha256').update(`${blz}|${userId}`).digest('hex').slice(0, 32);
  return path.join(STATE_DIR, `${id}.json`);
}

/** Codes of the brief locks a virus scanner or indexer holds on Windows (lib/sealed-file.ts). */
const LOCKED = new Set(['EPERM', 'EACCES', 'EBUSY']);

/**
 * Writes `file` whole: beside it first, then renamed over it, so a write cut
 * short leaves the old file and never the first half of the new one.
 *
 * Not in the apps: there the files are the in-page server's
 * (mobile/shims/fs.ts), which writes every file to the disk that way itself,
 * and a temp file of ours would only reach the disk as one more sealed copy.
 */
function writeWhole(file: string, text: string): void {
  if (IN_PAGE_SERVER) {
    fs.writeFileSync(file, text, { mode: 0o600 });
    return;
  }
  const tmp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch { /* best effort */ }
    // Windows refuses a rename onto a file something holds open for a moment:
    // written in place then, as it always was.
    if (!LOCKED.has((err as NodeJS.ErrnoException)?.code ?? '')) throw err;
    fs.writeFileSync(file, text, { mode: 0o600 });
  }
}

/** Deletes `file` and any temp file a write of it left behind: each opens with a PIN. */
function removeWhole(file: string): boolean {
  try {
    fs.rmSync(file, { force: true });
    const stem = `${path.basename(file)}.`;
    let names: string[] = [];
    try {
      names = fs.readdirSync(STATE_DIR);
    } catch { /* no folder, nothing left */ }
    for (const name of names) {
      if (name.startsWith(stem) && name.endsWith('.tmp')) fs.rmSync(path.join(STATE_DIR, name), { force: true });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Encrypt and persist a device profile for (blz, userId), keyed by the PIN.
 * The bank took this PIN: a note that it had turned one down goes with it.
 */
export function saveProfile(blz: string, userId: string, pin: string, data: DeviceProfile): boolean {
  if (!pin) return false;
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const plaintext = Buffer.from(JSON.stringify({ savedAt: Date.now(), data }), 'utf8');
    // No AAD: the profile format predates it (see crypto-box.ts).
    const blob = sealWithPin(String(pin), plaintext);
    writeWhole(profileFile(blz, userId), JSON.stringify(blob));
    forgetRefusedPin(blz, userId);
    return true;
  } catch (err) {
    console.warn('[state] could not save device profile:', (err as Error)?.message || err);
    return false;
  }
}

/**
 * How the remembered device of (blz, userId) stands to this PIN:
 * 'none' — nothing kept; 'opens' — it is handed out; 'expired' — it opens,
 * but is older than PROFILE_MAX_AGE_MS; 'locked' — a whole file is there that
 * this PIN does not open: it was made under another PIN; 'damaged' — the file
 * is not one of ours any more (empty, cut short, no envelope, no profile in
 * it), which says nothing about any PIN.
 */
export type ProfileState = 'none' | 'opens' | 'expired' | 'locked' | 'damaged';

/** The remembered device as one opening finds it: its state, and the profile where it opens. */
export type OpenedProfile = { state: ProfileState; data: DeviceProfile | null };

/**
 * Opens the remembered device of (blz, userId) with the PIN — once: the key
 * derivation is slow on purpose, so whoever needs both the state and the
 * profile asks here (app/api/connect).
 */
export function openProfile(blz: string, userId: string, pin: string): OpenedProfile {
  const no = (state: ProfileState): OpenedProfile => ({ state, data: null });
  let text: string;
  try {
    text = fs.readFileSync(profileFile(blz, userId), 'utf8');
  } catch {
    return no('none');
  }
  let blob: ReturnType<typeof parseBox> = null;
  try {
    blob = parseBox(JSON.parse(text));
  } catch { /* not JSON: cut short, or not ours */ }
  if (!blob) return no('damaged');
  if (!pin) return no('locked');
  let plaintext: Buffer;
  try {
    plaintext = openWithPin(String(pin), blob); // throws if the PIN is wrong or the data was tampered
  } catch {
    return no('locked');
  }
  try {
    const parsed = JSON.parse(plaintext.toString('utf8')) as { savedAt?: unknown; data?: DeviceProfile } | null;
    if (!parsed || typeof parsed.savedAt !== 'number' || !parsed.data) return no('damaged');
    if (Date.now() - parsed.savedAt > PROFILE_MAX_AGE_MS) return no('expired');
    return { state: 'opens', data: parsed.data };
  } catch {
    return no('damaged');
  }
}

/**
 * Load and decrypt the device profile for (blz, userId) using the PIN.
 * Returns the stored profile, or null if there is no profile, the PIN is wrong,
 * the file is corrupt/tampered, or the profile has expired.
 */
export function loadProfile(blz: string, userId: string, pin: string): DeviceProfile | null {
  return openProfile(blz, userId, pin).data;
}

export function profileState(blz: string, userId: string, pin: string): ProfileState {
  return openProfile(blz, userId, pin).state;
}

/**
 * A PIN that was kept (Windows Hello, a security key, a fingerprint, beside
 * another login) and does not open the device remembered here: the PIN was
 * changed since, and the kept one is the old one. The bank is not asked with
 * it — that would be one wrong try for certain (app/api/connect). A damaged
 * file says nothing of the kind: as if nothing were remembered.
 */
export const keptPinIsStale = (kept: unknown, state: ProfileState): boolean => kept === true && state === 'locked';

/**
 * A device about to be remembered under a PIN the one remembered before does
 * not open with: whatever else keeps this login's PIN keeps the old one, and
 * goes (lib/session.ts saveSessionProfile). Not for an expired one — that PIN
 * is this one — not for a damaged file, and not where nothing was remembered.
 */
export const replacesAnotherPin = (state: ProfileState): boolean => state === 'locked';

/** Whether a profile file exists for (blz, userId) — regardless of PIN. */
export function hasProfile(blz: string, userId: string): boolean {
  try {
    return fs.existsSync(profileFile(blz, userId));
  } catch {
    return false;
  }
}

/** Delete the stored profile for (blz, userId). A note of a refused PIN stays (forgetRefusedPin). */
export function forgetProfile(blz: string, userId: string): boolean {
  return removeWhole(profileFile(blz, userId));
}

// ---------------------------------------------------------------------------
// A PIN the bank turned down
// ---------------------------------------------------------------------------

/** Kept apart from the profile: a profile renamed into its place opens as no note. */
const REFUSED_AAD = Buffer.from('girovo/refused-pin/v1', 'utf8');

/** Its own name beside the profile, so hasProfile and "remembered" know nothing of it. */
function refusedFile(blz: string, userId: string): string {
  const id = crypto.createHash('sha256').update(`${blz}|${userId}|refused-pin`).digest('hex').slice(0, 32);
  return path.join(STATE_DIR, `${id}.refused`);
}

/**
 * Notes that the bank turned this login's PIN down (its own codes for the
 * PIN, 9931 and 9942 — never a guess from its words). One note per login, the
 * latest; sealed with that PIN, it names neither the login nor the PIN.
 */
export function markPinRefused(blz: string, userId: string, pin: string): boolean {
  if (!pin) return false;
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const blob = sealWithPin(String(pin), Buffer.from(JSON.stringify({ refusedAt: Date.now() }), 'utf8'), REFUSED_AAD);
    writeWhole(refusedFile(blz, userId), JSON.stringify(blob));
    return true;
  } catch (err) {
    console.warn('[state] could not note a refused PIN:', (err as Error)?.message || err);
    return false;
  }
}

/**
 * Whether this is the PIN the bank was noted to have turned down for
 * (blz, userId). Asked only for a kept PIN (app/api/connect): a typed one is
 * the user's to try. No note, no key derivation.
 */
export function pinWasRefused(blz: string, userId: string, pin: string): boolean {
  if (!pin) return false;
  let text: string;
  try {
    text = fs.readFileSync(refusedFile(blz, userId), 'utf8');
  } catch {
    return false;
  }
  try {
    const blob = parseBox(JSON.parse(text));
    if (!blob) return false;
    openWithPin(String(pin), blob, REFUSED_AAD);
    return true;
  } catch {
    return false;
  }
}

/** The note goes: the bank took a PIN for this login (saveProfile), or the device is forgotten. */
export function forgetRefusedPin(blz: string, userId: string): boolean {
  return removeWhole(refusedFile(blz, userId));
}
