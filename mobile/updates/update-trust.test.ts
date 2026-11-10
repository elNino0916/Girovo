import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ed25519 } from '@noble/curves/ed25519.js';
import { bucket, buildNumber, keyId, parseListing, pickListed, reaches, releaseOf, signManifest, signerFits, toBase64, verifyManifest } from './update-trust.ts';

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

// ---- girovo.de's listing and the release it offers ----

const sha = (n: string) => n.repeat(64).slice(0, 64);

function manifestText(version: string, extra: Record<string, unknown> = {}) {
  const apk = `Girovo-${version}-android.apk`;
  return `${JSON.stringify({
    format: 'girovo-update', v: 1, version, build: buildNumber(version),
    channel: version.includes('-') ? 'nightly' : 'stable',
    page: `https://github.com/elNino0916/Girovo/releases/tag/${version}`,
    published: '2026-11-08T10:00:00.000Z',
    files: [{ kind: 'apk', name: apk, size: 5000, sha256: sha('a'), url: `https://github.com/elNino0916/Girovo/releases/download/${version}/${apk}` }],
    notes: '# Girovo',
    ...extra,
  }, null, 2)}\n`;
}

test('a manifest becomes the release the updater works with', () => {
  const r = releaseOf(manifestText('6.0.2'))!;
  assert.equal(r.version, '6.0.2');
  assert.equal(r.name, 'Girovo 6.0.2');
  assert.equal(r.url, 'https://github.com/elNino0916/Girovo/releases/tag/6.0.2');
  assert.equal(r.publishedAt, '2026-11-08T10:00:00.000Z');
  assert.deepEqual(r.assets.map((a) => [a.name, a.sha256]), [['Girovo-6.0.2-android.apk', sha('a')]]);
});

test('a manifest that does not add up is refused', () => {
  assert.equal(releaseOf(manifestText('6.0.2', { build: 1 })), null, 'a build number that is not its version’s');
  assert.equal(releaseOf(manifestText('6.0.2').replace('github.com/elNino0916/Girovo/releases/download', 'example.com/x')), null, 'a file outside the downloads');
  assert.equal(releaseOf(manifestText('6.0.2').replace(sha('a'), 'nope')), null, 'a file without a hash');
  assert.equal(releaseOf(manifestText('6.0.2', { format: 'other' })), null);
  assert.equal(releaseOf('not json'), null);
});

test('a manifest\'s build is a number: none, null or text is refused', () => {
  // A version without a build number: its manifest says "build": null, and null is not that number.
  assert.equal(buildNumber('6.0.3-rc.1'), null);
  assert.match(manifestText('6.0.3-rc.1'), /"build": null/);
  assert.equal(releaseOf(manifestText('6.0.3-rc.1')), null);
  assert.equal(releaseOf(manifestText('6.0.2', { build: null })), null);
  assert.equal(releaseOf(manifestText('6.0.2', { build: undefined })), null, 'no build at all');
  assert.equal(releaseOf(manifestText('6.0.2', { build: String(buildNumber('6.0.2')) })), null, 'a number written as text');
  assert.equal(releaseOf(manifestText('6.0.2', { build: 600020_000000000.5 })), null);
  assert.equal(releaseOf(manifestText('6.0.2', { build: buildNumber('6.0.2') }))?.version, '6.0.2');
});

test('girovo.de’s answer is read, anything else refused', () => {
  const list = parseListing({ format: 'girovo-updates', v: 1, releases: [
    { version: '6.0.3', rollout: 20, manifest: 'm', sig: 's' },
    { version: '6.0.2', manifest: 'm2', sig: 's2' },
    { version: 'broken' },
  ] })!;
  assert.deepEqual(list.map((l) => [l.version, l.rollout]), [['6.0.3', 20], ['6.0.2', 100]]);
  assert.equal(parseListing({ format: 'other', v: 1, releases: [] }), null);
  assert.equal(parseListing(null), null);
});

test('buckets match the desktop’s (src-tauri/src/updater/trust.rs)', () => {
  assert.equal(bucket('install-a', '9.9.9'), 88);
  assert.equal(bucket('install-a', '6.0.3'), 91);
  assert.equal(bucket('x', '6.0.2'), 53);
  assert.ok(reaches(20, 19, false) && !reaches(20, 20, false));
  assert.ok(reaches(0, 0, true), 'early takes everything');
});

test('the first listed release that is signed, fitting and reaching is offered', () => {
  const stable = pair();
  const nightly = pair();
  const keys = { stable: stable.pub, nightly: nightly.pub };
  const listed = (version: string, rollout: number, secret: Uint8Array) => {
    const manifest = manifestText(version);
    return { version, rollout, manifest, sig: signManifest(new TextEncoder().encode(manifest), secret) };
  };
  const pick = (list: ReturnType<typeof listed>[], channel: 'stable' | 'nightly', early = false) => pickListed(list, channel, keys, 'install-a', early)?.version ?? null;

  assert.equal(pick([listed('6.0.2', 100, stable.secret)], 'stable'), '6.0.2');
  assert.equal(pick([listed('6.0.2', 100, nightly.secret)], 'stable'), null, 'the nightly key can’t sign a stable release');
  assert.equal(pick([listed('6.0.2', 100, nightly.secret)], 'nightly'), '6.0.2');
  assert.equal(pick([listed('6.0.2', 100, pair().secret)], 'stable'), null);

  const b = bucket('install-a', '6.0.3');
  const staged = [listed('6.0.3', b, stable.secret), listed('6.0.2', 100, stable.secret)];
  assert.equal(pick(staged, 'stable'), '6.0.2');
  assert.equal(pick(staged, 'stable', true), '6.0.3');
  assert.equal(pick([listed('6.0.3', b + 1, stable.secret), listed('6.0.2', 100, stable.secret)], 'stable'), '6.0.3');

  const lying = { ...listed('6.0.3', 100, stable.secret), version: '6.0.4' };
  assert.equal(pick([lying, listed('6.0.2', 100, stable.secret)], 'stable'), '6.0.2');
});
