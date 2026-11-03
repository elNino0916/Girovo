'use strict';

// Windows Hello in place of typing the first login's PIN — the desktop's
// counterpart of Android's fingerprint login (mobile/bridges/biometric.ts).
//
// This side owns the Windows Hello key and turns a gesture into a key; the
// PIN itself is sealed by the server (lib/windows-hello.ts), under that key
// and the shell's DPAPI secret together, so neither alone opens it:
//
// - One Windows Hello key per user account for Girovo (a KeyCredential, in the
//   TPM where there is one), made on the first enroll. Signing asks for the
//   face, the fingerprint or the Windows Hello PIN.
// - The key handed to the page is a hash of the key's signature over a fixed
//   challenge (a salt kept in windows-hello.json). An RSA PKCS#1 v1.5
//   signature is the same every time, so the same gesture brings the same key
//   back — checked at enroll against the key's public half, so a key that
//   signs otherwise is never used.
// - A signature that no longer checks out against the public half kept here
//   (the key was replaced, by another copy of Girovo for one) or a key Windows
//   no longer has: 'invalidated', and what was sealed under it is gone.
//
// The work is done by windows-hello.ps1 (Windows PowerShell 5.1 reaches the
// WinRT API without anything installed); main.cjs passes in how to run it.
// Kept apart from main.cjs so `npm test` runs it without Electron
// (windows-hello.test.cjs).

const CHALLENGE_DOMAIN = 'girovo/windows-hello/challenge/v1';
const KEY_DOMAIN = 'girovo/windows-hello/key/v1';
const SALT_BYTES = 32;
/** A gesture can take a while; a helper that never answers must not hold the queue for ever. */
const HELPER_TIMEOUT_MS = 3 * 60_000;

/** What the helper's statuses mean here (KeyCredentialStatus). */
const CANCELED = new Set(['UserCanceled', 'UserPrefersPassword']);

/** The HRESULT Windows threw, as the helper reports it ("0x80090011"), or undefined. */
function windowsCode(answer) {
  const code = answer?.code;
  return typeof code === 'string' && /^0x[0-9A-F]{8}$/.test(code) ? code : undefined;
}

/** A failure, with what Windows threw where it did: the page names it, since trying again rarely helps then. */
const failed = (code) => (code ? { result: 'failed', code } : { result: 'failed' });

/**
 * Runs windows-hello.ps1 with one request and resolves its one-line answer.
 *
 * @param {object} deps
 * @param {(cmd: string, args: string[], opts: object) => import('node:child_process').ChildProcess} deps.spawn
 * @param {() => string} deps.script  The .ps1's path (a real file: resources/, never inside app.asar).
 * @param {string} [deps.powershell]  powershell.exe
 * @param {number} [deps.timeoutMs]
 */
function createHelperRunner({ spawn, script, powershell, timeoutMs = HELPER_TIMEOUT_MS }) {
  const exe = powershell
    ?? `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  return (request) => new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(exe, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script()], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch (err) {
      reject(err);
      return;
    }
    let out = '';
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      finish(reject, new Error('windows hello helper timed out'));
      try { child.kill(); } catch { /* gone already */ }
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      out += chunk;
      if (out.length > 64 * 1024) {
        finish(reject, new Error('windows hello helper said too much'));
        try { child.kill(); } catch { /* gone already */ }
      }
    });
    child.on('error', (err) => finish(reject, err));
    child.on('close', () => {
      const line = out.trim().split(/\r?\n/).pop() || '';
      try {
        const answer = JSON.parse(line);
        if (answer && typeof answer === 'object') finish(resolve, answer);
        else finish(reject, new Error('windows hello helper gave no answer'));
      } catch {
        finish(reject, new Error('windows hello helper gave no answer'));
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

/**
 * @param {object} deps
 * @param {(request: object) => Promise<Record<string, unknown>>} deps.run  createHelperRunner's.
 * @param {() => string} deps.file  windows-hello.json in the user data folder.
 * @param {{ readFile(f: string, enc: string): Promise<string>, writeFile(f: string, data: string, opts?: object): Promise<void>, rename(a: string, b: string): Promise<void>, rm(f: string, opts?: object): Promise<void> }} deps.fs
 * @param {typeof import('node:crypto')} deps.crypto
 * @param {string} deps.platform  process.platform
 * @param {{ warn(...args: unknown[]): void }} [deps.log]
 */
function createWindowsHello({ run, file, fs, crypto, platform, log = console }) {
  let supported = null;
  let queue = Promise.resolve();
  /** One helper at a time: two prompts at once would confuse everyone. */
  const serial = (fn) => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => {});
    return next;
  };

  const challengeOf = (salt) => crypto.createHash('sha256').update(CHALLENGE_DOMAIN).update(salt).digest();
  const keyOf = (signature) => crypto.createHash('sha256').update(KEY_DOMAIN).update(signature).digest('base64');

  /** Whether `signature` is the key's PKCS#1 v1.5 signature of `challenge` — the kind that is the same each time. */
  function verifies(publicKey, challenge, signature) {
    try {
      return crypto.verify('sha256', challenge, {
        key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki',
        padding: crypto.constants.RSA_PKCS1_PADDING,
      }, signature);
    } catch {
      return false;
    }
  }

  async function readState() {
    try {
      const raw = JSON.parse(await fs.readFile(file(), 'utf8'));
      if (raw?.v !== 1 || typeof raw.name !== 'string' || !/^Girovo-[0-9a-f]{12}$/.test(raw.name)) return null;
      const salt = typeof raw.salt === 'string' ? Buffer.from(raw.salt, 'base64') : null;
      if (!salt || salt.length !== SALT_BYTES || typeof raw.publicKey !== 'string' || !raw.publicKey) return null;
      return { name: raw.name, salt, publicKey: raw.publicKey };
    } catch {
      return null;
    }
  }

  async function writeState(state) {
    const target = file();
    const tmp = `${target}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    const body = JSON.stringify({ v: 1, name: state.name, salt: state.salt.toString('base64'), publicKey: state.publicKey });
    await fs.writeFile(tmp, body, { mode: 0o600 });
    try {
      await fs.rename(tmp, target);
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw err;
    }
  }

  const dropState = () => fs.rm(file(), { force: true }).catch(() => {});

  /** Signs with the key named in `state`: the key, or why there is none. */
  async function sign(state, windowHandle) {
    const challenge = challengeOf(state.salt);
    const answer = await run({ op: 'sign', name: state.name, challenge: challenge.toString('base64'), window: windowHandle });
    if (CANCELED.has(answer.status)) return { result: 'canceled' };
    if (answer.status === 'NotFound') return { result: 'invalidated' };
    if (answer.status !== 'Success' || typeof answer.signature !== 'string') {
      return { result: 'failed', why: answer.status || answer.error, code: windowsCode(answer) };
    }
    const signature = Buffer.from(answer.signature, 'base64');
    if (!verifies(state.publicKey, challenge, signature)) return { result: 'invalidated' };
    return { result: 'unlocked', key: keyOf(signature) };
  }

  async function available() {
    if (platform !== 'win32') return false;
    if (supported !== null) return supported;
    try {
      const answer = await run({ op: 'probe' });
      supported = answer.supported === true;
    } catch (err) {
      log.warn('[windows-hello] probe failed:', err?.message || 'unknown');
      supported = false;
    }
    return supported;
  }

  return {
    /** Whether this Windows has Windows Hello set up for this user (asked once per run). */
    available: () => serial(available),

    /** Whether a key was made here before — the login form may offer Windows Hello. */
    async enrolled() {
      return (await readState()) !== null;
    },

    /**
     * The key for sealing a PIN: the existing Windows Hello key's (one gesture),
     * or a new key's (Windows asks to set it up, then to use it). A key Windows
     * lost or replaced is made anew — whatever was sealed under it is gone anyway.
     * @returns {Promise<{ result: 'enrolled' | 'canceled' | 'failed' | 'unavailable', key?: string, fresh?: boolean, code?: string }>}
     */
    enroll: (windowHandle) => serial(async () => {
      if (!(await available())) return { result: 'unavailable' };
      try {
        const prior = await readState();
        if (prior) {
          const signed = await sign(prior, windowHandle);
          if (signed.result === 'unlocked') return { result: 'enrolled', key: signed.key, fresh: false };
          if (signed.result === 'canceled') return { result: 'canceled' };
          if (signed.result !== 'invalidated') return failed(signed.code);
        }
        const name = prior?.name ?? `Girovo-${crypto.randomBytes(6).toString('hex')}`;
        const salt = crypto.randomBytes(SALT_BYTES);
        const challenge = challengeOf(salt);
        const answer = await run({ op: 'create', name, challenge: challenge.toString('base64'), window: windowHandle });
        if (CANCELED.has(answer.status)) return { result: 'canceled' };
        if (answer.status !== 'Success' || typeof answer.signature !== 'string' || typeof answer.publicKey !== 'string') {
          log.warn('[windows-hello] create failed:', answer.status || answer.error || 'unknown', windowsCode(answer) || '');
          return failed(windowsCode(answer));
        }
        const signature = Buffer.from(answer.signature, 'base64');
        if (!verifies(answer.publicKey, challenge, signature)) {
          // A key that signs differently each time could never open again.
          log.warn('[windows-hello] the key does not sign with PKCS#1 v1.5');
          await run({ op: 'delete', name }).catch(() => {});
          await dropState();
          return { result: 'failed' };
        }
        await writeState({ name, salt, publicKey: answer.publicKey });
        return { result: 'enrolled', key: keyOf(signature), fresh: true };
      } catch (err) {
        log.warn('[windows-hello] enroll failed:', err?.message || 'unknown');
        return { result: 'failed' };
      }
    }),

    /**
     * The key, after the gesture.
     * @returns {Promise<{ result: 'unlocked' | 'canceled' | 'invalidated' | 'missing' | 'failed', key?: string, code?: string }>}
     */
    unlock: (windowHandle) => serial(async () => {
      const state = await readState();
      if (!state) return { result: 'missing' };
      try {
        const signed = await sign(state, windowHandle);
        if (signed.result === 'invalidated') await dropState();
        if (signed.result === 'failed') {
          log.warn('[windows-hello] sign failed:', signed.why || 'unknown', signed.code || '');
          return failed(signed.code);
        }
        return signed.result === 'unlocked' ? { result: 'unlocked', key: signed.key } : { result: signed.result };
      } catch (err) {
        log.warn('[windows-hello] unlock failed:', err?.message || 'unknown');
        return { result: 'failed' };
      }
    }),

    /** Deletes the Windows Hello key and its salt: nothing sealed under it opens again. */
    reset: () => serial(async () => {
      const state = await readState();
      if (state) await run({ op: 'delete', name: state.name }).catch(() => {});
      await dropState();
    }),
  };
}

module.exports = { createHelperRunner, createWindowsHello, CHALLENGE_DOMAIN, KEY_DOMAIN };
