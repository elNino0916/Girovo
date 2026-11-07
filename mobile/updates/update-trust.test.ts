import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ed25519 } from '@noble/curves/ed25519.js';
import { buildNumber, keyId, signManifest, signerFits, toBase64, verifyManifest } from './update-trust.ts';

// The order updates come in and what a signature has to be. The desktop
// updater's Rust copy (src-tauri/src/updater/trust.rs) is tested against the
// same numbers.

test('build numbers order releases, previews and nightlies', () => {
  const ordered = [
    '5.16.2',
    '6.0.0-preview.1',
    '6.0.0-preview.12',
    '6.0.0-preview.202611031200.ge9d8b1b',
    '6.0.0-nightly.202611071159.g80ace0e',
    '6.0.0-preview.202611071208.gef82cf6',
    '6.0.0',
    '6.0.1-nightly.202611071700.gabcdef0',
    '6.0.1',
    '6.0.2-nightly.202611071832.gc0d6b0c',
    '6.0.2-nightly.202611081217.g1234567',
    '6.0.2',
    '6.1.0',
    '7.0.0',
  ];
  const builds = ordered.map(buildNumber);
  assert.ok(builds.every((b) => typeof b === 'number'), String(builds));
  for (let i = 1; i < builds.length; i++) assert.ok(builds[i] > builds[i - 1], `${ordered[i]} after ${ordered[i - 1]}`);
});

test('build numbers stay exact integers', () => {
  assert.equal(buildNumber('6.0.2'), 600020_000000000);
  assert.equal(buildNumber('6.0.2-nightly.202611071832.gc0d6b0c'), 600019_000000000 + 447512);
  assert.equal(buildNumber('6.0.0-preview.3'), 599999_000000003);
  assert.ok(Number.isSafeInteger(buildNumber('89.99.99')!));
  assert.equal(buildNumber('99.99.99'), null, 'past what a double holds exactly');
});

test('development builds count as their version, unknown names count as nothing', () => {
  assert.equal(buildNumber('6.0.2-dev.41'), buildNumber('6.0.2'));
  assert.equal(buildNumber('6.0.0-preview.3-dev.7'), buildNumber('6.0.0-preview.3'));
  for (const v of ['6.0.0-rc.1', '6.0.0-beta', '6.0.0-preview.100', '6.0.0-nightly.2026110718', '6.0.0-nightly.202613071832', 'six', '', '6.0']) {
    assert.equal(buildNumber(v), null, v);
  }
  assert.equal(buildNumber(undefined as unknown as string), null);
});

const pair = () => {
  const secret = ed25519.utils.randomSecretKey();
  return { secret, pub: toBase64(ed25519.getPublicKey(secret)) };
};

test('a signature names its key and verifies only with it', () => {
  const stable = pair();
  const nightly = pair();
  const keys = { stable: stable.pub, nightly: nightly.pub };
  const bytes = new TextEncoder().encode('{"version":"6.0.2"}\n');

  const byStable = signManifest(bytes, stable.secret);
  assert.equal(JSON.parse(byStable).key, keyId(ed25519.getPublicKey(stable.secret)));
  assert.equal(verifyManifest(bytes, byStable, keys), 'stable');
  assert.equal(verifyManifest(bytes, signManifest(bytes, nightly.secret), keys), 'nightly');
  assert.equal(verifyManifest(bytes, signManifest(bytes, pair().secret), keys), null, 'a stranger’s key');
});

test('a changed manifest or a damaged signature fails', () => {
  const stable = pair();
  const keys = { stable: stable.pub, nightly: '' };
  const bytes = new TextEncoder().encode('{"version":"6.0.2"}\n');
  const sig = signManifest(bytes, stable.secret);
  assert.equal(verifyManifest(new TextEncoder().encode('{"version":"6.0.3"}\n'), sig, keys), null);

  const parsed = JSON.parse(sig);
  const flipped = Buffer.from(parsed.sig, 'base64');
  flipped[5] ^= 1;
  for (const bad of [
    JSON.stringify({ ...parsed, sig: flipped.toString('base64') }),
    JSON.stringify({ ...parsed, sig: 'AAAA' }),
    JSON.stringify({ ...parsed, format: 'other' }),
    JSON.stringify({ ...parsed, v: 2 }),
    JSON.stringify({ ...parsed, key: '0000000000000000' }),
    'not json',
    '',
  ]) {
    assert.equal(verifyManifest(bytes, bad, keys), null, bad.slice(0, 40));
  }
});

test('empty keys trust nothing', () => {
  const someone = pair();
  const bytes = new TextEncoder().encode('x');
  assert.equal(verifyManifest(bytes, signManifest(bytes, someone.secret), { stable: '', nightly: '' }), null);
});

test('the signature covers a prefix, so the bare bytes signed elsewhere do not count', () => {
  const stable = pair();
  const bytes = new TextEncoder().encode('{"version":"6.0.2"}\n');
  const bare = toBase64(ed25519.sign(bytes, stable.secret));
  const sig = JSON.stringify({ format: 'girovo-update-sig', v: 1, key: keyId(ed25519.getPublicKey(stable.secret)), sig: bare });
  assert.equal(verifyManifest(bytes, sig, { stable: stable.pub, nightly: '' }), null);
});

test('which signer a channel takes', () => {
  assert.equal(signerFits('stable', 'stable'), true);
  assert.equal(signerFits('stable', 'nightly'), true);
  assert.equal(signerFits('nightly', 'nightly'), true);
  assert.equal(signerFits('nightly', 'stable'), false);
  assert.equal(signerFits(null, 'nightly'), false);
});
