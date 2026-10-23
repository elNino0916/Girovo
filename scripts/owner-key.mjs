// Girovo Plus owner keys (docs/plus-plan.md): Plus on one installation of the
// Google Play build without a purchase — for the developer's own phone, so
// the owner neither pays for their own app nor runs test subscriptions.
//
//   npm run owner-key -- init             makes the key pair, once; prints the
//                                         public key for PlusPlugin.java
//   npm run owner-key -- <installation>   the key for that installation (the
//                                         Plus screen: tap its plate 7 times)
//
// The private key lives beside the release keystore (android/keystore.properties,
// storeFile) as girovo-owner.pem — never in this repository. Elsewhere:
// --key <file> or GIROVO_OWNER_KEY.
//
// A key is an ECDSA P-256 signature (SHA-256, DER) over
// "girovo-plus-owner:<installation>", written "GPO1." + base64url.
// PlusPlugin.java (src/play) checks it against the public key it carries.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = path.join(ROOT, 'android/app/src/play/java/de/elnino0916/android/girovo/PlusPlugin.java');
const MESSAGE = 'girovo-plus-owner:';
const PREFIX = 'GPO1.';

const fail = (text) => {
  console.error(text);
  process.exit(1);
};

/** --key, GIROVO_OWNER_KEY, or girovo-owner.pem beside the release keystore. */
function keyPath(args) {
  const flag = args.indexOf('--key');
  if (flag >= 0 && args[flag + 1]) return path.resolve(args[flag + 1]);
  if (process.env.GIROVO_OWNER_KEY) return path.resolve(process.env.GIROVO_OWNER_KEY);
  const props = path.join(ROOT, 'android/keystore.properties');
  if (!fs.existsSync(props)) fail('No android/keystore.properties: name the key with --key <file> or GIROVO_OWNER_KEY.');
  // Only the storeFile line is read; Java's property escapes ("C\:\\Keys") undone.
  const line = fs.readFileSync(props, 'utf8').split(/\r?\n/).find((l) => /^\s*storeFile\s*[=:]/.test(l));
  if (!line) fail('android/keystore.properties names no storeFile: use --key <file>.');
  const store = line.replace(/^\s*storeFile\s*[=:]\s*/, '').trim().replace(/\\(.)/g, '$1');
  // Gradle resolves storeFile against android/ (rootProject.file).
  return path.join(path.dirname(path.resolve(ROOT, 'android', store)), 'girovo-owner.pem');
}

/** The installation as the phone shows it: Crockford's base32, 4-4-4, read leniently. */
function installation(raw) {
  const s = raw.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (!/^[0-9A-HJKMNP-TV-Z]{12}$/.test(s)) fail(`"${raw}" is not an installation ID (12 characters, as the phone shows it).`);
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

/** The public key PlusPlugin.java carries, to catch a key made with another pair. */
function pluginKey() {
  const m = /OWNER_PUBLIC_KEY\s*=\s*"([^"]*)"/.exec(fs.readFileSync(PLUGIN, 'utf8'));
  return m ? m[1] : '';
}

const args = process.argv.slice(2);
const file = keyPath(args);
// The ID as the phone shows it, also typed with spaces ("K7Q2 9XMA 4HTB").
const what = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--key').join('');

if (what === 'init') {
  if (fs.existsSync(file)) fail(`${file} exists already: one pair, or every key made so far stops working.`);
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  fs.writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
  console.log(`Private key: ${file} (keep it with the keystore, never commit it)`);
  console.log('Public key for PlusPlugin.java, OWNER_PUBLIC_KEY:');
  console.log(publicKey.export({ type: 'spki', format: 'der' }).toString('base64'));
} else if (what) {
  if (!fs.existsSync(file)) fail(`No private key at ${file}: run "npm run owner-key -- init" first, or name it with --key.`);
  const id = installation(what);
  const privateKey = crypto.createPrivateKey(fs.readFileSync(file));
  const publicKey = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64');
  if (publicKey !== pluginKey()) fail('This private key does not belong to the public key in PlusPlugin.java: the app would refuse its keys.');
  const signature = crypto.sign('sha256', Buffer.from(MESSAGE + id, 'utf8'), { key: privateKey, dsaEncoding: 'der' });
  console.log(`Key for ${id}:`);
  console.log(PREFIX + signature.toString('base64url'));
} else {
  fail('Usage: npm run owner-key -- init | <installation ID> [--key <file>]');
}
