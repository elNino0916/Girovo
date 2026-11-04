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

test('compareVersions orders pre-releases as semver does', () => {
  // Each one after the one before it.
  const order = [
    '5.16.0', '5.16.1', '6.0.0-alpha', '6.0.0-alpha.1', '6.0.0-alpha.beta', '6.0.0-preview.1', '6.0.0-preview.2',
    '6.0.0-preview.10', '6.0.0-rc.1', '6.0.0', '6.0.1',
  ];
  for (let i = 1; i < order.length; i++) {
    assert.equal(logic.compareVersions(order[i], order[i - 1]), 1, `${order[i]} after ${order[i - 1]}`);
    assert.equal(logic.compareVersions(order[i - 1], order[i]), -1, `${order[i - 1]} before ${order[i]}`);
  }
  assert.equal(logic.compareVersions('v6.0.0-preview.2', '6.0.0-preview.2'), 0);
  // Build metadata does not count.
  assert.equal(logic.compareVersions('6.0.0-preview.2+abc', '6.0.0-preview.2'), 0);
  assert.equal(logic.compareVersions('6.0.0', 'latest'), null);
});

test('isNewer on the preview channel: previews in order, then their release', () => {
  const preview = { prerelease: true };
  assert.equal(logic.isNewer('6.0.0-preview.1', '5.16.1', preview), true);
  assert.equal(logic.isNewer('6.0.0-preview.2', '6.0.0-preview.1', preview), true);
  assert.equal(logic.isNewer('6.0.0-preview.10', '6.0.0-preview.9', preview), true);
  assert.equal(logic.isNewer('6.0.0', '6.0.0-preview.10', preview), true);
  assert.equal(logic.isNewer('6.0.0-preview.1', '6.0.0-preview.1', preview), false);
  assert.equal(logic.isNewer('6.0.0-preview.1', '6.0.0-preview.2', preview), false);
  assert.equal(logic.isNewer('6.0.0-preview.3', '6.0.0', preview), false);
  // A 5.x fix released after the first preview is older than it.
  assert.equal(logic.isNewer('5.16.2', '6.0.0-preview.1', preview), false);
});

test('isNewer on the stable channel: from a preview, only a higher release', () => {
  // Back on stable, nothing below the installed preview is offered: Android cannot go back.
  assert.equal(logic.isNewer('5.16.3', '6.0.0-preview.2'), false);
  assert.equal(logic.isNewer('6.0.0-preview.3', '6.0.0-preview.2'), false);
  assert.equal(logic.isNewer('6.0.0', '6.0.0-preview.2'), true);
  assert.equal(logic.isNewer('6.0.1', '6.0.0-preview.2'), true);
});

test('isNewer: a dev build of a preview comes after that preview', () => {
  const preview = { prerelease: true };
  // CI stamps "<package.json version>-dev.<run>" on a pre-release too.
  assert.equal(logic.isNewer('6.0.0-preview.2', '6.0.0-preview.2-dev.7', preview), false);
  assert.equal(logic.isNewer('6.0.0-preview.3', '6.0.0-preview.2-dev.7', preview), true);
  assert.equal(logic.isNewer('6.0.0', '6.0.0-preview.2-dev.7'), true);
  assert.equal(logic.isNewer('6.0.0-preview.1', '5.16.1-dev.3', preview), true);
  assert.equal(logic.isDevBuild('5.16.1-dev.3'), true);
  assert.equal(logic.isDevBuild('6.0.0-preview.2-dev.7'), true);
  assert.equal(logic.isDevBuild('6.0.0-preview.2'), false);
  assert.equal(logic.isDevBuild('6.0.0-development'), false);
  assert.equal(logic.isDevBuild('5.16.1'), false);
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

test('parseRelease with prerelease: a preview keeps its whole version, a draft is still refused', () => {
  const r = logic.parseRelease(release({ tag_name: 'v6.0.0-preview.2', prerelease: true }), { prerelease: true });
  assert.equal(r.version, '6.0.0-preview.2');
  // GitHub's flag alone, and the tag alone, are both pre-releases.
  assert.equal(logic.parseRelease(release({ tag_name: '6.0.0', prerelease: true }), { prerelease: true }).version, '6.0.0');
  assert.equal(logic.parseRelease(release({ tag_name: '6.0.0-preview.1' }), { prerelease: true }).version, '6.0.0-preview.1');
  assert.equal(logic.parseRelease(release({ tag_name: '6.0.0-preview.1', draft: true }), { prerelease: true }), null);
  assert.equal(logic.parseRelease(release({ tag_name: 'preview' }), { prerelease: true }), null);
});

test('isSwitchBack: a stable release older than the installed preview, nothing else', () => {
  assert.equal(logic.isSwitchBack('5.16.1', '6.0.0-preview.202611031200.ge9d8b1b'), true);
  assert.equal(logic.isSwitchBack('5.16.1', '6.0.0-preview.1'), true);
  assert.equal(logic.isSwitchBack('6.0.0', '6.0.0-preview.1'), false, 'newer: isNewer offers it');
  assert.equal(logic.isSwitchBack('5.16.0', '5.16.1'), false, 'a stable install is not going back');
  assert.equal(logic.isSwitchBack('6.0.0-preview.1', '6.0.0-preview.2'), false, 'never a pre-release');
  assert.equal(logic.isSwitchBack('5.16.1', '6.0.0-preview.1-dev.4'), false, 'never a CI build');
  assert.equal(logic.isSwitchBack('nonsense', '6.0.0-preview.1'), false);
});

test('newestRelease with a kind: a nightly without that install\'s file is passed over', () => {
  const apk = (v) => asset(`Girovo-${v}-android.apk`);
  const exe = (v) => asset(`Girovo-${v}-Setup.exe`);
  const list = [
    release({ tag_name: '6.0.0-preview.202611040217.g5a9a41f', prerelease: true, assets: [exe('6.0.0-preview.202611040217.g5a9a41f')] }),
    release({ tag_name: '6.0.0-preview.1', prerelease: true, assets: [exe('6.0.0-preview.1'), apk('6.0.0-preview.1')] }),
  ];
  // The desktop takes the nightly: its date orders it after preview.1.
  assert.equal(logic.newestRelease(list, '5.16.1', { kind: 'nsis' }).version, '6.0.0-preview.202611040217.g5a9a41f');
  // The GitHub APK has nothing to install in it, so preview.1 is its newest.
  assert.equal(logic.newestRelease(list, '5.16.1', { kind: 'android' }).version, '6.0.0-preview.1');
  assert.equal(logic.newestRelease(list, '6.0.0-preview.1', { kind: 'android' }), null);
  // A kind without files of its own (a manual install, a dev build) filters nothing.
  assert.equal(logic.newestRelease(list, '5.16.1', { kind: 'manual' }).version, '6.0.0-preview.202611040217.g5a9a41f');
});

test('newestRelease: the highest version above the installed one, pre-releases included', () => {
  const list = [
    release({ tag_name: '6.0.0-preview.3', draft: true }),
    release({ tag_name: '6.0.0-preview.1', prerelease: true }),
    release({ tag_name: '5.16.2' }),
    release({ tag_name: '6.0.0-preview.2', prerelease: true }),
    release({ tag_name: 'nightly', prerelease: true }),
    release({ tag_name: '5.16.1' }),
  ];
  assert.equal(logic.newestRelease(list, '5.16.1').version, '6.0.0-preview.2', 'drafts never, garbage skipped');
  assert.equal(logic.newestRelease(list, '6.0.0-preview.1').version, '6.0.0-preview.2');
  assert.equal(logic.newestRelease(list, '6.0.0-preview.2'), null);
  // The release itself wins over every preview of it.
  assert.equal(logic.newestRelease([...list, release({ tag_name: '6.0.0' })], '6.0.0-preview.2').version, '6.0.0');
  // Without any preview newer, the newest stable release.
  assert.equal(logic.newestRelease(list.slice(2, 3), '5.16.1').version, '5.16.2');
  assert.equal(logic.newestRelease({ tag_name: '6.0.0' }, '5.16.1'), null);
  assert.equal(logic.newestRelease(null, '5.16.1'), null);
});

test('the preview channel reads the list beside the latest release', () => {
  // A hundred: the nightly desktop previews (one a night, no APK) must not
  // push the last preview the phone can install off the one page read.
  assert.equal(logic.listUrl(logic.FEED_URL), `https://api.github.com/repos/${logic.REPO}/releases?per_page=100`);
  assert.equal(logic.listUrl('http://127.0.0.1:5000/latest'), 'http://127.0.0.1:5000?per_page=100');
  assert.equal(logic.listUrl('http://127.0.0.1:5000/feed.json'), null);
  assert.equal(logic.channelOf('preview'), 'preview');
  assert.equal(logic.channelOf('stable'), 'stable');
  assert.equal(logic.channelOf(null), 'stable');
  assert.equal(logic.channelOf('beta'), 'stable');
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

test('the feed is the Girovo repository', () => {
  assert.equal(logic.FEED_URL, 'https://api.github.com/repos/elNino0916/Girovo/releases/latest');
  assert.equal(logic.RELEASES_PAGE, 'https://github.com/elNino0916/Girovo/releases');
});

test('parseRelease: files and pages of the old Sooskasse-FinTS repository still count', () => {
  // The repository under the old name carries the update to Girovo for 4.x installs.
  const legacy = 'https://github.com/elNino0916/Sooskasse-FinTS/releases';
  const r = logic.parseRelease(release({
    html_url: `${legacy}/tag/5.0.0`,
    assets: [
      asset('Girovo-5.0.0-Setup.exe', { browser_download_url: `${legacy}/download/5.0.0/Girovo-5.0.0-Setup.exe` }),
      asset('Girovo-5.0.0-portable.exe'),
      // A look-alike repository is not the project.
      asset('Girovo-5.0.0-Setup.exe', {
        browser_download_url: 'https://github.com/elNino0916/Sooskasse-FinTS-fork/releases/download/5.0.0/Girovo-5.0.0-Setup.exe',
      }),
      asset('Girovo-5.0.0-Setup.exe', {
        browser_download_url: 'https://github.com/elNino0916/Girovo-fork/releases/download/5.0.0/Girovo-5.0.0-Setup.exe',
      }),
    ],
  }));
  assert.equal(r.url, `${legacy}/tag/5.0.0`);
  assert.deepEqual(r.assets.map((a) => a.url), [
    `${legacy}/download/5.0.0/Girovo-5.0.0-Setup.exe`,
    `${logic.DOWNLOAD_PREFIX}4.1.0/Girovo-5.0.0-portable.exe`,
  ]);
  assert.equal(logic.pickAsset(r, 'nsis').name, 'Girovo-5.0.0-Setup.exe');
});

test('releasePageOr: either repository name, nothing else', () => {
  assert.equal(logic.releasePageOr(`${logic.RELEASES_PAGE}/tag/5.0.0`), `${logic.RELEASES_PAGE}/tag/5.0.0`);
  const legacy = 'https://github.com/elNino0916/Sooskasse-FinTS/releases/tag/5.0.0';
  assert.equal(logic.releasePageOr(legacy), legacy);
  assert.equal(logic.releasePageOr('https://github.com/elNino0916/Girovo-fork/releases/tag/5.0.0'), logic.RELEASES_PAGE);
  assert.equal(logic.releasePageOr('https://github.com/elNino0916/Sooskasse-FinTS-fork/releases/tag/5.0.0'), logic.RELEASES_PAGE);
  assert.equal(logic.releasePageOr(undefined), logic.RELEASES_PAGE);
  // A test feed's own page stands alone.
  assert.equal(logic.releasePageOr(legacy, 'http://127.0.0.1:1/releases'), 'http://127.0.0.1:1/releases');
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
  assert.equal(logic.pickAsset(r, 'android'), null);
  assert.equal(logic.pickAsset(r, 'dev'), null);
});

test('pickAsset finds the Android APK beside the desktop files', () => {
  const r = logic.parseRelease(release({
    assets: [asset('Girovo-5.3.0-Setup.exe'), asset('Girovo-5.3.0-android.apk'), asset('Girovo-5.3.0-android.apk.sha256')],
  }));
  assert.equal(logic.pickAsset(r, 'android').name, 'Girovo-5.3.0-android.apk');
  assert.equal(logic.pickAsset(r, 'nsis').name, 'Girovo-5.3.0-Setup.exe');
});

test('installKind tells the installed, portable and unpacked builds apart', () => {
  const execPath = 'C:\\Users\\max\\AppData\\Local\\Programs\\Sooskasse-FinTS\\Sooskasse-FinTS.exe';
  const uninstaller = path.join(path.dirname(execPath), 'Uninstall Sooskasse-FinTS.exe');
  const base = { isPackaged: true, env: {}, execPath, exists: (f) => f === uninstaller };
  assert.equal(logic.installKind(base), 'nsis');
  assert.equal(logic.installKind({ ...base, exists: () => false }), 'manual');
  assert.equal(logic.installKind({ ...base, env: { PORTABLE_EXECUTABLE_FILE: 'D:\\Sooskasse-FinTS-4.0.0-portable.exe' } }), 'portable');
  assert.equal(logic.installKind({ ...base, isPackaged: false }), 'dev');
  // An install updated to Girovo keeps its folder, now with the new exe in it.
  const renamedExe = 'C:\\Users\\max\\AppData\\Local\\Programs\\Sooskasse-FinTS\\Girovo.exe';
  const renamedUninstaller = path.join(path.dirname(renamedExe), 'Uninstall Girovo.exe');
  assert.equal(logic.installKind({ ...base, execPath: renamedExe, exists: (f) => f === renamedUninstaller }), 'nsis');
  // The Linux packages do not update themselves: the AppImage and the .deb's /opt install.
  const appImage = { isPackaged: true, env: { APPIMAGE: '/home/max/Apps/Girovo-5.2.2-x86_64.AppImage' }, execPath: '/tmp/.mount_GirovoX1y2Z3/girovo', exists: () => false };
  assert.equal(logic.installKind(appImage), 'manual');
  assert.equal(logic.installKind({ ...appImage, env: {}, execPath: '/opt/Girovo/girovo' }), 'manual');
});

test('installArgs: silent and restarting for the installer, nothing for the rest', () => {
  assert.deepEqual(logic.installArgs('nsis'), ['/S', '--updated', '--force-run']);
  assert.deepEqual(logic.installArgs('portable'), ['--updated']);
  assert.equal(logic.installArgs('manual'), null);
  assert.equal(logic.installArgs('dev'), null);
});

test('tagUrl sits beside the latest-release address', () => {
  assert.equal(logic.tagUrl(logic.FEED_URL, '4.1.0'), `https://api.github.com/repos/${logic.REPO}/releases/tags/4.1.0`);
  assert.equal(logic.tagUrl('http://127.0.0.1:5000/latest', 'v4.1.0'), 'http://127.0.0.1:5000/tags/v4.1.0');
  assert.equal(logic.tagUrl('http://127.0.0.1:5000/feed.json', '4.1.0'), null);
});

test('pickBlockmap finds the blockmap beside the installer, and only that', () => {
  const r = logic.parseRelease(release({
    assets: [
      asset('Sooskasse-FinTS-4.1.0-Setup.exe'),
      asset('Sooskasse-FinTS-4.1.0-portable.exe'),
      asset('Sooskasse-FinTS-4.1.0-Setup.exe.blockmap', { size: 122_110 }),
    ],
  }));
  const setup = logic.pickAsset(r, 'nsis');
  assert.equal(setup.name, 'Sooskasse-FinTS-4.1.0-Setup.exe', 'the blockmap is not mistaken for the installer');
  assert.equal(logic.pickBlockmap(r, setup).name, 'Sooskasse-FinTS-4.1.0-Setup.exe.blockmap');
  assert.equal(logic.pickBlockmap(r, logic.pickAsset(r, 'portable')), null);
  assert.equal(logic.pickBlockmap(null, setup), null);
});

const blockmap = (checksums, sizes, extra = {}) => ({
  version: '2',
  files: [{ name: 'file', offset: 0, checksums, sizes, ...extra }],
});

test('parseBlockmap: chunks in file order, adding up to the installer', () => {
  assert.deepEqual(logic.parseBlockmap(blockmap(['a', 'b', 'c'], [10, 20, 5]), 35), [
    { checksum: 'a', size: 10, offset: 0 },
    { checksum: 'b', size: 20, offset: 10 },
    { checksum: 'c', size: 5, offset: 30 },
  ]);
});

test('parseBlockmap refuses anything that does not describe the file', () => {
  assert.equal(logic.parseBlockmap(blockmap(['a', 'b'], [10, 20]), 31), null, 'wrong total');
  assert.equal(logic.parseBlockmap(blockmap(['a'], [10, 20]), 30), null, 'lists of different length');
  assert.equal(logic.parseBlockmap(blockmap(['a', 'b'], [10, -20]), -10), null);
  assert.equal(logic.parseBlockmap(blockmap(['a', 7], [10, 20]), 30), null);
  assert.equal(logic.parseBlockmap(blockmap([], []), 0), null);
  assert.equal(logic.parseBlockmap(blockmap(['a'], [10], { offset: 4 }), 14), null);
  assert.equal(logic.parseBlockmap({ ...blockmap(['a'], [10]), version: '1' }, 10), null);
  assert.equal(logic.parseBlockmap({ version: '2', files: [] }, 10), null);
  assert.equal(logic.parseBlockmap(null, 10), null);
});

/** Chunks as a blockmap lists them, from [checksum, size] pairs. */
function chunks(list) {
  let offset = 0;
  return list.map(([checksum, size]) => {
    const c = { checksum, size, offset };
    offset += size;
    return c;
  });
}

test('planDifferential: unchanged chunks are copied, changed ones fetched', () => {
  const old = chunks([['a', 100], ['b', 100], ['c', 100], ['d', 100]]);
  const next = chunks([['a', 100], ['X', 50], ['c', 100], ['d', 100], ['Y', 30]]);
  const plan = logic.planDifferential(old, next, { mergeGap: 0 });
  assert.deepEqual(plan.copies, [
    { from: 0, to: 0, size: 100 },
    { from: 200, to: 150, size: 200 },
  ]);
  assert.deepEqual(plan.fetches, [
    { start: 100, size: 50 },
    { start: 350, size: 30 },
  ]);
  assert.equal(plan.fetchBytes, 80);
});

test('planDifferential: a chunk that moved is copied from where it was', () => {
  const old = chunks([['a', 10], ['b', 20]]);
  const plan = logic.planDifferential(old, chunks([['b', 20], ['a', 10]]));
  assert.deepEqual(plan.copies, [{ from: 10, to: 0, size: 20 }, { from: 0, to: 20, size: 10 }]);
  assert.deepEqual(plan.fetches, []);
});

test('planDifferential: same checksum but another size is not the same chunk', () => {
  const plan = logic.planDifferential(chunks([['a', 10]]), chunks([['a', 11]]));
  assert.deepEqual(plan.copies, []);
  assert.deepEqual(plan.fetches, [{ start: 0, size: 11 }]);
});

test('passingFailure: only 502, 503 and 504 are asked once more', () => {
  for (const status of [502, 503, 504]) assert.equal(logic.passingFailure(status), true, String(status));
  for (const status of [200, 304, 403, 404, 429, 500]) assert.equal(logic.passingFailure(status), false, String(status));
});

test('planDifferential: a short copy between two fetches is fetched along', () => {
  const old = chunks([['a', 100], ['b', 1000]]);
  const next = chunks([['X', 10], ['a', 100], ['Y', 10], ['b', 1000], ['Z', 10]]);
  const plan = logic.planDifferential(old, next, { mergeGap: 100 });
  // 'a' (100 bytes) sits between two fetches: one request for X+a+Y.
  // 'b' (1000 bytes) is past the gap: copied.
  assert.deepEqual(plan.fetches, [{ start: 0, size: 120 }, { start: 1120, size: 10 }]);
  assert.deepEqual(plan.copies, [{ from: 100, to: 120, size: 1000 }]);
  assert.equal(plan.fetchBytes, 130);
  // Every byte of the new file is covered exactly once.
  const covered = [...plan.copies.map((c) => [c.to, c.size]), ...plan.fetches.map((f) => [f.start, f.size])]
    .sort((x, y) => x[0] - y[0]);
  let at = 0;
  for (const [start, size] of covered) {
    assert.equal(start, at);
    at += size;
  }
  assert.equal(at, 1130);
});
