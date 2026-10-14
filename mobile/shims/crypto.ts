// `node:crypto` for the phone server — exactly what lib/ uses, built on the
// audited @noble libraries so it stays synchronous where Node's is
// (scryptSync, createCipheriv), which WebCrypto cannot be.
//
// The boxes it seals are byte-for-byte what Node seals (lib/crypto-box.ts):
// scrypt N=2^15 r=8 p=1 over the UTF-8 PIN, AES-256-GCM with a 12-byte IV and
// a 16-byte tag kept apart from the ciphertext. mobile/shims/crypto.test.ts
// checks that against node:crypto.

import { gcm } from '@noble/ciphers/aes.js';
import { scrypt as nobleScrypt, scryptAsync } from '@noble/hashes/scrypt.js';
import { sha1 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { Buffer } from 'buffer';

type BinaryLike = string | Uint8Array;
type ScryptOptions = { N?: number; r?: number; p?: number; maxmem?: number; cost?: number; blockSize?: number; parallelization?: number };

const bytes = (data: BinaryLike, encoding?: BufferEncoding): Uint8Array =>
  typeof data === 'string' ? Buffer.from(data, encoding ?? 'utf8') : data;

export function randomBytes(size: number): Buffer {
  const out = Buffer.alloc(size);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}

const HASHES = { sha256, sha1 } as const;

class Hash {
  private readonly chunks: Uint8Array[] = [];
  private readonly fn: (typeof HASHES)[keyof typeof HASHES];
  constructor(fn: (typeof HASHES)[keyof typeof HASHES]) {
    this.fn = fn;
  }
  update(data: BinaryLike, encoding?: BufferEncoding): this {
    this.chunks.push(bytes(data, encoding));
    return this;
  }
  digest(): Buffer;
  digest(encoding: BufferEncoding): string;
  digest(encoding?: BufferEncoding): Buffer | string {
    const out = Buffer.from(this.fn(Buffer.concat(this.chunks)));
    return encoding ? out.toString(encoding) : out;
  }
}

export function createHash(algorithm: string): Hash {
  const fn = HASHES[algorithm.toLowerCase() as keyof typeof HASHES];
  if (!fn) throw new Error(`Digest method not supported: ${algorithm}`);
  return new Hash(fn);
}

function scryptParams(keylen: number, opts: ScryptOptions = {}) {
  return {
    N: opts.N ?? opts.cost ?? 16384,
    r: opts.r ?? opts.blockSize ?? 8,
    p: opts.p ?? opts.parallelization ?? 1,
    dkLen: keylen,
    maxmem: opts.maxmem ?? 32 * 1024 * 1024 + 1024,
  };
}

export function scryptSync(password: BinaryLike, salt: BinaryLike, keylen: number, opts?: ScryptOptions): Buffer {
  return Buffer.from(nobleScrypt(bytes(password), bytes(salt), scryptParams(keylen, opts)));
}

export function scrypt(
  password: BinaryLike,
  salt: BinaryLike,
  keylen: number,
  opts: ScryptOptions | ((err: Error | null, key: Buffer) => void),
  cb?: (err: Error | null, key: Buffer) => void,
): void {
  const done = (typeof opts === 'function' ? opts : cb)!;
  const params = scryptParams(keylen, typeof opts === 'function' ? undefined : opts);
  // scryptAsync yields to the event loop as it goes, so a vault opening while
  // the user scrolls does not freeze the page the way the sync one would.
  scryptAsync(bytes(password), bytes(salt), { ...params, asyncTick: 10 }).then(
    (key) => done(null, Buffer.from(key)),
    (err) => done(err instanceof Error ? err : new Error(String(err)), Buffer.alloc(0)),
  );
}

const GCM = 'aes-256-gcm';

function checkGcm(algorithm: string, key: Uint8Array, opts?: { authTagLength?: number }): number {
  if (algorithm.toLowerCase() !== GCM) throw new Error(`Unsupported cipher: ${algorithm}`);
  if (key.length !== 32) throw new Error('Invalid key length');
  const tagLength = opts?.authTagLength ?? 16;
  if (tagLength !== 16) throw new Error(`Unsupported authTagLength: ${tagLength}`);
  return tagLength;
}

/**
 * AES-256-GCM, one shot: update() collects, final() seals. Node streams the
 * ciphertext out of update(), but every caller concatenates update() and
 * final(), so the bytes they end up with are the same.
 */
class Cipher {
  private readonly parts: Uint8Array[] = [];
  private aad: Uint8Array | undefined;
  private tag: Buffer | null = null;
  private readonly key: Uint8Array;
  private readonly iv: Uint8Array;
  constructor(key: Uint8Array, iv: Uint8Array) {
    this.key = key;
    this.iv = iv;
  }
  setAAD(aad: Uint8Array): this {
    this.aad = aad;
    return this;
  }
  update(data: BinaryLike, encoding?: BufferEncoding): Buffer {
    this.parts.push(bytes(data, encoding));
    return Buffer.alloc(0);
  }
  final(): Buffer {
    const sealed = gcm(this.key, this.iv, this.aad).encrypt(Buffer.concat(this.parts));
    this.tag = Buffer.from(sealed.subarray(sealed.length - 16));
    return Buffer.from(sealed.subarray(0, sealed.length - 16));
  }
  getAuthTag(): Buffer {
    if (!this.tag) throw new Error('Invalid state for operation getAuthTag');
    return this.tag;
  }
}

class Decipher {
  private readonly parts: Uint8Array[] = [];
  private aad: Uint8Array | undefined;
  private tag: Uint8Array | null = null;
  private readonly key: Uint8Array;
  private readonly iv: Uint8Array;
  private readonly tagLength: number;
  constructor(key: Uint8Array, iv: Uint8Array, tagLength: number) {
    this.key = key;
    this.iv = iv;
    this.tagLength = tagLength;
  }
  setAAD(aad: Uint8Array): this {
    this.aad = aad;
    return this;
  }
  setAuthTag(tag: Uint8Array): this {
    // Node refuses a tag of any other length once authTagLength is pinned.
    if (tag.length !== this.tagLength) throw new Error(`Invalid authentication tag length: ${tag.length}`);
    this.tag = tag;
    return this;
  }
  update(data: BinaryLike, encoding?: BufferEncoding): Buffer {
    this.parts.push(bytes(data, encoding));
    return Buffer.alloc(0);
  }
  final(): Buffer {
    if (!this.tag) throw new Error('Unsupported state or unable to authenticate data');
    try {
      return Buffer.from(gcm(this.key, this.iv, this.aad).decrypt(Buffer.concat([...this.parts, this.tag])));
    } catch {
      throw new Error('Unsupported state or unable to authenticate data');
    }
  }
}

export function createCipheriv(algorithm: string, key: Uint8Array, iv: Uint8Array, opts?: { authTagLength?: number }): Cipher {
  checkGcm(algorithm, key, opts);
  return new Cipher(key, iv);
}

export function createDecipheriv(algorithm: string, key: Uint8Array, iv: Uint8Array, opts?: { authTagLength?: number }): Decipher {
  return new Decipher(key, iv, checkGcm(algorithm, key, opts));
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) throw new RangeError('Input buffers must have the same byte length');
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export default { randomBytes, randomUUID, createHash, scryptSync, scrypt, createCipheriv, createDecipheriv, timingSafeEqual };
