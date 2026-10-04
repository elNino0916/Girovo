'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const logic = require('./update-logic.cjs');

const DIGEST = 'sha256:' + 'ab'.repeat(32);
const asset = (name, extra = {}) => ({
  name,
  size: 104_919_142,
  digest: DIGEST,
  browser_download_url: `${logic.DOWNLOAD_PREFIX}4.1.0/${name}`,
  ...extra,
});
const release = (extra = {}) => ({
  tag_name: '4.1.0',
  name: '4.1.0',
  draft: false,
  prerelease: false,
  body: '## Neu\n- Updates in der App',
  html_url: `${logic.RELEASES_PAGE}/tag/4.1.0`,
  published_at: '2026-10-10T12:00:00Z',
  assets: [asset('Sooskasse-FinTS-4.1.0-Setup.exe'), asset('Sooskasse-FinTS-4.1.0-portable.exe')],
  ...extra,
});

test('isNewer: plain releases compare by semver', () => {
  assert.equal(logic.isNewer('4.1.0', '4.0.0'), true);
  assert.equal(logic.isNewer('v4.0.1', '4.0.0'), true);
  assert.equal(logic.isNewer('5.0.0', '4.12.3'), true);
  assert.equal(logic.isNewer('4.0.10', '4.0.9'), true);
  assert.equal(logic.isNewer('4.0.0', '4.0.0'), false);
  assert.equal(logic.isNewer('3.1.3', '4.0.0'), false);
});

test('isNewer: a dev build is newer than the release it was numbered after', () => {
  // CI builds from main after 4.0.0 are 4.0.0-dev.N: 4.0.0 is not an update for them.
  assert.equal(logic.isNewer('4.0.0', '4.0.0-dev.57'), false);
  assert.equal(logic.isNewer('4.0.1', '4.0.0-dev.57'), true);
  // Any other pre-release comes before its release.
  assert.equal(logic.isNewer('4.1.0', '4.1.0-beta.2'), true);
});

test('isNewer: pre-releases and garbage are never offered', () => {
  assert.equal(logic.isNewer('4.2.0-beta.1', '4.0.0'), false);
  assert.equal(logic.isNewer('latest', '4.0.0'), false);
  assert.equal(logic.isNewer('', '4.0.0'), false);
  assert.equal(logic.isNewer('4.1', '4.0.0'), false);
  assert.equal(logic.isNewer('4.1.0', 'nonsense'), false);
});

test('parseRelease keeps what the updater needs', () => {
  const r = logic.parseRelease(release());
  assert.equal(r.version, '4.1.0');
  assert.equal(r.url, `${logic.RELEASES_PAGE}/tag/4.1.0`);
  assert.equal(r.publishedAt, '2026-10-10T12:00:00.000Z');
  assert.equal(r.assets.length, 2);
  assert.deepEqual(r.assets[0], {
    name: 'Sooskasse-FinTS-4.1.0-Setup.exe',
    url: `${logic.DOWNLOAD_PREFIX}4.1.0/Sooskasse-FinTS-4.1.0-Setup.exe`,
    size: 104_919_142,
    sha256: 'ab'.repeat(32),
  });
  assert.equal(logic.parseRelease(release({ tag_name: 'v4.1.0' })).version, '4.1.0');
});

test('parseRelease refuses drafts, pre-releases and non-versions', () => {
  assert.equal(logic.parseRelease(release({ draft: true })), null);
  assert.equal(logic.parseRelease(release({ prerelease: true })), null);
  assert.equal(logic.parseRelease(release({ tag_name: '4.1.0-rc.1' })), null);
  assert.equal(logic.parseRelease(release({ tag_name: 'nightly' })), null);
  assert.equal(logic.parseRelease(null), null);
  assert.equal(logic.parseRelease('{"tag_name":"4.1.0"}'), null);
});

test('parseRelease drops files it could not check or place safely', () => {
  const r = logic.parseRelease(release({
    assets: [
      asset('Sooskasse-FinTS-4.1.0-Setup.exe', { browser_download_url: 'https://example.com/Setup.exe' }),
      asset('..\\..\\evil-Setup.exe'),
      asset('sub/dir-Setup.exe'),
      asset('Sooskasse-FinTS-4.1.0-Setup.exe', { size: 0 }),
      asset('Sooskasse-FinTS-4.1.0-Setup.exe', { size: 5 * 1024 ** 3 }),
      asset('Sooskasse-FinTS-4.1.0-portable.exe', { digest: null }),
    ],
  }));
  assert.equal(r.assets.length, 1);
  // Kept, but without a digest: offered as a download page only.
  assert.equal(r.assets[0].name, 'Sooskasse-FinTS-4.1.0-portable.exe');
  assert.equal(r.assets[0].sha256, null);
});

test('parseRelease: a foreign release page link falls back to the releases list', () => {
  assert.equal(logic.parseRelease(release({ html_url: 'https://evil.example/tag/4.1.0' })).url, logic.RELEASES_PAGE);
});

test('parseRelease caps the release notes', () => {
  const r = logic.parseRelease(release({ body: 'x'.repeat(50_000) }));
  assert.equal(r.notes.length, logic.MAX_NOTES_CHARS);
});

test('pickAsset finds the file for each kind of install', () => {
  const r = logic.parseRelease(release());
  assert.equal(logic.pickAsset(r, 'nsis').name, 'Sooskasse-FinTS-4.1.0-Setup.exe');
  assert.equal(logic.pickAsset(r, 'portable').name, 'Sooskasse-FinTS-4.1.0-portable.exe');
  assert.equal(logic.pickAsset(r, 'manual'), null);
  assert.equal(logic.pickAsset(r, 'dev'), null);
});

test('installKind tells the installed, portable and unpacked builds apart', () => {
  const execPath = 'C:\\Users\\max\\AppData\\Local\\Programs\\Sooskasse-FinTS\\Sooskasse-FinTS.exe';
  const uninstaller = path.join(path.dirname(execPath), 'Uninstall Sooskasse-FinTS.exe');
  const base = { isPackaged: true, env: {}, execPath, exists: (f) => f === uninstaller };
  assert.equal(logic.installKind(base), 'nsis');
  assert.equal(logic.installKind({ ...base, exists: () => false }), 'manual');
  assert.equal(logic.installKind({ ...base, env: { PORTABLE_EXECUTABLE_FILE: 'D:\\Sooskasse-FinTS-4.0.0-portable.exe' } }), 'portable');
  assert.equal(logic.installKind({ ...base, isPackaged: false }), 'dev');
});

test('installArgs: silent and restarting for the installer, nothing for the rest', () => {
  assert.deepEqual(logic.installArgs('nsis'), ['/S', '--updated', '--force-run']);
  assert.deepEqual(logic.installArgs('portable'), ['--updated']);
  assert.equal(logic.installArgs('manual'), null);
  assert.equal(logic.installArgs('dev'), null);
});
