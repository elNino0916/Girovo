import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ed25519 } from '@noble/curves/ed25519.js';
import { buildManifest, manifestText } from './update-manifest.mjs';
import { isEncrypted, makeKeyFile, openKeyFile } from './sign-update.mjs';
import { signManifest, toBase64, verifyManifest } from '../mobile/updates/update-trust.ts';

// The release side of docs/updater-v2.md: the manifest a release carries and
// the key file that signs it.

function releaseFolder(version, names) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'girovo-release-'));
  for (const name of names) fs.writeFileSync(path.join(dir, name), `contents of ${name}`);
  return dir;
}

test('the manifest lists the release files with sizes, hashes and addresses', () => {
  const v = '6.0.2';
  const dir = releaseFolder(v, [
    `Girovo-${v}-Setup.exe`, `Girovo-${v}-Setup.exe.blockmap`, `Girovo-${v}-x86_64.AppImage`,
    `Girovo-${v}-amd64.deb`, `Girovo-${v}-android.apk`, `Girovo-${v}-play.aab`, 'SHA256SUMS.txt',
  ]);
  const m = buildManifest({ dir, version: v, notes: '# Girovo 6.0.2\n', published: '2026-11-08T10:00:00.000Z' });
  assert.equal(m.format, 'girovo-update');
  assert.equal(m.build, 600020_000000000);
  assert.equal(m.channel, 'stable');
  assert.equal(m.page, 'https://github.com/elNino0916/Girovo/releases/tag/6.0.2');
  assert.deepEqual(m.files.map((f) => f.kind), ['setup', 'appimage', 'deb', 'apk'], 'the AAB and the sums stay out');
  const setup = m.files[0];
  const expected = crypto.createHash('sha256').update(`contents of Girovo-${v}-Setup.exe`).digest('hex');
  assert.equal(setup.sha256, expected);
  assert.equal(setup.size, `contents of Girovo-${v}-Setup.exe`.length);
  assert.equal(setup.url, `https://github.com/elNino0916/Girovo/releases/download/6.0.2/Girovo-${v}-Setup.exe`);
  assert.equal(setup.blockmap.name, `Girovo-${v}-Setup.exe.blockmap`);
  assert.equal(m.files[1].blockmap, undefined);
  assert.equal(m.notes, '# Girovo 6.0.2\n');
});

test('a nightly manifest is on the nightly channel and its tag is escaped in addresses', () => {
  const v = '6.0.2-nightly.202611081217.g1234567';
  const dir = releaseFolder(v, [`Girovo-${v}-Setup.exe`]);
  const m = buildManifest({ dir, version: v });
  assert.equal(m.channel, 'nightly');
  assert.ok(m.build > 600010_000000000 && m.build < 600020_000000000);
  assert.ok(m.files[0].url.includes(`/download/${v}/`));
});

test('the manifest refuses a version without a build number or a folder without files', () => {
  const dir = releaseFolder('6.0.2', ['Girovo-6.0.2-Setup.exe']);
  assert.throws(() => buildManifest({ dir, version: '6.0.2-rc.1' }), /no build number/);
  assert.throws(() => buildManifest({ dir: releaseFolder('6.0.3', ['readme.txt']), version: '6.0.3' }), /no release files/);
});

test('the signed bytes are exactly the file written', () => {
  const dir = releaseFolder('6.0.2', ['Girovo-6.0.2-android.apk']);
  const text = manifestText(buildManifest({ dir, version: '6.0.2', published: '2026-11-08T10:00:00.000Z' }));
  const secret = ed25519.utils.randomSecretKey();
  const keys = { stable: toBase64(ed25519.getPublicKey(secret)), nightly: '' };
  const bytes = new TextEncoder().encode(text);
  assert.equal(verifyManifest(bytes, signManifest(bytes, secret), keys), 'stable');
  assert.ok(text.endsWith('}\n'));
});

test('an encrypted key file opens only with its password', () => {
  const secret = ed25519.utils.randomSecretKey();
  const file = JSON.parse(JSON.stringify(makeKeyFile(secret, 'correct horse battery')));
  assert.equal(isEncrypted(file), true);
  assert.equal(JSON.stringify(file).includes(toBase64(secret)), false, 'the secret is not in the file');
  assert.deepEqual(openKeyFile(file, 'correct horse battery'), secret);
  assert.throws(() => openKeyFile(file, 'wrong'), /wrong password/);
  assert.throws(() => openKeyFile({ ...file, publicKey: toBase64(ed25519.getPublicKey(ed25519.utils.randomSecretKey())) }, 'correct horse battery'), /does not hold/);
});

test('a plain key file (the nightly secret) opens without a password', () => {
  const secret = ed25519.utils.randomSecretKey();
  const file = makeKeyFile(secret, null);
  assert.equal(isEncrypted(file), false);
  assert.deepEqual(openKeyFile(file, null), secret);
  assert.throws(() => openKeyFile({ format: 'other' }, null), /not a Girovo update key/);
});
