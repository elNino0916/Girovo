// PIN-keyed sealed boxes: AES-256-GCM with a key of scrypt(PIN, salt).
//
// Shared by the remembered-device profile (lib/state-store.ts) and the
// personal-data vault (lib/vault.ts). Pure on purpose — no 'server-only', no
// file I/O — so `node --test` can pin the on-disk layout down.
//
// That layout is the device profile's, unchanged since the first release:
//
//   { "v": 1, "salt": b64(16 B), "iv": b64(12 B), "tag": b64(16 B), "ct": b64 }
//
// and it has to stay readable. A profile written by an older build must open
// in a newer one, or every update would quietly cost the user a fresh TAN
// approval on their next login. lib/crypto-box.test.ts holds the old code path
// verbatim and checks both directions.
//
// The PIN is low-entropy, so the scrypt cost below is what stands between a
// copied file and an offline brute-force. It only slows that down; it does not
// make a short numeric PIN strong. Keep the machine trusted.

import crypto from 'node:crypto';

/** scrypt cost — deliberately raised to slow offline PIN brute-forcing. Changing it orphans every stored file. */
export const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const KEY_LEN = 32;

const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;

/** The JSON envelope written to disk. Every field but `v` is base64. */
export type SealedBox = { v: 1; salt: string; iv: string; tag: string; ct: string };

export const newSalt = (): Buffer => crypto.randomBytes(SALT_LEN);

/** The salt a box was sealed with — what its key has to be derived from. */
export const boxSalt = (box: SealedBox): Buffer => Buffer.from(box.salt, 'base64');

/**
 * Blocks the event loop for the length of one scrypt (~0.1 s). Fine for the
 * device profile, which is touched once per login; the vault uses the async
 * variant because it runs while TAN polls are in flight.
 */
export function deriveKeySync(pin: string, salt: Buffer): Buffer {
  return crypto.scryptSync(String(pin), salt, KEY_LEN, SCRYPT);
}

export function deriveKey(pin: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(pin), salt, KEY_LEN, SCRYPT, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/**
 * Encrypt `plaintext` under `key`, with a fresh random IV.
 *
 * `salt` is only recorded, not used: the caller derived `key` from it, and
 * keeping the two apart is what lets the vault reuse one derived key for every
 * save in a session instead of paying for scrypt each time.
 *
 * `aad` binds the box to a purpose. The device profile predates it and has
 * none, so it must stay optional — adding one there would orphan every
 * remembered device.
 */
export function sealBox(key: Buffer, salt: Buffer, plaintext: Buffer, aad?: Buffer): SealedBox {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN });
  if (aad) cipher.setAAD(aad);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  // Key order matches what saveProfile has always written. JSON readers don't
  // care, but a byte-identical layout keeps old and new files diffable.
  return {
    v: 1,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ct: ct.toString('base64'),
  };
}

/**
 * Decrypt a box. Throws when the key is wrong or a single bit of the box was
 * changed — GCM's tag check is the only thing that tells those apart from a
 * successful open, so callers must treat any throw as "not readable".
 */
export function openBox(key: Buffer, box: SealedBox, aad?: Buffer): Buffer {
  // Pinning the tag length refuses a truncated tag, which Node would otherwise
  // accept (a 4-byte tag is far easier to forge). Every box ever written
  // carries the full 16 bytes, so old files are unaffected.
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'), { authTagLength: TAG_LEN });
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(box.ct, 'base64')), decipher.final()]);
}

const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const b64Len = (s: unknown, len?: number): boolean => {
  if (typeof s !== 'string' || !B64.test(s)) return false;
  return len == null || Buffer.from(s, 'base64').length === len;
};

/**
 * The envelope, if `value` is one. Checks shape and lengths only — whether it
 * actually opens is openBox's job.
 */
export function parseBox(value: unknown): SealedBox | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  // A future format must not be fed through v1's assumptions.
  if (o.v !== 1) return null;
  if (!b64Len(o.salt, SALT_LEN) || !b64Len(o.iv, IV_LEN) || !b64Len(o.tag, TAG_LEN) || !b64Len(o.ct)) return null;
  return { v: 1, salt: o.salt as string, iv: o.iv as string, tag: o.tag as string, ct: o.ct as string };
}

/** One-shot seal with a fresh salt — the device profile's whole write path. */
export function sealWithPin(pin: string, plaintext: Buffer, aad?: Buffer): SealedBox {
  const salt = newSalt();
  return sealBox(deriveKeySync(pin, salt), salt, plaintext, aad);
}

/** One-shot open. Throws exactly when openBox does. */
export function openWithPin(pin: string, box: SealedBox, aad?: Buffer): Buffer {
  return openBox(deriveKeySync(pin, boxSalt(box)), box, aad);
}
