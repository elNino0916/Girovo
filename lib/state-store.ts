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
//   - Files live in .fints-state/ (gitignored), named by a hash of blz+userId
//     so the directory listing doesn't reveal which banks/users are stored.
//   - A numeric PIN is low-entropy: this protects the file if it is copied off
//     the machine, but a determined attacker with the file could brute-force a
//     short PIN offline (scrypt only slows this). Keep the machine trusted.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { BankingInformation } from 'lib-fints';

// Defaults to .fints-state/ in the project root. The desktop build installs the
// server into a read-only program directory, so Electron overrides this with a
// per-user path (electron/main.cjs).
const STATE_DIR = process.env.FINTS_STATE_DIR || path.join(process.cwd(), '.fints-state');

// scrypt cost — deliberately raised to slow offline PIN brute-forcing.
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 32;

/** What a remembered device profile holds. */
export type DeviceProfile = {
  bankingInformation: BankingInformation;
  tanMethodId?: number;
  tanMediaName?: string;
};

// Profiles older than this are treated as expired and ignored — the bank's own
// SCA-exemption window is ~90 days, so a full re-sync before then is prudent
// (also refreshes cached accounts).
export const PROFILE_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;

function profileFile(blz: string, userId: string): string {
  const id = crypto.createHash('sha256').update(`${blz}|${userId}`).digest('hex').slice(0, 32);
  return path.join(STATE_DIR, `${id}.json`);
}

/**
 * Encrypt and persist a device profile for (blz, userId), keyed by the PIN.
 */
export function saveProfile(blz: string, userId: string, pin: string, data: DeviceProfile): boolean {
  if (!pin) return false;
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const salt = crypto.randomBytes(16);
    const key = crypto.scryptSync(String(pin), salt, KEY_LEN, SCRYPT);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const plaintext = Buffer.from(JSON.stringify({ savedAt: Date.now(), data }), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const blob = {
      v: 1,
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      ct: ciphertext.toString('base64'),
    };
    fs.writeFileSync(profileFile(blz, userId), JSON.stringify(blob), { mode: 0o600 });
    return true;
  } catch (err) {
    console.warn('[state] could not save device profile:', (err as Error)?.message || err);
    return false;
  }
}

/**
 * Load and decrypt the device profile for (blz, userId) using the PIN.
 * Returns the stored profile, or null if there is no profile, the PIN is wrong,
 * the file is corrupt/tampered, or the profile has expired.
 */
export function loadProfile(blz: string, userId: string, pin: string): DeviceProfile | null {
  if (!pin) return null;
  let blob: { salt: string; iv: string; tag: string; ct: string };
  try {
    blob = JSON.parse(fs.readFileSync(profileFile(blz, userId), 'utf8'));
  } catch {
    return null; // no profile
  }
  try {
    const salt = Buffer.from(blob.salt, 'base64');
    const key = crypto.scryptSync(String(pin), salt, KEY_LEN, SCRYPT);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(blob.ct, 'base64')),
      decipher.final(), // throws if the PIN is wrong or the data was tampered
    ]);
    const parsed = JSON.parse(plaintext.toString('utf8')) as { savedAt: number; data: DeviceProfile };
    if (!parsed || typeof parsed.savedAt !== 'number') return null;
    if (Date.now() - parsed.savedAt > PROFILE_MAX_AGE_MS) return null; // expired
    return parsed.data ?? null;
  } catch {
    return null; // wrong PIN / corrupt / tampered
  }
}

/** Whether a profile file exists for (blz, userId) — regardless of PIN. */
export function hasProfile(blz: string, userId: string): boolean {
  try {
    return fs.existsSync(profileFile(blz, userId));
  } catch {
    return false;
  }
}

/** Delete the stored profile for (blz, userId). */
export function forgetProfile(blz: string, userId: string): boolean {
  try {
    fs.rmSync(profileFile(blz, userId), { force: true });
    return true;
  } catch {
    return false;
  }
}
