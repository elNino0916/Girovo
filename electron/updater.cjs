'use strict';

// In-app updates for the Windows build, from this project's GitHub releases.
//
// Deliberately not electron-updater: that wants a latest.yml published next
// to every release and a second set of node_modules in the app archive, while
// the shell otherwise needs nothing but Electron and Node. The releases
// already carry everything required — the Setup.exe and the portable .exe —
// and GitHub computes a SHA-256 digest for every uploaded file and lists it in
// the release's API answer. A download is checked against that digest before
// it is kept, and once more right before it runs.
//
// What it does, in order, and only ever that:
//   check     one GET to api.github.com for the latest release — no account,
//             no identifier; the request says nothing but the app's version
//             (main.cjs sets the User-Agent). Automatically 15 s after start
//             and every 6 hours, unless the user switched that off.
//   download  only when the user asks for it (a banking app is not replaced
//             behind anyone's back), with progress, cancellable. For an
//             installed copy usually only the part of the Setup.exe that
//             changed: see "differential" below. The whole file otherwise.
//   install   only when the user asks for it: the Setup.exe runs silently over
//             the existing install and starts the app again; the portable
//             build saves the new .exe beside the old one and starts that.
//
// Everything Electron-specific (fetch, spawn, quit, the window) comes in
// through createUpdater's arguments, so updater.test.cjs can drive the whole
// flow against a local server.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const logic = require('./update-logic.cjs');

const PREF_AUTO = 'fints.updates.auto';
const FIRST_CHECK_DELAY_MS = 15_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60_000;
// Turning the automatic check on runs one soon, so the switch visibly does something.
const AUTO_ON_DELAY_MS = 1_500;
const CHECK_TIMEOUT_MS = 20_000;
const PROGRESS_EVERY_MS = 200;
const STALL_MS = 60_000;
const STALL_CHECK_MS = 5_000;
const MAX_FEED_BYTES = 2 * 1024 * 1024;
// A blockmap of a ~100 MB installer is ~120 KB gzipped, ~600 KB unpacked.
const MAX_BLOCKMAP_BYTES = 4 * 1024 * 1024;
const MAX_BLOCKMAP_JSON_BYTES = 32 * 1024 * 1024;
// GitHub answers one byte range per request (several in one: HTTP 501), and
// each one goes through a redirect first, so a few run side by side.
const RANGE_REQUESTS_AT_ONCE = 4;
// Even a release that changes nearly everything (a new Electron) leaves a few
// MB as they were, and its changed ranges merge into about ten requests — so
// any reuse is worth it. Only a blockmap scattered into hundreds of ranges is
// not: one plain download is quicker than that many requests.
const DIFF_MAX_REQUESTS = 400;
const COPY_CHUNK_BYTES = 1024 * 1024;
// Written right before an install starts, read by the version that comes up
// next: either it is the new one ("Aktualisiert auf …") or the update did not
// happen, which is worth saying.
const MARKER = 'installing.json';
const MARKER_MAX_AGE_MS = 24 * 60 * 60_000;

/** A failure whose message is already fit for the user (German). */
class UpdateError extends Error {}

function describe(err, during) {
  if (err instanceof UpdateError) return err.message;
  const code = err?.code;
  if (code === 'ENOSPC') return 'Auf dem Laufwerk ist nicht genug Platz für das Update.';
  if (code === 'EACCES' || code === 'EPERM' || code === 'EBUSY') {
    return during === 'install'
      ? 'Das Update konnte nicht gestartet werden – die Datei ist gesperrt. Ein Virenscanner prüft sie vielleicht noch; versuche es gleich noch einmal.'
      : 'Die Datei konnte nicht gespeichert werden – der Ordner ist schreibgeschützt oder gesperrt.';
  }
  if (code === 'ENOENT' && during === 'install') return 'Die heruntergeladene Datei ist nicht mehr da. Lade das Update noch einmal herunter.';
  if (err?.name === 'TimeoutError') return 'GitHub hat nicht rechtzeitig geantwortet. Versuche es später noch einmal.';
  // Chromium's network errors (net::ERR_…) and Node's, for the tests.
  const message = String(err?.message || '');
  if (/net::ERR_|fetch failed|terminated|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(message)) {
    return during === 'download'
      ? 'Die Verbindung zu GitHub ist abgebrochen. Versuche es noch einmal.'
      : 'Keine Verbindung zu GitHub. Bist du mit dem Internet verbunden?';
  }
  return during === 'check'
    ? 'Die Suche nach Updates hat nicht geklappt.'
    : during === 'download'
      ? 'Der Download hat nicht geklappt.'
      : 'Das Update konnte nicht gestartet werden.';
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Renames, retrying while Windows reports the file busy — a virus scanner looks at every new .exe. */
async function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.promises.rename(from, to);
      return;
    } catch (err) {
      if (attempt >= 8 || !['EPERM', 'EACCES', 'EBUSY'].includes(err?.code)) throw err;
      await pause(150 * (attempt + 1));
    }
  }
}

/** SHA-256 of a file as hex, or null when it cannot be read. */
async function sha256File(file) {
  try {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
  } catch {
    return null;
  }
}

/** Whether `file` is exactly the release file `asset`: its size, then its digest. */
async function fileMatches(file, asset) {
  if (!file || !asset?.sha256) return false;
  try {
    const stat = await fs.promises.stat(file);
    if (!stat.isFile() || stat.size !== asset.size) return false;
  } catch {
    return false;
  }
  return (await sha256File(file)) === asset.sha256;
}

/** A response body, refusing anything larger than `max` bytes. */
async function readBytes(res, max) {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      reader.cancel().catch(() => {});
      throw new UpdateError('Die Antwort von GitHub war unverständlich.');
    }
    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }
  return Buffer.concat(chunks);
}

/** Writes `length` bytes of `buf` to `handle` at `position`, all of them. */
async function writeAt(handle, buf, length, position) {
  for (let done = 0; done < length; ) {
    const { bytesWritten } = await handle.write(buf, done, length - done, position + done);
    done += bytesWritten;
  }
}

/**
 * @param {object} deps
 * @param {string} deps.currentVersion  app.getVersion()
 * @param {'nsis'|'portable'|'manual'|'dev'} deps.kind  see update-logic.installKind
 * @param {(url: string, init?: object) => Promise<Response>} deps.fetch
 * @param {string} deps.cacheDir  where the Setup.exe is downloaded to
 * @param {string|null} [deps.portableDir]  the portable .exe's folder
 * @param {string|null} [deps.downloadsDir]  where a portable update goes if its folder is read-only
 * @param {string|null} [deps.baseFile]  the Setup.exe this install came from (build/installer.nsh keeps
 *   a copy), which a differential download builds the next one from
 * @param {boolean} [deps.autoCheck]  whether automatic checks may run at all in this build
 * @param {(key: string) => string|null|undefined} deps.getPref
 * @param {(key: string, value: string) => void} deps.setPref
 * @param {(state: object) => void} [deps.send]  pushes every state change to the window
 * @param {(file: string, args: string[], opts: { cwd: string }) => Promise<number|undefined>} deps.spawnDetached  answers the pid
 * @param {(info: { installerPid: number|undefined, version: string }) => Promise<void>} [deps.showInstallWindow]
 *   shows the install's progress after the app has quit (main.cjs)
 * @param {() => void} deps.quit
 * @param {(url: string) => unknown} deps.openExternal
 */
function createUpdater(deps) {
  const {
    currentVersion, kind, fetch, cacheDir, portableDir = null, downloadsDir = null, baseFile = null, autoCheck = true,
    getPref, setPref, send = () => {}, spawnDetached, showInstallWindow = null, quit, openExternal,
    feedUrl = logic.FEED_URL, downloadPrefix = logic.DOWNLOAD_PREFIXES, releasesPage = logic.RELEASES_PAGE,
    previousExe = null, now = Date.now, log = console,
  } = deps;

  const installable = kind === 'nsis' || kind === 'portable';

  /**
   * The release found newer than this version, its file for this install
   * (null: not installable here), and the plan for building that file from
   * the installed one (null: download it whole).
   */
  let pending = null;
  /** The verified download, once there is one. */
  let readyFile = null;
  /** @type {AbortController | null} */
  let abort = null;
  /** @type {Promise<object> | null} */
  let checking = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;

  let state = {
    current: currentVersion,
    kind,
    auto: getPref(PREF_AUTO) !== 'off',
    /** idle · checking · current · available · downloading · ready · installing */
    phase: 'idle',
    checkedAt: null,
    /** { version, name, notes, url, publishedAt, size, canInstall } of the newer release */
    release: null,
    received: 0,
    total: 0,
    /** The folder a portable update was saved to — the user should know where it went. */
    location: null,
    /** { during: 'check'|'download'|'install', message } — the last thing that went wrong, for the user */
    error: null,
    /** { version, from, notes, url, previousFile } — set when this start is the result of an update */
    installed: null,
    /** The version an install was started for that did not come up — said once, at the next start. */
    failedInstall: null,
  };

  function set(patch) {
    state = { ...state, ...patch };
    try {
      send(state);
    } catch { /* the window is gone; the next one asks for the state */ }
  }

  function publicRelease(release, asset, plan) {
    return {
      version: release.version,
      name: release.name,
      notes: release.notes,
      url: release.url,
      publishedAt: release.publishedAt,
      // What the download costs: only the changed part when there is a plan.
      size: asset ? (plan ? plan.fetchBytes : asset.size) : null,
      canInstall: installable && !!asset,
    };
  }

  // ---- files ---------------------------------------------------------------

  /** Where a download of `asset` lands, in order of preference. */
  function candidateDirs() {
    if (kind === 'portable') return [portableDir, downloadsDir].filter(Boolean);
    return [cacheDir];
  }

  async function writable(dir) {
    const probe = path.join(dir, `.girovo-update-${process.pid}.tmp`);
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      const handle = await fs.promises.open(probe, 'wx');
      await handle.close();
      await fs.promises.rm(probe, { force: true });
      return true;
    } catch {
      return false;
    }
  }

  /** A verified copy of `asset` that is already on disk — from an earlier session, or a manual download. */
  async function findDownloaded(asset) {
    if (!asset) return null;
    for (const dir of candidateDirs()) {
      const file = path.join(dir, asset.name);
      if (await fileMatches(file, asset)) return file;
    }
    return null;
  }

  /**
   * Empties the download folder of earlier rounds — installers that are
   * installed or outdated, and halves of interrupted downloads. Only the
   * updater's own folder: a portable update saved beside the app is the
   * user's file from then on.
   */
  async function clearCache(keep = null) {
    let names = [];
    try {
      names = await fs.promises.readdir(cacheDir);
    } catch {
      return;
    }
    await Promise.all(
      names
        .filter((n) => n !== MARKER && n !== keep && /\.(exe|partial)$/i.test(n))
        .map((n) => fs.promises.rm(path.join(cacheDir, n), { force: true }).catch(() => {})),
    );
  }

  /**
   * Streams the response into `file`, hashing on the way, and answers the
   * hex digest. Throws — leaving the cleanup to the caller — when the body is
   * longer or shorter than the release said, or the disk refuses it.
   */
  async function save(body, file, expected, onChunk) {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(file, { mode: 0o600 });
    let writeError = null;
    out.on('error', (err) => {
      writeError ??= err;
    });
    const closed = new Promise((resolve) => out.once('close', resolve));
    const reader = body.getReader();
    let received = 0;
    try {
      for (;;) {
        if (writeError) throw writeError;
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > expected) throw new UpdateError('Die Datei ist größer als angekündigt und wurde verworfen.');
        hash.update(value);
        // A stream that failed (or never opened) neither drains nor closes
        // twice: only wait on one that is still open.
        if (!out.write(value) && !out.closed) {
          await new Promise((resolve) => {
            const go = () => {
              out.off('drain', go);
              out.off('close', go);
              resolve();
            };
            out.once('drain', go);
            out.once('close', go);
          });
        }
        onChunk(received);
      }
      if (received !== expected) throw new UpdateError('Der Download wurde unterbrochen. Versuche es noch einmal.');
      out.end();
      await closed;
      if (writeError) throw writeError;
    } catch (err) {
      reader.cancel().catch(() => {});
      out.destroy();
      await closed;
      throw err;
    }
    return hash.digest('hex');
  }

  // ---- the marker across the restart ---------------------------------------

  const markerFile = () => path.join(cacheDir, MARKER);

  async function writeMarker(data) {
    await fs.promises.mkdir(cacheDir, { recursive: true });
    await fs.promises.writeFile(markerFile(), JSON.stringify(data), { mode: 0o600 });
  }

  function readMarker() {
    let marker;
    try {
      marker = JSON.parse(fs.readFileSync(markerFile(), 'utf8'));
    } catch {
      return;
    }
    try {
      fs.rmSync(markerFile(), { force: true });
    } catch { /* read once is enough; a leftover is ignored by its age */ }
    if (!marker || typeof marker !== 'object') return;
    const to = typeof marker.to === 'string' ? marker.to : '';
    if (to === currentVersion) {
      const url = logic.releasePageOr(marker.url, releasesPage);
      state.installed = {
        version: currentVersion,
        from: typeof marker.from === 'string' ? marker.from.slice(0, 40) : '',
        notes: typeof marker.notes === 'string' ? marker.notes.slice(0, logic.MAX_NOTES_CHARS) : '',
        url,
        // The old portable .exe stays where it was; the user may want to delete it.
        previousFile: typeof marker.previousFile === 'string' && path.isAbsolute(marker.previousFile)
          ? marker.previousFile
          : null,
      };
      void clearCache();
    } else if (Number.isFinite(marker.at) && now() - marker.at < MARKER_MAX_AGE_MS && logic.isNewer(to, currentVersion)) {
      state.failedInstall = to;
      state.error = {
        during: 'install',
        message: `Das Update auf Version ${to} wurde nicht abgeschlossen. Du kannst es noch einmal versuchen.`,
      };
    }
  }

  // ---- check ---------------------------------------------------------------

  /** The release at `url` (GitHub's API), or null when there is none (HTTP 404). */
  async function fetchRelease(url) {
    const res = await fetch(url, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      cache: 'no-store',
    });
    // No release published at all yet, or none under that tag.
    if (res.status === 404) return null;
    if (res.status === 403 || res.status === 429) {
      throw new UpdateError('GitHub nimmt gerade keine weiteren Anfragen an. Versuche es später noch einmal.');
    }
    if (!res.ok) throw new UpdateError(`GitHub hat mit einem Fehler geantwortet (HTTP ${res.status}).`);
    let json;
    try {
      json = JSON.parse((await readBytes(res, MAX_FEED_BYTES)).toString('utf8'));
    } catch (err) {
      if (err instanceof UpdateError) throw err;
      throw new UpdateError('Die Antwort von GitHub war unverständlich.');
    }
    const release = logic.parseRelease(json, { downloadPrefix, releasesPage });
    if (!release) throw new UpdateError('Die Antwort von GitHub war unverständlich.');
    return release;
  }

  // ---- differential --------------------------------------------------------
  //
  // An update rarely changes more than a few MB of the ~110 MB Setup.exe.
  // electron-builder writes a blockmap beside every installer — the
  // checksums of its content-defined chunks — and a release carries it next
  // to the Setup.exe. Compared with the blockmap of the installed version's
  // Setup.exe, it says which chunks the installed copy already has: those are
  // copied from that file (baseFile), the rest is fetched from the release
  // with HTTP range requests.
  //
  // None of this is trusted: the file put together this way is checked
  // against GitHub's digest exactly like a whole download, and anything that
  // does not work out — no base file, no blockmap, a server that ignores
  // ranges, a digest that does not match — means the whole file after all.

  /** A small release file (a blockmap), checked against its digest when GitHub lists one. */
  async function fetchSmall(asset, max) {
    const res = await fetch(asset.url, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS), cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${asset.name}`);
    const buf = await readBytes(res, max);
    if (buf.length !== asset.size) throw new Error(`${asset.name} is not the announced size`);
    if (asset.sha256 && crypto.createHash('sha256').update(buf).digest('hex') !== asset.sha256) {
      throw new Error(`${asset.name} does not match its digest`);
    }
    return buf;
  }

  async function fetchBlockmap(asset, fileSize) {
    const json = JSON.parse(
      zlib.gunzipSync(await fetchSmall(asset, MAX_BLOCKMAP_BYTES), { maxOutputLength: MAX_BLOCKMAP_JSON_BYTES }).toString('utf8'),
    );
    const chunks = logic.parseBlockmap(json, fileSize);
    if (!chunks) throw new Error(`${asset.name} is not a blockmap of its installer`);
    return chunks;
  }

  /** The release of the running version, by its tag ("4.1.0" or "v4.1.0"). */
  async function fetchCurrentRelease() {
    for (const tag of [currentVersion, `v${currentVersion}`]) {
      const url = logic.tagUrl(feedUrl, tag);
      if (!url) return null;
      const release = await fetchRelease(url);
      if (release) return release.version === currentVersion ? release : null;
    }
    return null;
  }

  /**
   * How to put `asset` (the new Setup.exe) together from baseFile, or null
   * when it cannot be or is not worth it. Never throws.
   */
  async function planDifferential(release, asset) {
    if (kind !== 'nsis' || !baseFile || !asset) return null;
    try {
      const newMap = logic.pickBlockmap(release, asset);
      // A dev build is no release; nothing to compare its installer with.
      if (!newMap || logic.parseVersion(currentVersion)?.pre) return null;
      await fs.promises.access(baseFile, fs.constants.R_OK);
      const current = await fetchCurrentRelease();
      const oldAsset = logic.pickAsset(current, kind);
      const oldMap = logic.pickBlockmap(current, oldAsset);
      if (!oldMap) return null;
      // The installed copy came from that very file — a local build of the
      // same version does not, and its chunks would be the wrong ones.
      if (!(await fileMatches(baseFile, oldAsset))) return null;
      const plan = logic.planDifferential(
        await fetchBlockmap(oldMap, oldAsset.size),
        await fetchBlockmap(newMap, asset.size),
      );
      // Nothing to reuse: that is just the whole file, in ranges.
      if (plan.copies.length === 0 || plan.fetches.length > DIFF_MAX_REQUESTS) return null;
      return plan;
    } catch (err) {
      log.warn('[updater] no differential download:', err?.message || err);
      return null;
    }
  }

  /** One planned byte range of `asset`, written into `out` where it belongs. */
  async function fetchRange(asset, range, out, signal, onBytes) {
    const end = range.start + range.size - 1;
    const res = await fetch(asset.url, { headers: { Range: `bytes=${range.start}-${end}` }, signal, cache: 'no-store' });
    const got = /^bytes (\d+)-(\d+)\/(?:\d+|\*)$/.exec(res.headers.get('content-range') || '');
    // A server that ignores the range answers 200 with the whole file.
    if (res.status !== 206 || !res.body || !got || Number(got[1]) !== range.start || Number(got[2]) !== end) {
      res.body?.cancel().catch(() => {});
      throw new Error(`HTTP ${res.status} for bytes ${range.start}-${end}`);
    }
    const reader = res.body.getReader();
    let at = range.start;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (at + value.byteLength > range.start + range.size) throw new Error('a range longer than asked for');
        await writeAt(out, Buffer.from(value.buffer, value.byteOffset, value.byteLength), value.byteLength, at);
        at += value.byteLength;
        onBytes(value.byteLength);
      }
    } catch (err) {
      reader.cancel().catch(() => {});
      throw err;
    }
    if (at !== range.start + range.size) throw new Error('a range shorter than asked for');
  }

  /**
   * Builds `asset` into `partial` by `plan` and checks it against GitHub's
   * digest. True when that worked; false when the whole file should be
   * downloaded instead. Throws only when `signal` was aborted.
   */
  async function buildDifferential(plan, asset, partial, signal, onChunk, keepAlive) {
    // One failed range stops the others.
    const local = new AbortController();
    const both = AbortSignal.any([signal, local.signal]);
    let out = null;
    let base = null;
    try {
      await fs.promises.mkdir(path.dirname(partial), { recursive: true });
      out = await fs.promises.open(partial, 'w', 0o600);
      base = await fs.promises.open(baseFile, 'r');
      const buf = Buffer.allocUnsafe(COPY_CHUNK_BYTES);
      for (const copy of plan.copies) {
        for (let done = 0; done < copy.size; ) {
          if (signal.aborted) throw signal.reason;
          const length = Math.min(COPY_CHUNK_BYTES, copy.size - done);
          const { bytesRead } = await base.read(buf, 0, length, copy.from + done);
          if (bytesRead !== length) throw new Error('the base file is shorter than its blockmap');
          await writeAt(out, buf, length, copy.to + done);
          done += length;
        }
        keepAlive();
      }
      await base.close();
      base = null;

      const queue = plan.fetches.slice();
      let received = 0;
      const onBytes = (n) => {
        received += n;
        onChunk(received);
      };
      let failure = null;
      const worker = async () => {
        try {
          for (let range = queue.shift(); range && !failure; range = queue.shift()) {
            await fetchRange(asset, range, out, both, onBytes);
          }
        } catch (err) {
          failure ??= err;
          local.abort();
        }
      };
      // All of them settled before the file is closed — none still writing.
      await Promise.all(Array.from({ length: Math.min(RANGE_REQUESTS_AT_ONCE, queue.length) }, worker));
      if (failure) throw failure;
      await out.close();
      out = null;
      if (!(await fileMatches(partial, asset))) throw new Error('the assembled file does not match the digest');
      return true;
    } catch (err) {
      if (signal.aborted) throw err;
      log.warn('[updater] differential download failed, downloading the whole file:', err?.message || err);
      return false;
    } finally {
      await base?.close().catch(() => {});
      await out?.close().catch(() => {});
    }
  }

  // ---- check ---------------------------------------------------------------

  async function runCheck(manual) {
    const before = state.phase;
    set({ phase: 'checking', ...(manual ? { error: null } : {}) });
    try {
      const release = await fetchRelease(feedUrl);
      const checkedAt = now();
      if (!release || !logic.isNewer(release.version, currentVersion)) {
        pending = null;
        readyFile = null;
        await clearCache();
        set({ phase: 'current', checkedAt, release: null, location: null, received: 0, total: 0, error: null });
        return state;
      }
      const asset = installable ? logic.pickAsset(release, kind) : null;
      // Without GitHub's digest there is nothing to check the file against —
      // offered as a download page then, never run from here.
      const usable = asset && asset.sha256 ? asset : null;
      const sameFile = pending?.asset && usable && pending.asset.sha256 === usable.sha256;
      pending = { release, asset: usable, plan: sameFile ? pending.plan : null };
      if (!sameFile) readyFile = null;
      const file = readyFile || (await findDownloaded(usable));
      readyFile = file;
      if (!file && !pending.plan) pending.plan = await planDifferential(release, usable);
      // Installers of other versions are of no use any more.
      await clearCache(file && path.dirname(file) === cacheDir ? path.basename(file) : null);
      set({
        phase: file ? 'ready' : 'available',
        checkedAt,
        release: publicRelease(release, usable, file ? null : pending.plan),
        location: file && kind === 'portable' ? path.dirname(file) : null,
        received: 0,
        total: 0,
        error: null,
      });
    } catch (err) {
      log.warn('[updater] check failed:', err?.message || err);
      // Back to where it was. An automatic check fails quietly — being
      // offline at start is not worth a message.
      set({
        phase: before === 'checking' ? 'idle' : before,
        ...(manual ? { error: { during: 'check', message: describe(err, 'check') } } : {}),
      });
    }
    return state;
  }

  function check({ manual = false } = {}) {
    if (checking) return checking;
    if (state.phase === 'downloading' || state.phase === 'installing') return Promise.resolve(state);
    checking = runCheck(manual).finally(() => {
      checking = null;
    });
    return checking;
  }

  // ---- download ------------------------------------------------------------

  async function download() {
    if (state.phase !== 'available' || !pending?.asset || abort) return state;
    const { asset, plan } = pending;
    const controller = new AbortController();
    abort = controller;
    set({ phase: 'downloading', received: 0, total: plan ? plan.fetchBytes : asset.size, error: null });
    let partial = null;
    // A connection can go quiet without ever failing; a download that has not
    // moved for a minute is given up rather than left spinning.
    let lastData = now();
    let stalled = false;
    const watchdog = setInterval(() => {
      if (now() - lastData > STALL_MS) {
        stalled = true;
        controller.abort();
      }
    }, STALL_CHECK_MS);
    watchdog.unref?.();
    let lastReport = 0;
    const onChunk = (received) => {
      const t = now();
      lastData = t;
      if (t - lastReport >= PROGRESS_EVERY_MS) {
        lastReport = t;
        set({ received });
      }
    };
    const keepAlive = () => {
      lastData = now();
    };
    try {
      let dir = null;
      for (const candidate of candidateDirs()) {
        if (await writable(candidate)) {
          dir = candidate;
          break;
        }
      }
      if (!dir) throw new UpdateError('Es gibt keinen Ordner, in dem die neue Version gespeichert werden kann.');
      const file = path.join(dir, asset.name);
      partial = `${file}.partial`;
      const built = plan
        ? await buildDifferential(plan, asset, partial, controller.signal, onChunk, keepAlive)
        : false;
      if (!built) {
        if (plan) {
          // The whole file now, and on a retry; the next check plans afresh.
          if (pending?.asset === asset) pending.plan = null;
          lastReport = 0;
          set({ received: 0, total: asset.size, release: state.release && { ...state.release, size: asset.size } });
        }
        const res = await fetch(asset.url, { signal: controller.signal, cache: 'no-store' });
        if (!res.ok || !res.body) throw new UpdateError(`Der Download ist fehlgeschlagen (HTTP ${res.status}).`);
        const digest = await save(res.body, partial, asset.size, onChunk);
        if (digest !== asset.sha256) {
          throw new UpdateError('Die Datei stimmt nicht mit der Prüfsumme von GitHub überein und wurde gelöscht.');
        }
      }
      await renameWithRetry(partial, file);
      partial = null;
      readyFile = file;
      set({ phase: 'ready', received: asset.size, location: kind === 'portable' ? dir : null });
    } catch (err) {
      if (partial) await fs.promises.rm(partial, { force: true }).catch(() => {});
      if (controller.signal.aborted && !stalled) {
        set({ phase: 'available', received: 0, total: 0 });
      } else {
        log.warn('[updater] download failed:', stalled ? 'stalled' : err?.message || err);
        const message = stalled
          ? 'Die Verbindung zu GitHub ist abgebrochen. Versuche es noch einmal.'
          : describe(err, 'download');
        set({ phase: 'available', received: 0, total: 0, error: { during: 'download', message } });
      }
    } finally {
      clearInterval(watchdog);
      if (abort === controller) abort = null;
    }
    return state;
  }

  function cancel() {
    abort?.abort();
    return state;
  }

  // ---- install -------------------------------------------------------------

  async function install() {
    const args = logic.installArgs(kind);
    if (state.phase !== 'ready' || !readyFile || !pending?.asset || !args) return state;
    const file = readyFile;
    let installerPid;
    const { release, asset } = pending;
    set({ phase: 'installing', error: null });
    try {
      // It has been lying on disk since it was checked: check it again, right before it runs.
      if (!(await fileMatches(file, asset))) {
        readyFile = null;
        if (path.dirname(file) === cacheDir) await fs.promises.rm(file, { force: true }).catch(() => {});
        throw new UpdateError('Die heruntergeladene Datei fehlt oder wurde verändert. Lade das Update noch einmal herunter.');
      }
      await writeMarker({
        from: currentVersion,
        to: release.version,
        at: now(),
        notes: release.notes,
        url: release.url,
        previousFile: kind === 'portable' ? previousExe : null,
      });
      installerPid = await spawnDetached(file, args, { cwd: path.dirname(file) });
    } catch (err) {
      await fs.promises.rm(markerFile(), { force: true }).catch(() => {});
      log.warn('[updater] install failed:', err?.message || err);
      set({ phase: readyFile ? 'ready' : 'available', error: { during: 'install', message: describe(err, 'install') } });
      return state;
    }
    // The silent installer shows nothing for half a minute; a window of
    // ours stands in for the app until the new version is up. Only a nicety:
    // the update goes on the same without it.
    if (kind === 'nsis' && showInstallWindow) {
      try {
        await showInstallWindow({ installerPid, version: release.version });
      } catch (err) {
        log.warn('[updater] no install window:', err?.message || err);
      }
    }
    // Quitting closes the window and ends the bank session like any other
    // quit; the installer waits for that before it touches a file
    // (build/installer.nsh).
    quit();
    return state;
  }

  // ---- settings and schedule -----------------------------------------------

  function schedule(delay) {
    if (timer) clearTimeout(timer);
    timer = null;
    if (delay == null || !state.auto || !autoCheck) return;
    timer = setTimeout(async () => {
      timer = null;
      await check({ manual: false });
      schedule(CHECK_INTERVAL_MS);
    }, delay);
    timer.unref?.();
  }

  function setAuto(on) {
    const auto = on === true;
    setPref(PREF_AUTO, auto ? 'on' : 'off');
    set({ auto });
    schedule(auto ? AUTO_ON_DELAY_MS : null);
    return state;
  }

  function openRelease() {
    const url = state.release?.url || state.installed?.url || releasesPage;
    if (url.startsWith(releasesPage)) void openExternal(url);
    return state;
  }

  function start() {
    readMarker();
    // Halves of downloads a crash or a quit cut off.
    void fs.promises
      .readdir(cacheDir)
      .then((names) => Promise.all(
        names.filter((n) => n.endsWith('.partial')).map((n) => fs.promises.rm(path.join(cacheDir, n), { force: true })),
      ))
      .catch(() => {});
    schedule(FIRST_CHECK_DELAY_MS);
  }

  function stop() {
    if (timer) clearTimeout(timer);
    timer = null;
    abort?.abort();
  }

  return {
    getState: () => state,
    start,
    stop,
    check,
    download,
    cancel,
    install,
    setAuto,
    openRelease,
  };
}

module.exports = { createUpdater, PREF_AUTO };
