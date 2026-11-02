'use strict';

// The updater's decisions, kept apart from Electron and the network so they
// can be tested on their own (update-logic.test.cjs): which release counts as
// newer, which of its files this copy of the app needs, and whether that file
// can be checked before it runs. Everything that comes from the network is
// data — nothing in here throws on odd input, it answers "no update".

const path = require('node:path');

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

/** The file of a release that updates each kind of install (see installKind). */
const ASSET_PATTERN = {
  nsis: /-Setup\.exe$/i,
  portable: /-portable\.exe$/i,
  // The Android app from GitHub (mobile/bridges/updates.ts); the Google Play
  // build is updated by Play and never asks.
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

/** Two parsed versions in semver's order: a pre-release comes before its release. */
function compareParsed(a, b) {
  const order = compareCore(a.core, b.core);
  if (order !== 0) return order;
  if (!a.pre || !b.pre) return a.pre ? -1 : b.pre ? 1 : 0;
  return comparePre(a.pre, b.pre);
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
 */
function newestRelease(list, current, opts = {}) {
  if (!Array.isArray(list)) return null;
  let best = null;
  for (const json of list) {
    const release = parseRelease(json, { ...opts, prerelease: true });
    if (!release || !isNewer(release.version, current, { prerelease: true })) continue;
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

/** The release-by-tag address beside `feedUrl` (…/releases/latest), or null when there is none. */
function tagUrl(feedUrl, tag) {
  if (typeof feedUrl !== 'string' || !feedUrl.endsWith('/latest')) return null;
  return `${feedUrl.slice(0, -'latest'.length)}tags/${encodeURIComponent(tag)}`;
}

// The list starts with the newest releases; a preview is never far down it.
const LIST_PAGE_SIZE = 20;

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

/** The blockmap electron-builder writes beside `asset` (name + ".blockmap"), if the release has it. */
function pickBlockmap(release, asset) {
  if (!release || !asset) return null;
  return release.assets.find((a) => a.name === `${asset.name}.blockmap`) ?? null;
}

// A blockmap of a ~100 MB installer lists ~5,000 chunks; ten times that is not ours.
const MAX_BLOCKMAP_CHUNKS = 100_000;

/**
 * electron-builder's blockmap (version 2, already un-gzipped and parsed),
 * reduced to its chunks in file order: { checksum, size, offset }. Null
 * unless it is one file starting at 0 whose chunks add up to exactly
 * `fileSize` — the installer it claims to describe.
 */
function parseBlockmap(json, fileSize) {
  if (!json || typeof json !== 'object' || json.version !== '2') return null;
  if (!Array.isArray(json.files) || json.files.length !== 1) return null;
  const { offset, checksums, sizes } = json.files[0] ?? {};
  if (offset !== 0 || !Array.isArray(checksums) || !Array.isArray(sizes)) return null;
  if (checksums.length !== sizes.length || checksums.length === 0 || checksums.length > MAX_BLOCKMAP_CHUNKS) return null;
  const chunks = [];
  let at = 0;
  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i];
    const checksum = checksums[i];
    if (!Number.isSafeInteger(size) || size <= 0 || typeof checksum !== 'string' || !checksum || checksum.length > 128) {
      return null;
    }
    chunks.push({ checksum, size, offset: at });
    at += size;
  }
  return at === fileSize ? chunks : null;
}

/**
 * How to build the new installer from the old one: which of its byte ranges
 * can be copied from the old file and which have to be fetched. A chunk
 * counts as present when the old file has one with the same checksum and
 * size. Fetched ranges closer than `mergeGap` bytes are fetched as one —
 * a request costs more than a few kilobytes.
 *
 * @returns {{ copies: {from: number, to: number, size: number}[],
 *             fetches: {start: number, size: number}[], fetchBytes: number }}
 */
function planDifferential(oldChunks, newChunks, { mergeGap = 64 * 1024 } = {}) {
  const have = new Map();
  for (const c of oldChunks) {
    const key = `${c.size}:${c.checksum}`;
    if (!have.has(key)) have.set(key, c.offset);
  }
  // In file order: runs of copied and fetched chunks, neighbours merged.
  const runs = [];
  for (const c of newChunks) {
    const from = have.get(`${c.size}:${c.checksum}`);
    const last = runs[runs.length - 1];
    if (from === undefined) {
      if (last?.fetch) last.size += c.size;
      else runs.push({ fetch: true, to: c.offset, size: c.size });
    } else if (last && !last.fetch && last.from + last.size === from) {
      last.size += c.size;
    } else {
      runs.push({ fetch: false, from, to: c.offset, size: c.size });
    }
  }
  const copies = [];
  const fetches = [];
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const prev = fetches[fetches.length - 1];
    if (run.fetch) {
      // A short copy between two fetches was folded into the earlier one below.
      if (prev && prev.start + prev.size === run.to) prev.size += run.size;
      else fetches.push({ start: run.to, size: run.size });
    } else if (prev && prev.start + prev.size === run.to && run.size <= mergeGap && runs[i + 1]?.fetch) {
      prev.size += run.size;
    } else {
      copies.push({ from: run.from, to: run.to, size: run.size });
    }
  }
  return { copies, fetches, fetchBytes: fetches.reduce((sum, f) => sum + f.size, 0) };
}

/**
 * How this copy of the app was installed, which decides how it updates:
 *
 *   nsis      installed by the Setup.exe — the next Setup.exe updates it in
 *             place, silently, and starts it again
 *   portable  the portable .exe — the next one is saved beside it and started
 *             instead (electron-builder's portable launcher sets the variable)
 *   manual    anything else, e.g. an unpacked build or the Linux AppImage
 *             and .deb: the download page
 *   dev       not packaged at all
 */
function installKind({ isPackaged, env, execPath, exists }) {
  if (!isPackaged) return 'dev';
  if (env.PORTABLE_EXECUTABLE_FILE) return 'portable';
  const dir = path.dirname(execPath);
  const base = path.basename(execPath, path.extname(execPath));
  // The NSIS installer puts its uninstaller beside the executable, under
  // electron-builder's fixed name.
  if (exists(path.join(dir, `Uninstall ${base}.exe`))) return 'nsis';
  return 'manual';
}

/** The arguments the downloaded file is started with. */
function installArgs(kind) {
  // /S: the NSIS installer runs without its wizard, into the existing
  // install's folder. --updated: electron-builder's flag for "this replaces a
  // running app" (build/installer.nsh waits for it to close on its own).
  // --force-run: start the app again when done — the installer passes
  // --updated on to it, which main.cjs takes as "the old instance may still
  // be closing".
  if (kind === 'nsis') return ['/S', '--updated', '--force-run'];
  // The portable launcher hands its arguments on to the app.
  if (kind === 'portable') return ['--updated'];
  return null;
}

module.exports = {
  REPO,
  FEED_URL,
  RELEASES_PAGE,
  DOWNLOAD_PREFIX,
  DOWNLOAD_PREFIXES,
  MAX_NOTES_CHARS,
  channelOf,
  parseVersion,
  compareVersions,
  isDevBuild,
  isNewer,
  releasePageOr,
  parseRelease,
  newestRelease,
  pickAsset,
  tagUrl,
  listUrl,
  pickBlockmap,
  parseBlockmap,
  planDifferential,
  installKind,
  installArgs,
};
