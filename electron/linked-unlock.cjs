'use strict';

// The secret behind "Weitere Banken mit anmelden" (lib/linked-unlock.ts):
// 32 random bytes for this user account of this computer, kept in the user
// data folder sealed with Electron's safeStorage — DPAPI on Windows, the
// system keyring on Linux — so only this user, logged in here, reads it
// back. The page asks for it with each request about the further banks'
// PINs and the server mixes it into their key; neither keeps it. Where the
// system has no protected store (a Linux desktop without a keyring falls back
// to a password built into Chromium), there is no secret and the feature is
// not offered.
//
// Kept apart from main.cjs (safeStorage and fs come in as arguments) so
// `npm test` can run it without Electron (linked-unlock.test.cjs).

const SECRET_BYTES = 32;

/** Linux backends that protect nothing: Chromium's built-in password, or none found yet. */
const UNPROTECTED = new Set(['basic_text', 'unknown']);

/**
 * @param {object} deps
 * @param {{
 *   isAsyncEncryptionAvailable(): Promise<boolean>,
 *   encryptStringAsync(text: string): Promise<Buffer>,
 *   decryptStringAsync(sealed: Buffer): Promise<{ result: string, shouldReEncrypt: boolean }>,
 *   getSelectedStorageBackend?(): string,
 * }} deps.safeStorage  Electron's, after the app is ready.
 * @param {() => string} deps.file  Where the sealed secret is kept (the user data folder).
 * @param {{ readFile(file: string): Promise<Buffer>, writeFile(file: string, data: Buffer, opts?: object): Promise<void>, rename(from: string, to: string): Promise<void>, rm(file: string, opts?: object): Promise<void> }} deps.fs  node:fs/promises.
 * @param {(n: number) => Buffer} deps.randomBytes
 * @param {string} deps.platform  process.platform
 * @param {{ warn(...args: unknown[]): void }} [deps.log]
 */
function createLinkedUnlockSecret({ safeStorage, file, fs, randomBytes, platform, log = console }) {
  /** One answer per run of the app, once there is one: DPAPI is asked once. */
  let known = null;
  let pending = null;

  async function protectedStore() {
    if (platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function'
      && UNPROTECTED.has(safeStorage.getSelectedStorageBackend())) return false;
    return (await safeStorage.isAsyncEncryptionAvailable()) === true;
  }

  async function write(target, secret) {
    const sealed = await safeStorage.encryptStringAsync(secret);
    const tmp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
    await fs.writeFile(tmp, sealed, { mode: 0o600 });
    try {
      await fs.rename(tmp, target);
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw err;
    }
  }

  async function load() {
    if (!(await protectedStore())) return null;
    const target = file();
    let sealed = null;
    try {
      sealed = await fs.readFile(target);
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err;
    }
    if (sealed) {
      try {
        const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(sealed);
        if (Buffer.from(result, 'base64').length === SECRET_BYTES) {
          if (shouldReEncrypt) await write(target, result).catch(() => {});
          return result;
        }
      } catch {
        // Sealed under another Windows account or a reset keyring: unreadable
        // for good. A new secret leaves the PINs kept with the old one
        // unopenable, and the server deletes them on the next login.
      }
    }
    const fresh = randomBytes(SECRET_BYTES).toString('base64');
    await write(target, fresh);
    return fresh;
  }

  return {
    /** The secret in base64, or null where it cannot be kept protected (or keeping it failed). */
    secret() {
      if (known) return Promise.resolve(known);
      pending ??= load()
        .then((secret) => {
          known = secret;
          return secret;
        })
        .catch((err) => {
          log.warn('[linked-unlock] no secret:', err?.code || err?.name || 'unknown');
          return null;
        })
        .finally(() => {
          pending = null;
        });
      return pending;
    },
  };
}

module.exports = { createLinkedUnlockSecret, SECRET_BYTES };
