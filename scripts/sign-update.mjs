// Girovo's update signing keys and signatures (docs/updater-v2.md).
//
//   node scripts/sign-update.mjs keygen <key file>            password-protected (the stable key)
//   node scripts/sign-update.mjs keygen <key file> --plain    no password (the nightly key, for the Actions secret)
//   node scripts/sign-update.mjs sign <file> --key <key file>
//   node scripts/sign-update.mjs sign <file> --key-env GIROVO_NIGHTLY_SIGNING_KEY
//   node scripts/sign-update.mjs verify <file>                against mobile/updates/update-keys.ts
//
// `sign` writes <file>.sig. A password is only ever read from the terminal,
// without echo — never from an argument or the environment — so it stays out
// of shell history and logs. The key file holds the 32-byte Ed25519 secret
// encrypted with AES-256-GCM under a scrypt key (N = 2^17, r = 8, p = 1).
// Losing the stable key or its password means a new key and a release that
// trusts it, signed with the old one: keep a copy of the file.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ed25519 } from '@noble/curves/ed25519.js';
import { gcm } from '@noble/ciphers/aes.js';
import { scrypt } from '@noble/hashes/scrypt.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { keyId, signManifest, toBase64, verifyManifest } from '../mobile/updates/update-trust.ts';
import { TRUSTED_KEYS } from '../mobile/updates/update-keys.ts';

export const KEY_FORMAT = 'girovo-update-key';
const KDF = { name: 'scrypt', N: 2 ** 17, r: 8, p: 1 };
const fromBase64 = (text) => new Uint8Array(Buffer.from(text, 'base64'));

/** A new key file's object: encrypted under `password`, or plain when it is null. */
export function makeKeyFile(secretKey, password) {
  const publicKey = toBase64(ed25519.getPublicKey(secretKey));
  if (password == null) return { format: KEY_FORMAT, v: 1, publicKey, secretKey: toBase64(secretKey) };
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const key = scrypt(password, salt, { N: KDF.N, r: KDF.r, p: KDF.p, dkLen: 32 });
  const ciphertext = gcm(key, nonce).encrypt(secretKey);
  return {
    format: KEY_FORMAT,
    v: 1,
    publicKey,
    kdf: { ...KDF, salt: toBase64(salt) },
    nonce: toBase64(nonce),
    ciphertext: toBase64(ciphertext),
  };
}

export const isEncrypted = (keyFile) => typeof keyFile?.ciphertext === 'string';

/** The secret key of a key file object; throws on a wrong password or a damaged file. */
export function openKeyFile(keyFile, password) {
  if (keyFile?.format !== KEY_FORMAT || keyFile.v !== 1) throw new Error('not a Girovo update key');
  let secretKey;
  if (isEncrypted(keyFile)) {
    const { N, r, p, salt } = keyFile.kdf ?? {};
    const key = scrypt(password ?? '', fromBase64(salt), { N, r, p, dkLen: 32 });
    try {
      secretKey = gcm(key, fromBase64(keyFile.nonce)).decrypt(fromBase64(keyFile.ciphertext));
    } catch {
      throw new Error('wrong password, or the key file is damaged');
    }
  } else {
    secretKey = fromBase64(keyFile.secretKey ?? '');
  }
  if (secretKey.length !== 32 || toBase64(ed25519.getPublicKey(secretKey)) !== keyFile.publicKey) {
    throw new Error('the key file does not hold the key it names');
  }
  return secretKey;
}

/** Asks for a line on the terminal without showing what is typed. */
function askHidden(question) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new Error('the password is only read from a terminal'));
      return;
    }
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let text = '';
    const cleanup = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
    };
    function onData(chunk) {
      for (const c of chunk) {
        if (c === '\r' || c === '\n') {
          cleanup();
          resolve(text);
          return;
        }
        if (c === '\u0003') {
          cleanup();
          reject(new Error('cancelled'));
          return;
        }
        if (c === '\u007f' || c === '\b') text = text.slice(0, -1);
        else text += c;
      }
    }
    stdin.on('data', onData);
  });
}

function arg(args, name) {
  const at = args.indexOf(name);
  return at === -1 ? null : args[at + 1];
}

async function main(args) {
  const [command, file] = args;
  if (command === 'keygen' && file) {
    if (fs.existsSync(file)) throw new Error(`${file} exists already; a key is never overwritten`);
    let password = null;
    if (!args.includes('--plain')) {
      password = await askHidden('Password for the new key: ');
      if (password.length < 12) throw new Error('use at least 12 characters');
      if ((await askHidden('Same password again: ')) !== password) throw new Error('the passwords differ');
    }
    const keyFile = makeKeyFile(ed25519.utils.randomSecretKey(), password);
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(keyFile, null, 2)}\n`, { flag: 'wx' });
    console.log(`› ${file}${password == null ? '  (no password: for the Actions secret)' : ''}`);
    console.log(`  public key ${keyFile.publicKey}`);
    console.log(`  key id     ${keyId(fromBase64(keyFile.publicKey))}`);
    return;
  }
  if (command === 'sign' && file) {
    const keyPath = arg(args, '--key');
    const keyEnv = arg(args, '--key-env');
    const text = keyPath ? fs.readFileSync(keyPath, 'utf8') : keyEnv ? process.env[keyEnv] : null;
    if (!text) throw new Error('give the key with --key <file> or --key-env <NAME>');
    const keyFile = JSON.parse(text);
    const password = isEncrypted(keyFile) ? await askHidden('Password for the signing key: ') : null;
    const secretKey = openKeyFile(keyFile, password);
    fs.writeFileSync(`${file}.sig`, signManifest(fs.readFileSync(file), secretKey));
    console.log(`› ${file}.sig  (key ${keyId(fromBase64(keyFile.publicKey))})`);
    return;
  }
  if (command === 'verify' && file) {
    const signer = verifyManifest(fs.readFileSync(file), fs.readFileSync(`${file}.sig`, 'utf8'), TRUSTED_KEYS);
    if (!signer) throw new Error(`${file}: no valid signature by Girovo's keys`);
    console.log(`✓ ${file}: signed with the ${signer} key`);
    return;
  }
  console.error('usage: node scripts/sign-update.mjs keygen <key file> [--plain] | sign <file> --key <key file> | --key-env NAME | verify <file>');
  process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  });
}
