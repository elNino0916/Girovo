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

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { BankingInformation } from 'lib-fints';
import { openWithPin, parseBox, sealWithPin } from './crypto-box.ts';

// Defaults to .fints-state/ in the project root. The desktop build installs the
// server into a read-only program directory, so Electron overrides this with a
// per-user path (electron/main.cjs). The vault (lib/vault.ts) lives alongside.
export const STATE_DIR = process.env.FINTS_STATE_DIR || path.join(process.cwd(), '.fints-state');

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
    const plaintext = Buffer.from(JSON.stringify({ savedAt: Date.now(), data }), 'utf8');
    // No AAD: the profile format predates it (see crypto-box.ts).
    const blob = sealWithPin(String(pin), plaintext);
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
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(profileFile(blz, userId), 'utf8'));
  } catch {
    return null; // no profile
  }
  const blob = parseBox(raw);
  if (!blob) return null; // not an envelope we wrote
  try {
    const plaintext = openWithPin(String(pin), blob); // throws if the PIN is wrong or the data was tampered
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
