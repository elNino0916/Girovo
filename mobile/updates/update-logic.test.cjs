'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
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

test('newestRelease with a kind: a nightly without that install\'s file is passed over', () => {
  const apk = (v) => asset(`Girovo-${v}-android.apk`);
  const exe = (v) => asset(`Girovo-${v}-Setup.exe`);
  const list = [
    release({ tag_name: '6.0.0-preview.202611040217.g5a9a41f', prerelease: true, assets: [exe('6.0.0-preview.202611040217.g5a9a41f')] }),
    release({ tag_name: '6.0.0-preview.1', prerelease: true, assets: [exe('6.0.0-preview.1'), apk('6.0.0-preview.1')] }),
  ];
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

/** Chunks as a blockmap lists them, from [checksum, size] pairs. */
test('pickAsset finds the Android APK beside the desktop files, and only that', () => {
  const r = logic.parseRelease(release({
    assets: [asset('Girovo-5.3.0-Setup.exe'), asset('Girovo-5.3.0-android.apk'), asset('Girovo-5.3.0-android.apk.sha256')],
  }));
  assert.equal(logic.pickAsset(r, 'android').name, 'Girovo-5.3.0-android.apk');
  assert.equal(logic.pickAsset(logic.parseRelease(release()), 'android'), null, 'a release without an APK');
  assert.equal(logic.pickAsset(r, 'nsis'), null, 'the desktop files are not this updater\'s');
  assert.equal(logic.pickAsset(null, 'android'), null);
});

test('passingFailure: only 502, 503 and 504 are asked once more', () => {
  for (const status of [502, 503, 504]) assert.equal(logic.passingFailure(status), true, String(status));
  for (const status of [200, 304, 403, 404, 429, 500]) assert.equal(logic.passingFailure(status), false, String(status));
});

test('nightlies by their time, after the hand-made preview, before the release', () => {
  const old = '6.0.0-preview.202611071124.g36b2a39';
  const nu = '6.0.0-nightly.202611071530.gabc1234';
  assert.equal(logic.isNewer(nu, old, { prerelease: true }), true, 'the renamed nightly follows the old one');
  assert.equal(logic.isNewer(old, nu, { prerelease: true }), false);
  assert.equal(logic.isNewer('6.0.0-preview.1', nu, { prerelease: true }), false, 'a hand-made preview is older than any nightly');
  assert.equal(logic.isNewer(nu, '6.0.0-preview.1', { prerelease: true }), true);
  assert.equal(logic.isNewer('6.0.0', nu, { prerelease: true }), true);
});

test('the wait GitHub names, in whole minutes, as the desktop says it', () => {
  const now = 1794061874;
  assert.equal(logic.rateLimitWait(null, '0', '1794063734', now), 31);
  assert.equal(logic.rateLimitWait('90', '0', '1794063734', now), 2);
  assert.equal(logic.rateLimitWait(null, '0', '1794061800', now), 1);
  assert.equal(logic.rateLimitWait(null, '12', '1794063734', now), null);
  assert.equal(logic.rateLimitWait(null, null, null, now), null);
  assert.equal(logic.rateLimitWait(null, '0', 'soon', now), null);
});

test('a release moves an install on the Nightly channel back to Stabil, once', () => {
  assert.equal(logic.movesToStable('preview', '6.0.0', null), true);
  assert.equal(logic.movesToStable('preview', '6.0.1', '6.0.0'), false, 'moved before: a Nightly picked again stays');
  assert.equal(logic.movesToStable('stable', '6.0.0', null), false);
  assert.equal(logic.movesToStable(null, '6.0.0', null), false);
  assert.equal(logic.movesToStable('preview', '6.0.0-preview.2', null), false);
  assert.equal(logic.movesToStable('preview', '6.0.0-dev.57', null), false);
});

test('a channel picked by hand is never moved back', () => {
  // Stabil from the first start, so nothing ever moved; then Nightly is picked on 6.0.4.
  const prefs = { channel: 'stable', moved: null };
  assert.equal(logic.movesToStable(prefs.channel, '6.0.4', prefs.moved), false);
  prefs.channel = logic.channelOf('preview');
  assert.equal(logic.movesToStable(prefs.channel, '6.0.4', prefs.moved), true, 'without the marker the next start took the choice back');
  prefs.moved = logic.pickedMarker('6.0.4');
  assert.equal(prefs.moved, '6.0.4');
  assert.equal(logic.movesToStable(prefs.channel, '6.0.4', prefs.moved), false, 'the next start');
  assert.equal(logic.movesToStable(prefs.channel, '6.1.0', prefs.moved), false, 'and the next release');
  assert.ok(logic.pickedMarker(''), 'a marker even without a version');
  assert.ok(logic.pickedMarker(undefined));
  assert.equal(logic.movesToStable('preview', '6.0.4', logic.pickedMarker(undefined)), false);
});

test('a pre-release build on Nightly without the marker writes it at its start', () => {
  assert.equal(logic.marksPicked('preview', '6.1.0-preview.2', null), true);
  assert.equal(logic.marksPicked('preview', '6.1.0-nightly.202611101548.g59962ab', null), true);
  assert.equal(logic.marksPicked('preview', '6.1.0-preview.2', ''), true);
  assert.equal(logic.marksPicked('preview', '6.1.0-preview.2', '6.0.0'), false, 'marked already');
  assert.equal(logic.marksPicked('stable', '6.1.0-preview.2', null), false, 'not on Nightly');
  assert.equal(logic.marksPicked(null, '6.1.0-preview.2', null), false);
  assert.equal(logic.marksPicked('preview', '6.1.0', null), false, 'a release build moves instead');
  assert.equal(logic.marksPicked('preview', 'six', null), false);

  // Nightly chosen before picking wrote the marker, then the preview's start, then the release's.
  const prefs = { channel: 'preview', moved: null };
  for (const current of ['6.1.0-preview.2', '6.1.0']) {
    assert.equal(logic.movesToStable(prefs.channel, current, prefs.moved), false, current);
    if (logic.marksPicked(prefs.channel, current, prefs.moved)) prefs.moved = logic.pickedMarker(current);
  }
  assert.equal(prefs.moved, '6.1.0-preview.2');
  // The move it was made for still happens: a release build, on Nightly from before 6.0.0, never marked.
  assert.equal(logic.movesToStable('preview', '6.0.0', null), true);
  assert.equal(logic.marksPicked('preview', '6.0.0', null), false);
});

test('after a channel change a check starts from nothing: the other channel\'s download is not kept', () => {
  const start = logic.afterChannelChange();
  assert.deepEqual(start, { phase: 'idle', version: null });
  // Nightly's preview was downloaded; on Stabil the check fails (no connection).
  assert.equal(logic.phaseAfterFailedCheck({ phase: 'ready', version: '6.1.0-preview.2' }), 'ready', 'what staying on the channel keeps');
  assert.equal(logic.phaseAfterFailedCheck(start), 'idle', 'nothing to install');
  assert.equal(logic.phaseAfterCheck(start, '6.1.0-preview.2'), 'available', 'the same release again: downloaded anew');
});

test('the plugin is heard only about the release on offer', () => {
  assert.equal(logic.aboutOffer('6.0.5', '6.0.5'), true);
  assert.equal(logic.aboutOffer('6.1.0-preview.2', '6.0.5'), false, 'another release is on offer now');
  assert.equal(logic.aboutOffer(null, '6.0.5'), false, 'no download asked for: after a channel change, or refused');
  assert.equal(logic.aboutOffer('6.0.5', null), false, 'nothing on offer');
  assert.equal(logic.aboutOffer(null, null), false);
  assert.equal(logic.aboutOffer(undefined, undefined), false);
  assert.equal(logic.aboutOffer('', ''), false);
});

test('a check keeps a downloaded update ready for the same release', () => {
  assert.equal(logic.phaseAfterCheck({ phase: 'ready', version: '6.0.5' }, '6.0.5'), 'ready');
  assert.equal(logic.phaseAfterCheck({ phase: 'ready', version: '6.0.5' }, '6.0.6'), 'available', 'a newer one has to be downloaded');
  assert.equal(logic.phaseAfterCheck({ phase: 'available', version: '6.0.5' }, '6.0.5'), 'available');
  assert.equal(logic.phaseAfterCheck({ phase: 'idle', version: null }, '6.0.5'), 'available');
  assert.equal(logic.phaseAfterCheck({ phase: 'current', version: null }, '6.0.5'), 'available');
  assert.equal(logic.phaseAfterCheck({ phase: 'ready', version: null }, null), 'available');
  assert.equal(logic.phaseAfterCheck(null, '6.0.5'), 'available');
});

test('a failed check leaves an offer as it was, and claims nothing without one', () => {
  assert.equal(logic.phaseAfterFailedCheck({ phase: 'ready', version: '6.0.5' }), 'ready');
  assert.equal(logic.phaseAfterFailedCheck({ phase: 'available', version: '6.0.5' }), 'available');
  assert.equal(logic.phaseAfterFailedCheck({ phase: 'current', version: null }), 'idle');
  assert.equal(logic.phaseAfterFailedCheck({ phase: 'idle', version: null }), 'idle');
  assert.equal(logic.phaseAfterFailedCheck({ phase: 'available', version: null }), 'idle', 'no release, no offer');
  assert.equal(logic.phaseAfterFailedCheck({ phase: 'checking', version: '6.0.5' }), 'idle');
  assert.equal(logic.phaseAfterFailedCheck(null), 'idle');
});

// ---- what girovo.de said last holds GitHub's offer back ----

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 10, 12);
const B604 = 600040_000000000;
const B605 = 600050_000000000;
const B606 = 600060_000000000;

test('GitHub alone: a release above what girovo.de offered last is held back', () => {
  const said = { build: B604, at: NOW - HOUR, downSince: NOW - HOUR / 2 };
  assert.equal(logic.offersFromGitHub(B605, said, NOW), false, 'above: halted or staged, for all this copy knows');
  assert.equal(logic.offersFromGitHub(B604, said, NOW), true, '(a) the one girovo.de offered');
  assert.equal(logic.offersFromGitHub(B604 - 1, said, NOW), true, '(a) below it');
  assert.equal(logic.offersFromGitHub(null, said, NOW), false, 'no build number: not known to be at or below');
  assert.equal(logic.offersFromGitHub(undefined, said, NOW), false);
  assert.equal(logic.offersFromGitHub('600050000000000', said, NOW), false);
  assert.equal(logic.offersFromGitHub(-1, said, NOW), false);
  assert.equal(logic.offersFromGitHub(B605, { build: B604, at: NOW - HOUR }, NOW), false, 'no failure noted: it counts from now');
});

test('GitHub alone: the 72 hours run from the first failed ask', () => {
  assert.equal(logic.LISTED_HOLD_MS, 72 * HOUR);
  const down = (age) => ({ build: B604, at: NOW - age - HOUR, downSince: NOW - age });
  assert.equal(logic.offersFromGitHub(B605, down(0), NOW), false, 'just failed');
  assert.equal(logic.offersFromGitHub(B605, down(71 * HOUR), NOW), false);
  assert.equal(logic.offersFromGitHub(B605, down(72 * HOUR), NOW), false, 'exactly 72 hours: not yet older');
  assert.equal(logic.offersFromGitHub(B605, down(72 * HOUR + 1), NOW), true, '(b) older than 72 hours');
  assert.equal(logic.offersFromGitHub(B605, down(30 * 24 * HOUR), NOW), true);
});

test('GitHub alone: a copy opened four days after its last good answer, during an outage, is held', () => {
  // Last good answer four days ago (6.0.4 for this copy); 6.0.5 was halted since; girovo.de is down now.
  let text = logic.rememberListed(null, 'stable', B604, NOW - 96 * HOUR);
  assert.equal(logic.offersFromGitHub(B605, logic.listedFor(text, 'stable'), NOW), false, 'the outage starts now, not four days ago');
  text = logic.noteFailedAsk(text, 'stable', NOW);
  assert.deepEqual(logic.listedFor(text, 'stable'), { build: B604, at: NOW - 96 * HOUR, downSince: NOW });
  assert.equal(logic.offersFromGitHub(B605, logic.listedFor(text, 'stable'), NOW), false, 'held');

  // Later failures leave the first one's time: six-hourly checks never push the end out.
  for (let h = 6; h <= 72; h += 6) {
    text = logic.noteFailedAsk(text, 'stable', NOW + h * HOUR);
    assert.equal(logic.listedFor(text, 'stable').downSince, NOW, `failure after ${h} h`);
    assert.equal(logic.offersFromGitHub(B605, logic.listedFor(text, 'stable'), NOW + h * HOUR), false, `${h} h after the first failure`);
  }
  assert.equal(logic.offersFromGitHub(B605, logic.listedFor(text, 'stable'), NOW + 72 * HOUR + 1), true, '72 hours after the first failure: offered');

  // A good answer ends the outage: the next one counts from its own first failure.
  text = logic.rememberListed(text, 'stable', B604, NOW + 73 * HOUR);
  assert.deepEqual(logic.listedFor(text, 'stable'), { build: B604, at: NOW + 73 * HOUR, downSince: null });
  assert.deepEqual(JSON.parse(text), { stable: { build: B604, at: NOW + 73 * HOUR } }, 'no downSince stored');
  text = logic.noteFailedAsk(text, 'stable', NOW + 200 * HOUR);
  assert.equal(logic.listedFor(text, 'stable').downSince, NOW + 200 * HOUR);
  assert.equal(logic.offersFromGitHub(B605, logic.listedFor(text, 'stable'), NOW + 201 * HOUR), false);
});

test('GitHub alone: a time in the future is stale, never a hold for ever', () => {
  assert.equal(logic.offersFromGitHub(B605, { build: B604, at: NOW + 1, downSince: NOW }, NOW), true, 'the answer from the future');
  assert.equal(logic.offersFromGitHub(B605, { build: B604, at: NOW + 400 * 24 * HOUR }, NOW), true);
  assert.equal(logic.offersFromGitHub(B605, { build: B604, at: NOW - HOUR, downSince: NOW + 1 }, NOW), true, 'the failure from the future');
});

test('GitHub alone: nothing noted, or nothing readable, holds nothing back', () => {
  assert.equal(logic.offersFromGitHub(B605, null, NOW), true, '(c)');
  assert.equal(logic.offersFromGitHub(B605, undefined, NOW), true);
  const at = NOW - HOUR;
  for (const odd of [
    {}, { build: B604 }, { at }, { build: '600040000000000', at }, { build: B604, at: 'now' }, { build: B604, at: NaN },
    { build: 1.5, at }, { build: -1, at }, { build: B604, at: at + 0.5 }, { build: B604, at: -1 },
    { build: B604, at, downSince: -1 }, { build: B604, at, downSince: at + 0.5 }, { build: B604, at, downSince: 'then' },
    { build: Number.MAX_SAFE_INTEGER + 1, at },
  ]) {
    assert.equal(logic.offersFromGitHub(B605, odd, NOW), true, JSON.stringify(odd));
  }
});

test('what one answer of girovo.de leaves to note', () => {
  assert.equal(logic.listedBuild(B605, B604), B605, 'the release it offered this copy');
  assert.equal(logic.listedBuild(null, B604), B604, 'nothing offered: the running version');
  assert.equal(logic.listedBuild(B604, B604), B604);
  assert.equal(logic.listedBuild(B604, B605), B605, 'nothing newer offered: the running version');
  assert.equal(logic.listedBuild(B605, null), B605);
  assert.equal(logic.listedBuild(null, null), null);
  assert.equal(logic.listedBuild('x', undefined), null);
  assert.equal(logic.listedBuild(-1, B604), B604, 'a negative number is none');
  assert.equal(logic.listedBuild(1.5, null), null);
});

test('the answers are noted per channel, the latest one, not the highest', () => {
  assert.equal(logic.listedFor(null, 'stable'), null);
  let text = logic.rememberListed(null, 'stable', B605, NOW - 2 * HOUR);
  assert.deepEqual(logic.listedFor(text, 'stable'), { build: B605, at: NOW - 2 * HOUR, downSince: null });
  assert.equal(logic.listedFor(text, 'preview'), null);

  // 6.0.5 was offered, then halted: girovo.de's next answer offers nothing, and that is what counts.
  text = logic.rememberListed(text, 'stable', logic.listedBuild(null, B604), NOW - HOUR);
  assert.deepEqual(logic.listedFor(text, 'stable'), { build: B604, at: NOW - HOUR, downSince: null });
  assert.equal(logic.offersFromGitHub(B605, logic.listedFor(text, 'stable'), NOW), false);

  // The other channel's answer stays beside it.
  text = logic.rememberListed(text, 'preview', B606, NOW);
  assert.deepEqual(JSON.parse(text), { stable: { build: B604, at: NOW - HOUR }, preview: { build: B606, at: NOW } });

  // No build to note, or no whole-number time: the channel's entry stays as it was, failure and all.
  text = logic.noteFailedAsk(text, 'preview', NOW + HOUR);
  const kept = JSON.parse(text);
  for (const [build, at] of [[null, NOW + 2 * HOUR], [-1, NOW + 2 * HOUR], [1.5, NOW + 2 * HOUR], [B606, -1], [B606, NOW + 0.5], [B606, undefined]]) {
    assert.deepEqual(JSON.parse(logic.rememberListed(text, 'preview', build, at)), kept, `${build} at ${at}`);
  }
  assert.deepEqual(kept, { stable: { build: B604, at: NOW - HOUR }, preview: { build: B606, at: NOW, downSince: NOW + HOUR } });

  for (const odd of ['', 'not json', '[]', '7', 'null', '{"stable":7}', '{"stable":{"build":"1","at":2}}', '{"stable":{"build":1}}',
    '{"stable":{"build":1,"at":2.5}}', '{"stable":{"build":-1,"at":2}}', '{"stable":{"build":1,"at":-2}}', '{"stable":{"build":1,"at":2,"downSince":-3}}']) {
    assert.equal(logic.listedFor(odd, 'stable'), null, odd);
    assert.deepEqual(JSON.parse(logic.rememberListed(odd, 'preview', B606, NOW)), { preview: { build: B606, at: NOW } }, odd);
    assert.deepEqual(JSON.parse(logic.noteFailedAsk(odd, 'stable', NOW)), {}, `${odd}: nothing noted, no failure noted`);
  }
  assert.deepEqual(logic.listedFor('{"stable":{"build":1,"at":2,"downSince":null}}', 'stable'), { build: 1, at: 2, downSince: null });
  assert.deepEqual(logic.listedFor(text, 'anything else'), { build: B604, at: NOW - HOUR, downSince: null }, 'anything that is not a channel is the stable one');
  assert.deepEqual(JSON.parse(logic.noteFailedAsk(text, 'stable', -5)), JSON.parse(text), 'a time that is no whole number notes nothing');
});

test('GitHub alone after a channel switch: each channel is held by its own note', () => {
  // On Stabil girovo.de offered nothing above 6.0.4 an hour ago; Nightly was never asked.
  let text = logic.rememberListed(null, 'stable', B604, NOW - HOUR);
  text = logic.noteFailedAsk(text, 'stable', NOW);
  text = logic.noteFailedAsk(text, 'preview', NOW);
  assert.equal(logic.offersFromGitHub(B605, logic.listedFor(text, 'stable'), NOW), false);
  assert.equal(logic.offersFromGitHub(B605, logic.listedFor(text, 'preview'), NOW), true, '(c) nothing noted for Nightly');
  assert.equal(logic.listedFor(text, 'preview'), null, 'and no failure noted there either');
  // Once Nightly was asked, it holds too, and its answer leaves Stabil's outage as it was.
  text = logic.rememberListed(text, 'preview', B605, NOW + HOUR);
  assert.equal(logic.listedFor(text, 'stable').downSince, NOW);
  text = logic.noteFailedAsk(text, 'preview', NOW + 2 * HOUR);
  assert.equal(logic.offersFromGitHub(B606, logic.listedFor(text, 'preview'), NOW + 3 * HOUR), false);
  assert.equal(logic.offersFromGitHub(B605, logic.listedFor(text, 'preview'), NOW + 3 * HOUR), true);
  assert.equal(logic.offersFromGitHub(B605, logic.listedFor(text, 'stable'), NOW + 3 * HOUR), false);
  // Each channel's 72 hours from its own first failure.
  assert.equal(logic.offersFromGitHub(B605, logic.listedFor(text, 'stable'), NOW + 72 * HOUR + 1), true);
  assert.equal(logic.offersFromGitHub(B606, logic.listedFor(text, 'preview'), NOW + 72 * HOUR + 1), false);
  assert.equal(logic.offersFromGitHub(B606, logic.listedFor(text, 'preview'), NOW + 74 * HOUR + 1), true);
});

test('a check whose find was held back: what is on screen stays, else nothing new', () => {
  assert.equal(logic.phaseAfterHeldCheck({ phase: 'ready', version: '6.0.4' }), 'ready', 'the downloaded file with it');
  assert.equal(logic.phaseAfterHeldCheck({ phase: 'available', version: '6.0.4' }), 'available');
  assert.equal(logic.phaseAfterHeldCheck({ phase: 'idle', version: null }), 'current');
  assert.equal(logic.phaseAfterHeldCheck({ phase: 'current', version: null }), 'current');
  assert.equal(logic.phaseAfterHeldCheck(logic.afterChannelChange()), 'current');
  assert.equal(logic.phaseAfterHeldCheck(null), 'current');
});
