// Girovo's update signing keys and signatures (docs/updater-v2.md,
// docs/update-channels.md).
//
//   node scripts/sign-update.mjs keygen <key file>            password-protected (the stable key)
//   node scripts/sign-update.mjs keygen <key file> --plain    no password (the nightly key, for the Actions secret)
//   node scripts/sign-update.mjs sign <file> --key <key file>
//   node scripts/sign-update.mjs sign <file> --key-env GIROVO_NIGHTLY_SIGNING_KEY
//   node scripts/sign-update.mjs verify <file>                against mobile/updates/update-keys.ts
//   node scripts/sign-update.mjs sign-channels <list.json> --key <stable key file> [--out <file>]
//   node scripts/sign-update.mjs verify-channels <channels.json>
//
// `sign` writes <file>.sig. `sign-channels` checks a channel list against the
// rules the apps read it by, refuses any key but the stable key built into
// the app, and writes the envelope girovo.de serves (channels.json beside
// the list unless --out names another file). A password is only ever read from the terminal,
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
import {
  PLATFORMS,
  channelsFor,
  keyId,
  readChannelList,
  signChannelList,
  signManifest,
  toBase64,
  verifiedListText,
  verifyManifest,
} from '../mobile/updates/update-trust.ts';
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

/** What a list read says about one entry, for the terminal. */
function describeChannel(c) {
  const marks = [c.hidden && 'hidden', c.ended && `ended, then ${c.then}`, !c.usage && 'no usage data'].filter(Boolean);
  return `${c.id} [${c.keys.join(', ')}]${marks.length ? ` (${marks.join('; ')})` : ''}`;
}

/** The channels of a list read, per platform, as `verify-channels` prints them. */
export function channelsByPlatform(read) {
  return Object.fromEntries(PLATFORMS.map((platform) => [platform, channelsFor(read, platform)]));
}

/**
 * Signs the channel list at `listPath` with the key file at `keyPath` and
 * writes the envelope to `out` (default: channels.json beside the list).
 * Refuses a list the apps would not read whole (an entry dropped, or more
 * than they count), and any key but `keys.stable`, before a password is
 * asked. Returns the path written and the list as read.
 */
export async function signChannels({ listPath, keyPath, out, keys = TRUSTED_KEYS, ask = askHidden }) {
  const text = fs.readFileSync(listPath, 'utf8');
  const read = readChannelList(text);
  if (!read) throw new Error(`${listPath}: not a channel list (format girovo-channel-list, v 1, a serial of at least 1, channels)`);
  if (read.dropped.length) {
    const why = read.dropped.map((d) => `entry ${d.index + 1}${typeof d.id === 'string' ? ` (${d.id})` : ''}: ${d.reason}`);
    throw new Error(`${listPath}: the apps would drop ${why.join('; ')}`);
  }
  const keyFile = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  if (!keys.stable || keyFile?.publicKey !== keys.stable) throw new Error('the channel list is signed with the stable key built into the app, and this is another key');
  const password = isEncrypted(keyFile) ? await ask('Password for the stable key: ') : null;
  const secretKey = openKeyFile(keyFile, password);
  const envelope = signChannelList(text, secretKey);
  if (verifiedListText(envelope, keys) !== text) throw new Error('the signed list does not check out');
  const target = out ?? path.join(path.dirname(listPath), 'channels.json');
  if (path.resolve(target) === path.resolve(listPath)) throw new Error('the envelope would overwrite the list: name another file with --out');
  fs.writeFileSync(target, envelope);
  return { out: target, read };
}

/** The list in the envelope at `file`, checked against `keys` (the stable key alone); throws when it doesn't check out. */
export function verifyChannelsFile(file, keys = TRUSTED_KEYS) {
  const text = verifiedListText(fs.readFileSync(file, 'utf8'), keys);
  if (text == null) throw new Error(`${file}: no channel list signed with Girovo's stable key`);
  const read = readChannelList(text);
  if (!read) throw new Error(`${file}: signed, but no channel list the apps could read`);
  return read;
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
  if (command === 'sign-channels' && file) {
    const keyPath = arg(args, '--key');
    if (!keyPath) throw new Error('give the stable key with --key <file>');
    const { out, read } = await signChannels({ listPath: file, keyPath, out: arg(args, '--out') ?? undefined });
    console.log(`› ${out}  (serial ${read.serial}, ${read.channels.length} channels, key ${keyId(fromBase64(TRUSTED_KEYS.stable))})`);
    return;
  }
  if (command === 'verify-channels' && file) {
    const read = verifyChannelsFile(file);
    console.log(`✓ ${file}: signed with the stable key, serial ${read.serial}`);
    for (const [platform, channels] of Object.entries(channelsByPlatform(read))) {
      console.log(`  ${platform.padEnd(8)} ${channels.length ? channels.map(describeChannel).join(', ') : '(none)'}`);
    }
    if (read.dropped.length) console.log(`  dropped  ${read.dropped.map((d) => `${String(d.id)} (${d.reason})`).join(', ')}`);
    return;
  }
  console.error('usage: node scripts/sign-update.mjs keygen <key file> [--plain] | sign <file> --key <key file> | --key-env NAME | verify <file>'
    + ' | sign-channels <list.json> --key <key file> [--out file] | verify-channels <channels.json>');
  process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  });
}
