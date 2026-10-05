'use strict';

// The updater's decisions, kept apart from Electron and the network so they
// can be tested on their own (update-logic.test.cjs): which release counts as
// newer, which of its files this copy of the app needs, and whether that file
// can be checked before it runs. Everything that comes from the network is
// data — nothing in here throws on odd input, it answers "no update".

const path = require('node:path');

// The repository is to follow the app's rename (Sooskasse-FinTS → Girovo).
// After a rename GitHub forwards the old name's API and download URLs, but
// its answers then carry the new name — so a release's files count as ours
// under either. The feed keeps the old name: before the rename the new one
// does not exist yet, after it the old one is forwarded.
const REPO = 'elNino0916/Sooskasse-FinTS';
const RENAMED_REPO = 'elNino0916/Girovo';
const FEED_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases`;
const RELEASES_PAGES = [RELEASES_PAGE, `https://github.com/${RENAMED_REPO}/releases`];
const DOWNLOAD_PREFIX = `https://github.com/${REPO}/releases/download/`;
const DOWNLOAD_PREFIXES = [DOWNLOAD_PREFIX, `https://github.com/${RENAMED_REPO}/releases/download/`];

// A release's executables are ~100 MB; a file far past that is not ours.
const MAX_ASSET_BYTES = 1024 * 1024 * 1024;
// Release notes are shown in a dialog, not archived.
const MAX_NOTES_CHARS = 20_000;

/** The file of a release that updates each kind of install (see installKind). */
const ASSET_PATTERN = {
  nsis: /-Setup\.exe$/i,
  portable: /-portable\.exe$/i,
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
 * Whether the release `candidate` is an update for the running `current`.
 *
 * Semver, with one turn for this project's development builds: CI stamps them
 * `<package.json version>-dev.<run>`, and package.json keeps the last
 * release's number until the next one is cut — so 4.0.0-dev.57 is built from
 * code *after* 4.0.0, not before it. For a dev build a release only counts as
 * newer when its x.y.z is higher. Any other pre-release (4.1.0-beta.1) does
 * come before its release, as semver has it. A pre-release is never offered.
 */
function isNewer(candidate, current) {
  const c = parseVersion(candidate);
  const v = parseVersion(current);
  if (!c || !v || c.pre) return false;
  const order = compareCore(c.core, v.core);
  if (order !== 0) return order > 0;
  return !!v.pre && !/^dev(?:\.|$)/i.test(v.pre);
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
 * GitHub's "latest release" answer, reduced to what the updater needs — or
 * null when it is not a usable release (a draft, a pre-release, a tag that is
 * not a version).
 */
function parseRelease(json, { downloadPrefix = DOWNLOAD_PREFIXES, releasesPage = RELEASES_PAGE } = {}) {
  if (!json || typeof json !== 'object' || json.draft || json.prerelease) return null;
  const parsed = parseVersion(json.tag_name);
  if (!parsed || parsed.pre) return null;
  const version = parsed.core.join('.');
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
 *   manual    anything else, e.g. an unpacked build: the download page
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
  parseVersion,
  isNewer,
  releasePageOr,
  parseRelease,
  pickAsset,
  tagUrl,
  pickBlockmap,
  parseBlockmap,
  planDifferential,
  installKind,
  installArgs,
};
