'use strict';

// The GitHub APK's update decisions (mobile/bridges/updates.ts), kept apart
// from the network so they can be tested on their own (update-logic.test.cjs):
// which release counts as newer, whether it carries the APK, and whether that
// file can be checked before it is installed. The desktop app's are in Rust
// (src-tauri/src/updater/logic.rs), ported from this file's desktop parts. Everything that comes from the network is
// data — nothing in here throws on odd input, it answers "no update".

// The project's repository, renamed with the app. Its old name,
// Sooskasse-FinTS, now belongs to a small repository of its own that carries
// nothing but the update to this version (and the releases it is built from):
// 4.x and 5.0.0 — built before the switch — only ever ask there. From 5.0.1
// on the app asks here. Files and release pages under the old name still
// count as ours — the "updated" marker an older install leaves for the first
// start of this one links to that repository's release page.
const REPO = 'elNino0916/Girovo';
const LEGACY_REPO = 'elNino0916/Sooskasse-FinTS';
const FEED_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases`;
const RELEASES_PAGES = [RELEASES_PAGE, `https://github.com/${LEGACY_REPO}/releases`];
const DOWNLOAD_PREFIX = `https://github.com/${REPO}/releases/download/`;
const DOWNLOAD_PREFIXES = [DOWNLOAD_PREFIX, `https://github.com/${LEGACY_REPO}/releases/download/`];

// A release's executables are ~100 MB; a file far past that is not ours.
const MAX_ASSET_BYTES = 1024 * 1024 * 1024;
// Release notes are shown in a dialog, not archived.
const MAX_NOTES_CHARS = 20_000;
/** How long the updater waits before asking GitHub once more after a passing failure. */
const RETRY_DELAY_MS = 1500;

/**
 * Whether GitHub's answer is one of its passing failures — 502, 503 or 504:
 * its API and its file servers do that now and then for a moment (a release
 * just published, a busy minute). The updater asks once more after
 * RETRY_DELAY_MS; any other answer is the answer.
 */
const passingFailure = (status) => status === 502 || status === 503 || status === 504;

/**
 * How many minutes until GitHub takes requests again, from its refusal's
 * headers: Retry-After (seconds) or, with the quota used up
 * (X-RateLimit-Remaining 0), X-RateLimit-Reset (Unix seconds). At least one;
 * null when the refusal names no time. As src-tauri/src/updater/logic.rs
 * rate_limit_wait.
 */
function rateLimitWait(retryAfter, remaining, reset, nowSecs) {
  const num = (s) => (typeof s === 'string' && /^\s*\d+\s*$/.test(s) ? Number(s) : null);
  let secs = num(retryAfter);
  if (secs == null) {
    if (typeof remaining !== 'string' || remaining.trim() !== '0') return null;
    const at = num(reset);
    if (at == null) return null;
    secs = Math.max(0, at - nowSecs);
  }
  return Math.max(1, Math.ceil(secs / 60));
}

/** The file of a release that updates each kind of install: the Android app
 * from GitHub. The Google Play build is updated by Play and never asks. */
const ASSET_PATTERN = {
  android: /-android\.apk$/i,
};

/** "4.1.0", "v4.1.0", "4.1.0-dev.12" → { core: [4, 1, 0], pre: 'dev.12' }; null if not a version. */
function parseVersion(text) {
  const m = /^v?(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    String(text ?? '').trim(),
  );
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? '' };
}

function compareCore(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

/**
 * Semver's order of two pre-release tags ("preview.2" against "preview.10"):
 * field by field, numbers by value and below words, words by their ASCII
 * order; with all fields equal, the one with more fields is the later one.
 */
function comparePre(a, b) {
  const x = a.split('.');
  const y = b.split('.');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (i >= x.length) return -1;
    if (i >= y.length) return 1;
    const xNum = /^\d+$/.test(x[i]);
    const yNum = /^\d+$/.test(y[i]);
    if (xNum && yNum) {
      const order = Number(x[i]) - Number(y[i]);
      if (order !== 0) return order < 0 ? -1 : 1;
    } else if (xNum !== yNum) {
      return xNum ? -1 : 1;
    } else if (x[i] !== y[i]) {
      return x[i] < y[i] ? -1 : 1;
    }
  }
  return 0;
}

/**
 * A nightly's tag as it is ordered: "nightly.<yyyymmddhhmm>…", and the
 * nightlies before the name changed, "preview.<yyyymmddhhmm>…" (12 digits and
 * more, never a hand-made preview's number), both as "~nightly.<stamp>…": by
 * their time among themselves, and after a hand-made "preview.N" ("~" comes
 * after every letter). As src-tauri/src/updater/logic.rs ordered_pre.
 */
function orderedPre(pre) {
  const m = /^(?:nightly|preview)\.(\d{12,})(\..*)?$/.exec(pre);
  return m ? `~nightly.${m[1]}${m[2] ?? ''}` : pre;
}

/** Two parsed versions in semver's order: a pre-release comes before its release. */
function compareParsed(a, b) {
  const order = compareCore(a.core, b.core);
  if (order !== 0) return order;
  if (!a.pre || !b.pre) return a.pre ? -1 : b.pre ? 1 : 0;
  return comparePre(orderedPre(a.pre), orderedPre(b.pre));
}

/** -1, 0 or 1 as `a` comes before, with or after `b` (semver); null when either is not a version. */
function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  return x && y ? compareParsed(x, y) : null;
}

/**
 * The version a CI build was numbered after: CI stamps development builds
 * `<package.json version>-dev.<run>` — "4.0.0-dev.57", or
 * "6.0.0-preview.2-dev.3" while package.json holds a pre-release.
 */
function withoutDev(parsed) {
  const m = /^(?:(.*)-)?dev(?:\.[0-9A-Za-z.-]*)?$/i.exec(parsed.pre);
  return m ? { core: parsed.core, pre: m[1] ?? '' } : parsed;
}

/** Whether `version` is a CI development build (see withoutDev). */
function isDevBuild(version) {
  const parsed = parseVersion(version);
  return !!parsed && withoutDev(parsed) !== parsed;
}

/**
 * Whether the release `candidate` is an update for the running `current`.
 *
 * Semver, with one turn for this project's development builds: package.json
 * keeps the last release's number until the next one is cut — so
 * 4.0.0-dev.57 is built from code *after* 4.0.0, not before it, and a
 * release only counts as newer when it is higher than 4.0.0 itself. Any
 * other pre-release (4.1.0-beta.1) does come before its release, as semver
 * has it.
 *
 * A pre-release is offered only with `prerelease` (the preview channel):
 * 6.0.0-preview.2 after 6.0.0-preview.1 after 5.16.1, and 6.0.0 after every
 * 6.0.0-preview.N.
 */
function isNewer(candidate, current, { prerelease = false } = {}) {
  const c = parseVersion(candidate);
  const v = parseVersion(current);
  if (!c || !v || (c.pre && !prerelease)) return false;
  return compareParsed(c, withoutDev(v)) > 0;
}

/** A file name that can safely become a path on disk: no folders, no tricks. */
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,150}$/;

/** `downloadPrefixes`: one URL prefix or a list of them, as for parseRelease. */
function parseAsset(raw, downloadPrefixes) {
  if (!raw || typeof raw !== 'object') return null;
  const name = typeof raw.name === 'string' ? raw.name : '';
  const url = typeof raw.browser_download_url === 'string' ? raw.browser_download_url : '';
  const size = Number(raw.size);
  if (!SAFE_FILE_NAME.test(name) || name.includes('..')) return null;
  if (![].concat(downloadPrefixes).some((prefix) => url.startsWith(prefix))) return null;
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_ASSET_BYTES) return null;
  // GitHub computes this itself for every uploaded file; it is what the
  // download is checked against before anything runs.
  const digest = /^sha256:([0-9a-f]{64})$/i.exec(typeof raw.digest === 'string' ? raw.digest : '');
  return { name, url, size, sha256: digest ? digest[1].toLowerCase() : null };
}

/**
 * `url` if it is a page of one of the project's releases — under either
 * repository name when `releasesPage` is the real one — else `releasesPage`.
 */
function releasePageOr(url, releasesPage = RELEASES_PAGE) {
  const pages = releasesPage === RELEASES_PAGE ? RELEASES_PAGES : [releasesPage];
  return typeof url === 'string' && pages.some((page) => url.startsWith(`${page}/`)) ? url : releasesPage;
}

/**
 * GitHub's answer for one release, reduced to what the updater needs — or
 * null when it is not a usable release: a draft, a tag that is not a
 * version, and without `prerelease` a pre-release (one GitHub marks as such,
 * or one whose tag is one).
 */
function parseRelease(json, { downloadPrefix = DOWNLOAD_PREFIXES, releasesPage = RELEASES_PAGE, prerelease = false } = {}) {
  if (!json || typeof json !== 'object' || json.draft || (json.prerelease && !prerelease)) return null;
  const parsed = parseVersion(json.tag_name);
  if (!parsed || (parsed.pre && !prerelease)) return null;
  const version = parsed.pre ? `${parsed.core.join('.')}-${parsed.pre}` : parsed.core.join('.');
  const name = typeof json.name === 'string' && json.name.trim() ? json.name.trim().slice(0, 200) : version;
  const pageUrl = releasePageOr(json.html_url, releasesPage);
  const published = typeof json.published_at === 'string' ? Date.parse(json.published_at) : NaN;
  return {
    version,
    name,
    notes: typeof json.body === 'string' ? json.body.slice(0, MAX_NOTES_CHARS) : '',
    url: pageUrl,
    publishedAt: Number.isFinite(published) ? new Date(published).toISOString() : null,
    assets: Array.isArray(json.assets) ? json.assets.map((a) => parseAsset(a, downloadPrefix)).filter(Boolean) : [],
  };
}

/**
 * The update for `current` in GitHub's list of releases (…/releases, the
 * preview channel's feed): the release with the highest version above it,
 * pre-releases included, drafts never. Null when none is newer, or when
 * `list` is not a list.
 *
 * With `kind`, only a release that carries that install's file counts: the
 * nightly previews are the desktop's alone (.github/workflows/nightly.yml),
 * and one without an APK is nothing the GitHub APK could install.
 *
 * @param {unknown} list
 * @param {string} current
 * @param {{ downloadPrefix?: string | readonly string[], releasesPage?: string, kind?: string }} [opts]
 */
function newestRelease(list, current, opts = {}) {
  if (!Array.isArray(list)) return null;
  const { kind, ...parse } = opts;
  let best = null;
  for (const json of list) {
    const release = parseRelease(json, { ...parse, prerelease: true });
    if (!release || !isNewer(release.version, current, { prerelease: true })) continue;
    if (kind && ASSET_PATTERN[kind] && !pickAsset(release, kind)) continue;
    if (!best || compareVersions(release.version, best.version) > 0) best = release;
  }
  return best;
}

/** The file of `release` that updates an install of `kind`, or null. */
function pickAsset(release, kind) {
  const pattern = ASSET_PATTERN[kind];
  if (!release || !pattern) return null;
  return release.assets.find((a) => pattern.test(a.name)) ?? null;
}

// The list starts with the newest releases; a preview is never far down it.
const LIST_PAGE_SIZE = 100;

/** The list of releases beside `feedUrl` (…/releases/latest → …/releases), or null when there is none. */
function listUrl(feedUrl) {
  if (typeof feedUrl !== 'string' || !feedUrl.endsWith('/latest')) return null;
  return `${feedUrl.slice(0, -'/latest'.length)}?per_page=${LIST_PAGE_SIZE}`;
}

/**
 * Which releases are offered: `stable` asks for the latest release, which
 * GitHub never lets a pre-release be; `preview` reads the list of releases,
 * pre-releases included (newestRelease). Anything stored that is not a
 * channel is the stable one.
 */
const channelOf = (value) => (value === 'preview' ? 'preview' : 'stable');

/**
 * Whether this start moves the install from the Nightly channel back to
 * Stabil: a release build (6.0.0, owner 2026-11-07: everyone on Nightly to
 * Stabil for now), with the channel on Nightly, that has not moved it before
 * (`moved`) — once, so a Nightly picked again afterwards stays. `moved` is
 * also what a channel picked by hand leaves (pickedMarker): the move is for
 * the installs that were on Nightly before 6.0.0, never for a choice made
 * since. Never a pre-release or a development build. As
 * src-tauri/src/updater/logic.rs moves_to_stable.
 */
function movesToStable(stored, current, moved) {
  const v = parseVersion(current);
  return channelOf(stored) === 'preview' && !moved && !!v && !v.pre;
}

/**
 * What picking a channel stores as movesToStable's `moved`, on `current`: the
 * choice stands. Without it, Nightly picked on a release build that never
 * moved was taken back to Stabil at the next start.
 */
const pickedMarker = (current) => (typeof current === 'string' && current ? current : 'picked');

/**
 * The phase a check ends in that found the newer release `version`, given
 * where it started (`before`: the phase and the offered version then). An
 * update already downloaded stays ready for the same release — the check
 * itself shows 'checking' meanwhile, which is why the start is passed in.
 */
function phaseAfterCheck(before, version) {
  return !!before && before.phase === 'ready' && !!version && before.version === version ? 'ready' : 'available';
}

/**
 * The phase a failed check goes back to: an offer it started with — on offer
 * or downloaded — stays what it was, the release still shown; with none,
 * 'idle', which claims nothing about being up to date.
 */
function phaseAfterFailedCheck(before) {
  const held = !!before && !!before.version && (before.phase === 'ready' || before.phase === 'available');
  return held ? before.phase : 'idle';
}

module.exports = {
  REPO,
  FEED_URL,
  RELEASES_PAGE,
  DOWNLOAD_PREFIX,
  DOWNLOAD_PREFIXES,
  MAX_NOTES_CHARS,
  RETRY_DELAY_MS,
  passingFailure,
  movesToStable,
  pickedMarker,
  phaseAfterCheck,
  phaseAfterFailedCheck,
  rateLimitWait,
  channelOf,
  parseVersion,
  compareVersions,
  isDevBuild,
  isNewer,
  releasePageOr,
  parseRelease,
  newestRelease,
  pickAsset,
  listUrl,
};
