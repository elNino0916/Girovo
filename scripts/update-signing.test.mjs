import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ed25519 } from '@noble/curves/ed25519.js';
import { buildManifest, channelFor, manifestText } from './update-manifest.mjs';
import { channelsByPlatform, isEncrypted, makeKeyFile, openKeyFile, signChannels, verifyChannelsFile } from './sign-update.mjs';
import { signManifest, toBase64, verifyChannels, verifyManifest } from '../mobile/updates/update-trust.ts';

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

test('the manifest names its channel: next, nightly or stable by the version, or the one given', () => {
  assert.equal(channelFor('6.2.0'), 'stable');
  assert.equal(channelFor('6.2.0-nightly.202611111200.gabcdef0'), 'nightly');
  assert.equal(channelFor('6.0.0-preview.3'), 'nightly');
  assert.equal(channelFor('6.2.0-next.202611111200.gabcdef0'), 'next');
  const v = '6.2.0-next.202611111200.gabcdef0';
  const dir = releaseFolder(v, [`Girovo-${v}-Setup.exe`]);
  assert.equal(buildManifest({ dir, version: v }).channel, 'next');
  assert.equal(buildManifest({ dir, version: v, channel: 'api' }).channel, 'api');
  assert.equal(buildManifest({ dir, version: v, channel: 'nightly' }).channel, 'nightly');
  for (const bad of ['preview', 'Next', 'n', 'abcdefghijklmnopq', 'ne xt', '', null, 7]) {
    assert.throws(() => buildManifest({ dir, version: v, channel: bad }), /no channel name/, String(bad));
  }
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

// ---- the channel list ----

/** The test key [1; 32] (mobile/updates/__fixtures__/channels-test.json), the stable key here. */
const TEST_SECRET = new Uint8Array(32).fill(1);
const TEST_KEYS = { stable: 'iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w=', nightly: '' };
const LIST = {
  format: 'girovo-channel-list',
  v: 1,
  serial: 2,
  channels: [
    { id: 'next', keys: ['stable', 'next'], hidden: true, name: { de: 'Next', en: 'Next' } },
    { id: 'api', keys: ['reserve1'], usage: false, platforms: ['desktop', 'apk'], name: { de: 'API-Test', en: 'API test' } },
  ],
};

function listFolder(list = LIST, secret = TEST_SECRET) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'girovo-channels-'));
  const listPath = path.join(dir, 'list.json');
  const keyPath = path.join(dir, 'test.key');
  fs.writeFileSync(listPath, typeof list === 'string' ? list : `${JSON.stringify(list, null, 2)}\n`);
  fs.writeFileSync(keyPath, JSON.stringify(makeKeyFile(secret, null)));
  return { dir, listPath, keyPath };
}

const noPassword = async () => {
  throw new Error('no password was to be asked');
};

test('sign-channels and verify-channels: a round trip with the stable key', async () => {
  const { dir, listPath, keyPath } = listFolder();
  const { out, read } = await signChannels({ listPath, keyPath, keys: TEST_KEYS, ask: noPassword });
  assert.equal(out, path.join(dir, 'channels.json'), 'beside the list');
  assert.equal(read.serial, 2);
  const envelope = fs.readFileSync(out, 'utf8');
  assert.equal(JSON.parse(envelope).list, fs.readFileSync(listPath, 'utf8'), 'the list\'s bytes, signed as they are');
  assert.deepEqual(verifyChannels(envelope, TEST_KEYS, 'apk')?.channels.map((c) => c.id), ['api']);
  const again = verifyChannelsFile(out, TEST_KEYS);
  const byPlatform = channelsByPlatform(again);
  assert.deepEqual(byPlatform.desktop.map((c) => c.id), ['next', 'api']);
  assert.deepEqual(byPlatform.apk.map((c) => c.id), ['api']);
  assert.throws(() => verifyChannelsFile(out), /no channel list signed/, 'the built-in stable key did not sign it');

  const other = path.join(dir, 'elsewhere.json');
  assert.equal((await signChannels({ listPath, keyPath, out: other, keys: TEST_KEYS, ask: noPassword })).out, other);
  assert.ok(fs.existsSync(other));
});

test('sign-channels refuses any key but the stable key, before asking a password', async () => {
  const { listPath, keyPath } = listFolder(LIST, ed25519.utils.randomSecretKey());
  await assert.rejects(signChannels({ listPath, keyPath, keys: TEST_KEYS, ask: noPassword }), /stable key built into the app/);
  const encrypted = listFolder();
  fs.writeFileSync(encrypted.keyPath, JSON.stringify(makeKeyFile(ed25519.utils.randomSecretKey(), 'correct horse battery')));
  await assert.rejects(signChannels({ ...encrypted, keys: TEST_KEYS, ask: noPassword }), /stable key built into the app/);
  assert.equal(fs.existsSync(path.join(encrypted.dir, 'channels.json')), false);
});

test('sign-channels refuses a list the apps would not read whole', async () => {
  const cases = [
    [{ ...LIST, serial: 0 }, /not a channel list/],
    [{ ...LIST, format: 'other' }, /not a channel list/],
    ['not json', /not a channel list/],
    [{ ...LIST, channels: [...LIST.channels, { id: 'Bad', keys: ['stable'], name: { de: 'x', en: 'x' } }] }, /entry 3 \(Bad\): id/],
    [{ ...LIST, channels: [...LIST.channels, LIST.channels[1]] }, /duplicate id/],
    [{ ...LIST, channels: [{ ...LIST.channels[0], then: 'gone' }] }, /then/],
    [{ ...LIST, channels: Array.from({ length: 9 }, (_, i) => ({ ...LIST.channels[1], id: `c${i}x` })) }, /past the first 8/],
  ];
  for (const [list, why] of cases) {
    const { dir, listPath, keyPath } = listFolder(list);
    await assert.rejects(signChannels({ listPath, keyPath, keys: TEST_KEYS, ask: noPassword }), why, String(why));
    assert.equal(fs.existsSync(path.join(dir, 'channels.json')), false);
  }
  const { listPath, keyPath } = listFolder();
  await assert.rejects(signChannels({ listPath, keyPath, out: listPath, keys: TEST_KEYS, ask: noPassword }), /overwrite the list/);
});

test('the commands themselves: the built-in keys refuse a test key and the test file', () => {
  const script = fileURLToPath(new URL('./sign-update.mjs', import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  const { dir, listPath, keyPath } = listFolder();
  const signed = run('sign-channels', listPath, '--key', keyPath);
  assert.equal(signed.status, 1);
  assert.match(signed.stderr, /stable key built into the app/);
  assert.equal(fs.existsSync(path.join(dir, 'channels.json')), false);
  const fixture = fileURLToPath(new URL('../mobile/updates/__fixtures__/channels-test.json', import.meta.url));
  const verified = run('verify-channels', fixture);
  assert.equal(verified.status, 1);
  assert.match(verified.stderr, /no channel list signed with Girovo's stable key/);
  assert.equal(run('sign-channels', listPath).status, 1, 'no key given');
});
