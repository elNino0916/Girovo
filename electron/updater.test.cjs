'use strict';

// The whole update flow — check, download, verify, install, the restart —
// against a local server standing in for GitHub. Electron is not needed:
// everything it provides comes in through createUpdater's arguments.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { createUpdater, PREF_AUTO } = require('./updater.cjs');

const PAYLOAD = crypto.randomBytes(300_000);
const SHA = crypto.createHash('sha256').update(PAYLOAD).digest('hex');
const SETUP = 'Girovo-9.9.9-Setup.exe';
const PORTABLE = 'Girovo-9.9.9-portable.exe';
const PAGE = 'https://github.com/elNino0916/Girovo/releases';

/** A stand-in for api.github.com and the release downloads; `route` decides per request. */
async function startServer(route) {
  const server = http.createServer((req, res) => route(req, res, base));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  return { base, close: () => new Promise((resolve) => server.close(resolve)) };
}

function releaseJson(base, { tag = '9.9.9', digest = `sha256:${SHA}`, size = PAYLOAD.length } = {}) {
  const asset = (name) => ({ name, size, digest, browser_download_url: `${base}dl/${name}` });
  return {
    tag_name: tag,
    name: `Girovo ${tag}`,
    draft: false,
    prerelease: false,
    body: '## Neu\n- **Updates** direkt in der App',
    html_url: `${PAGE}/tag/${tag}`,
    published_at: '2026-10-10T12:00:00Z',
    assets: [asset(SETUP), asset(PORTABLE)],
  };
}

/** The ordinary release: the feed, and the file exactly as announced. */
const githubLike = (opts) => (req, res, base) => {
  if (req.url === '/latest') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(releaseJson(base, opts)));
  } else if (req.url.startsWith('/dl/')) {
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': PAYLOAD.length });
    res.end(PAYLOAD);
  } else {
    res.writeHead(404).end();
  }
};

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'girovo-updater-test-'));
}

/** An updater wired to fakes; `calls` records what it asked of the app. */
function makeUpdater(base, overrides = {}) {
  const calls = { spawned: [], quit: 0, opened: [], states: [] };
  const prefs = new Map();
  const cacheDir = overrides.cacheDir ?? tempDir();
  const updater = createUpdater({
    currentVersion: '4.0.0',
    kind: 'nsis',
    fetch: (url, init) => fetch(url, init),
    feedUrl: `${base}latest`,
    downloadPrefix: base,
    cacheDir,
    getPref: (k) => prefs.get(k) ?? null,
    setPref: (k, v) => prefs.set(k, v),
    send: (s) => calls.states.push(s),
    spawnDetached: async (file, args, opts) => {
      calls.spawned.push({ file, args, opts });
    },
    quit: () => {
      calls.quit++;
    },
    openExternal: (url) => calls.opened.push(url),
    log: { warn() {} },
    ...overrides,
  });
  return { updater, calls, prefs, cacheDir };
}

test('check → download → install, then the new version greets', async () => {
  const srv = await startServer(githubLike());
  try {
    const { updater, calls, cacheDir } = makeUpdater(srv.base);

    let s = await updater.check({ manual: true });
    assert.equal(s.phase, 'available');
    assert.equal(s.release.version, '9.9.9');
    assert.equal(s.release.canInstall, true);
    assert.equal(s.release.size, PAYLOAD.length);
    assert.equal(s.release.url, `${PAGE}/tag/9.9.9`);
    assert.match(s.release.notes, /Updates/);

    s = await updater.download();
    assert.equal(s.phase, 'ready');
    assert.ok(calls.states.some((x) => x.phase === 'downloading'), 'reports the download');

    s = await updater.install();
    assert.equal(calls.spawned.length, 1);
    const { file, args } = calls.spawned[0];
    assert.equal(file, path.join(cacheDir, SETUP));
    assert.deepEqual(args, ['/S', '--updated', '--force-run']);
    assert.equal(fs.readFileSync(file).equals(PAYLOAD), true);
    assert.equal(calls.quit, 1);
    assert.equal(s.phase, 'installing');

    // The restart: the same folder, now running 9.9.9.
    const next = makeUpdater(srv.base, { currentVersion: '9.9.9', cacheDir });
    next.updater.start();
    next.updater.stop();
    const after = next.updater.getState();
    assert.equal(after.installed.version, '9.9.9');
    assert.equal(after.installed.from, '4.0.0');
    assert.match(after.installed.notes, /Updates/);
    assert.equal(fs.existsSync(path.join(cacheDir, 'installing.json')), false, 'the marker is read once');
  } finally {
    await srv.close();
  }
});

test('an install that did not happen is reported at the next start', async () => {
  const srv = await startServer(githubLike());
  try {
    const { updater, cacheDir } = makeUpdater(srv.base);
    await updater.check({ manual: true });
    await updater.download();
    await updater.install();

    // Still 4.0.0 after the "restart": the installer never ran through.
    const again = makeUpdater(srv.base, { cacheDir });
    again.updater.start();
    again.updater.stop();
    const s = again.updater.getState();
    assert.equal(s.installed, null);
    assert.equal(s.failedInstall, '9.9.9');
    assert.equal(s.error.during, 'install');
    assert.match(s.error.message, /9\.9\.9 wurde nicht abgeschlossen/);

    // …and the downloaded file is still good: the next check offers it at once.
    const checked = await again.updater.check({ manual: false });
    assert.equal(checked.phase, 'ready');
  } finally {
    await srv.close();
  }
});

test('up to date: same version, and a dev build of the same version', async () => {
  const srv = await startServer(githubLike({ tag: '4.0.0' }));
  try {
    assert.equal((await makeUpdater(srv.base).updater.check({ manual: true })).phase, 'current');
    const dev = makeUpdater(srv.base, { currentVersion: '4.0.0-dev.57' });
    assert.equal((await dev.updater.check({ manual: true })).phase, 'current');
  } finally {
    await srv.close();
  }
});

test('a file that does not match GitHub\'s digest is thrown away', async () => {
  const srv = await startServer(githubLike({ digest: `sha256:${'0'.repeat(64)}` }));
  try {
    const { updater, cacheDir } = makeUpdater(srv.base);
    await updater.check({ manual: true });
    const s = await updater.download();
    assert.equal(s.phase, 'available');
    assert.equal(s.error.during, 'download');
    assert.match(s.error.message, /Prüfsumme/);
    assert.deepEqual(fs.readdirSync(cacheDir), []);
  } finally {
    await srv.close();
  }
});

test('a truncated download fails and leaves nothing behind', async () => {
  const cacheDir = tempDir();
  const srv = await startServer((req, res, base) => {
    if (req.url === '/latest') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(releaseJson(base)));
    } else {
      // Announces the whole file, sends a third, hangs up.
      res.writeHead(200, { 'content-length': PAYLOAD.length });
      res.write(PAYLOAD.subarray(0, 100_000), () => res.destroy());
    }
  });
  try {
    const { updater } = makeUpdater(srv.base, { cacheDir });
    await updater.check({ manual: true });
    const s = await updater.download();
    assert.equal(s.phase, 'available');
    assert.match(s.error.message, /Verbindung zu GitHub ist abgebrochen/);
    assert.deepEqual(fs.readdirSync(cacheDir), []);
  } finally {
    await srv.close();
  }
});

test('a download can be cancelled, quietly', async () => {
  const cacheDir = tempDir();
  let sent = null;
  const srv = await startServer((req, res, base) => {
    if (req.url === '/latest') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(releaseJson(base)));
    } else {
      // A slow file: a first chunk, then nothing until the client gives up.
      res.writeHead(200, { 'content-length': PAYLOAD.length });
      res.write(PAYLOAD.subarray(0, 1000));
      sent = res;
    }
  });
  try {
    const { updater, calls } = makeUpdater(srv.base, { cacheDir });
    await updater.check({ manual: true });
    const running = updater.download();
    // Wait until the download is under way, then cancel.
    for (let i = 0; i < 100 && !sent; i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(calls.states.some((x) => x.phase === 'downloading'));
    updater.cancel();
    const s = await running;
    assert.equal(s.phase, 'available');
    assert.equal(s.error, null);
    assert.deepEqual(fs.readdirSync(cacheDir), []);
  } finally {
    sent?.destroy();
    await srv.close();
  }
});

test('GitHub\'s rate limit: a manual check says so, an automatic one stays quiet', async () => {
  const srv = await startServer((req, res) => res.writeHead(403).end('{"message":"API rate limit exceeded"}'));
  try {
    const manual = await makeUpdater(srv.base).updater.check({ manual: true });
    assert.equal(manual.phase, 'idle');
    assert.match(manual.error.message, /keine weiteren Anfragen/);
    const auto = await makeUpdater(srv.base).updater.check({ manual: false });
    assert.equal(auto.phase, 'idle');
    assert.equal(auto.error, null);
  } finally {
    await srv.close();
  }
});

test('nothing published yet counts as up to date; nonsense does not', async () => {
  let answer = (res) => res.writeHead(404).end();
  const srv = await startServer((req, res) => answer(res));
  try {
    assert.equal((await makeUpdater(srv.base).updater.check({ manual: true })).phase, 'current');
    answer = (res) => res.writeHead(200, { 'content-type': 'application/json' }).end('<html>');
    const s = await makeUpdater(srv.base).updater.check({ manual: true });
    assert.equal(s.phase, 'idle');
    assert.match(s.error.message, /unverständlich/);
  } finally {
    await srv.close();
  }
});

test('without a digest the release is only offered as a download page', async () => {
  const srv = await startServer(githubLike({ digest: null }));
  try {
    const { updater, calls } = makeUpdater(srv.base);
    const s = await updater.check({ manual: true });
    assert.equal(s.phase, 'available');
    assert.equal(s.release.canInstall, false);
    assert.equal((await updater.download()).phase, 'available', 'refuses to download');
    updater.openRelease();
    assert.deepEqual(calls.opened, [`${PAGE}/tag/9.9.9`]);
  } finally {
    await srv.close();
  }
});

test('an unpacked build gets the page, never a download', async () => {
  const srv = await startServer(githubLike());
  try {
    const { updater } = makeUpdater(srv.base, { kind: 'manual' });
    const s = await updater.check({ manual: true });
    assert.equal(s.release.canInstall, false);
    assert.equal((await updater.download()).phase, 'available');
  } finally {
    await srv.close();
  }
});

test('portable: the new .exe goes beside the old one and is started instead', async () => {
  const srv = await startServer(githubLike());
  const portableDir = tempDir();
  try {
    const { updater, calls, cacheDir } = makeUpdater(srv.base, {
      kind: 'portable',
      portableDir,
      downloadsDir: tempDir(),
      previousExe: path.join(portableDir, 'Sooskasse-FinTS-4.0.0-portable.exe'),
    });
    await updater.check({ manual: true });
    const s = await updater.download();
    assert.equal(s.phase, 'ready');
    assert.equal(s.location, portableDir);
    assert.equal(fs.readFileSync(path.join(portableDir, PORTABLE)).equals(PAYLOAD), true);
    await updater.install();
    assert.deepEqual(calls.spawned.map((c) => [path.basename(c.file), c.args, c.opts.cwd]), [[PORTABLE, ['--updated'], portableDir]]);

    // The new portable build starts: it names the old file, by its full path.
    const next = makeUpdater(srv.base, { kind: 'portable', currentVersion: '9.9.9', cacheDir });
    next.updater.start();
    next.updater.stop();
    assert.equal(next.updater.getState().installed.previousFile, path.join(portableDir, 'Sooskasse-FinTS-4.0.0-portable.exe'));
  } finally {
    await srv.close();
  }
});

test('a file changed after the download is not run', async () => {
  const srv = await startServer(githubLike());
  try {
    const { updater, calls, cacheDir } = makeUpdater(srv.base);
    await updater.check({ manual: true });
    assert.equal((await updater.download()).phase, 'ready');
    // One byte changed, same size: only the digest can tell.
    const file = path.join(cacheDir, SETUP);
    const tampered = Buffer.from(PAYLOAD);
    tampered[10] ^= 0xff;
    fs.writeFileSync(file, tampered);
    const s = await updater.install();
    assert.equal(calls.spawned.length, 0);
    assert.equal(calls.quit, 0);
    assert.equal(s.phase, 'available');
    assert.equal(s.error.during, 'install');
    assert.equal(fs.existsSync(file), false, 'the bad file is removed');
  } finally {
    await srv.close();
  }
});

test('a failed start keeps the update ready and says why', async () => {
  const srv = await startServer(githubLike());
  try {
    const { updater, calls, cacheDir } = makeUpdater(srv.base, {
      spawnDetached: async () => {
        throw Object.assign(new Error('spawn EBUSY'), { code: 'EBUSY' });
      },
    });
    await updater.check({ manual: true });
    await updater.download();
    const s = await updater.install();
    assert.equal(calls.quit, 0);
    assert.equal(s.phase, 'ready');
    assert.match(s.error.message, /gesperrt/);
    assert.equal(fs.existsSync(path.join(cacheDir, 'installing.json')), false, 'no marker for a start that did not happen');
  } finally {
    await srv.close();
  }
});

test('the install window is shown for the running installer, and cannot stop the update', async () => {
  const srv = await startServer(githubLike());
  try {
    const shown = [];
    const { updater, calls } = makeUpdater(srv.base, {
      spawnDetached: async () => 4242,
      showInstallWindow: async (info) => shown.push(info),
    });
    await updater.check({ manual: true });
    await updater.download();
    await updater.install();
    assert.deepEqual(shown, [{ installerPid: 4242, version: '9.9.9' }]);
    assert.equal(calls.quit, 1);

    // A window that fails to start changes nothing.
    const failing = makeUpdater(srv.base, {
      showInstallWindow: async () => {
        throw new Error('blocked');
      },
    });
    await failing.updater.check({ manual: true });
    await failing.updater.download();
    const s = await failing.updater.install();
    assert.equal(failing.calls.spawned.length, 1);
    assert.equal(failing.calls.quit, 1);
    assert.equal(s.phase, 'installing');
    assert.equal(s.error, null);

    // The portable build starts the new .exe, which is its own window.
    let portableShown = false;
    const portable = makeUpdater(srv.base, {
      kind: 'portable',
      portableDir: tempDir(),
      showInstallWindow: async () => {
        portableShown = true;
      },
    });
    await portable.updater.check({ manual: true });
    await portable.updater.download();
    await portable.updater.install();
    assert.equal(portableShown, false);
  } finally {
    await srv.close();
  }
});

test('the automatic check is a stored preference, on by default', () => {
  const { updater, prefs } = makeUpdater('http://127.0.0.1:9/');
  assert.equal(updater.getState().auto, true);
  updater.setAuto(false);
  assert.equal(prefs.get(PREF_AUTO), 'off');
  assert.equal(updater.getState().auto, false);
  updater.setAuto(true);
  updater.stop();
  assert.equal(prefs.get(PREF_AUTO), 'on');
});

// ---- differential downloads ------------------------------------------------

const CHUNK = 4096;
const OLD = crypto.randomBytes(CHUNK * 60);
/** OLD with two chunks rewritten, one chunk inserted, and a tail: most of it is still OLD. */
const NEW = Buffer.concat([
  OLD.subarray(0, CHUNK * 10),
  crypto.randomBytes(CHUNK * 2),
  OLD.subarray(CHUNK * 12, CHUNK * 40),
  crypto.randomBytes(CHUNK),
  OLD.subarray(CHUNK * 40),
  crypto.randomBytes(1000),
]);
const DIFF_BYTES = CHUNK * 3 + 1000;
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const OLD_SETUP = 'Sooskasse-FinTS-4.0.0-Setup.exe';

function checksumsOf(buf) {
  const list = [];
  for (let at = 0; at < buf.length; at += CHUNK) {
    list.push(crypto.createHash('sha256').update(buf.subarray(at, at + CHUNK)).digest('base64').slice(0, 24));
  }
  return list;
}

/** A blockmap as electron-builder writes it, over fixed-size chunks (its own are content-defined). */
function makeBlockmap(buf, checksums = checksumsOf(buf)) {
  const sizes = checksums.map((_, i) => Math.min(CHUNK, buf.length - i * CHUNK));
  return zlib.gzipSync(JSON.stringify({ version: '2', files: [{ name: 'file', offset: 0, checksums, sizes }] }));
}

/**
 * GitHub with blockmaps: 9.9.9 is the latest release, 4.0.0 the installed
 * one. Downloads honour single byte ranges unless `ranges` is false;
 * `served` counts what went out of the new installer.
 */
function diffServer({ ranges = true, oldTag = '4.0.0', next = NEW, newMap = makeBlockmap(next), withMap = true, onRange } = {}) {
  const served = { bytes: 0, requests: 0, ranged: 0 };
  const files = {
    [SETUP]: next,
    [`${SETUP}.blockmap`]: newMap,
    [OLD_SETUP]: OLD,
    [`${OLD_SETUP}.blockmap`]: makeBlockmap(OLD),
  };
  const release = (base, tag, names) => ({
    ...releaseJson(base, { tag }),
    assets: names.map((name) => ({
      name,
      size: files[name].length,
      digest: `sha256:${sha(files[name])}`,
      browser_download_url: `${base}dl/${name}`,
    })),
  });
  const json = (res, body) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  const route = (req, res, base) => {
    const name = req.url.startsWith('/dl/') ? req.url.slice(4) : null;
    if (req.url === '/latest') {
      json(res, release(base, '9.9.9', withMap ? [SETUP, `${SETUP}.blockmap`] : [SETUP]));
    } else if (req.url === `/tags/${oldTag}`) {
      json(res, release(base, oldTag, [OLD_SETUP, `${OLD_SETUP}.blockmap`]));
    } else if (name && files[name]) {
      const body = files[name];
      const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
      if (name === SETUP) served.requests++;
      if (range && ranges) {
        const start = Number(range[1]);
        const end = Number(range[2]);
        if (name === SETUP) {
          served.ranged++;
          served.bytes += end - start + 1;
        }
        if (onRange?.(res, start, end, body.length)) return;
        res.writeHead(206, { 'content-range': `bytes ${start}-${end}/${body.length}`, 'content-length': end - start + 1 });
        res.end(body.subarray(start, end + 1));
      } else {
        if (name === SETUP) served.bytes += body.length;
        res.writeHead(200, { 'content-length': body.length }).end(body);
      }
    } else {
      res.writeHead(404).end();
    }
  };
  return { route, served };
}

function baseFileWith(buf) {
  const file = path.join(tempDir(), 'update-base.bin');
  fs.writeFileSync(file, buf);
  return file;
}

test('differential: only the changed chunks are downloaded, the rest comes from the installed Setup.exe', async () => {
  const { route, served } = diffServer();
  const srv = await startServer(route);
  try {
    const { updater, cacheDir, calls } = makeUpdater(srv.base, { baseFile: baseFileWith(OLD) });
    let s = await updater.check({ manual: true });
    assert.equal(s.phase, 'available');
    // 2 rewritten chunks, 1 inserted one, the tail.
    assert.equal(s.release.size, DIFF_BYTES, 'offers the smaller download');

    s = await updater.download();
    assert.equal(s.phase, 'ready');
    assert.equal(fs.readFileSync(path.join(cacheDir, SETUP)).equals(NEW), true);
    assert.equal(served.bytes, DIFF_BYTES);
    assert.equal(served.ranged, served.requests, 'nothing but range requests');
    assert.equal(calls.states.find((x) => x.phase === 'downloading').total, DIFF_BYTES);

    // Installs like any download.
    await updater.install();
    assert.equal(calls.spawned[0].file, path.join(cacheDir, SETUP));
  } finally {
    await srv.close();
  }
});

test('differential: a release tagged v4.0.0 is found too', async () => {
  const { route, served } = diffServer({ oldTag: 'v4.0.0' });
  const srv = await startServer(route);
  try {
    const { updater } = makeUpdater(srv.base, { baseFile: baseFileWith(OLD) });
    assert.equal((await updater.check({ manual: true })).release.size, DIFF_BYTES);
    assert.equal((await updater.download()).phase, 'ready');
    assert.equal(served.bytes, DIFF_BYTES);
  } finally {
    await srv.close();
  }
});

test('differential: a server that ignores ranges means the whole file', async () => {
  const { route } = diffServer({ ranges: false });
  const srv = await startServer(route);
  try {
    const { updater, cacheDir } = makeUpdater(srv.base, { baseFile: baseFileWith(OLD) });
    await updater.check({ manual: true });
    const s = await updater.download();
    assert.equal(s.phase, 'ready');
    assert.equal(s.error, null);
    assert.equal(s.release.size, NEW.length, 'now says what it really took');
    assert.equal(fs.readFileSync(path.join(cacheDir, SETUP)).equals(NEW), true);
  } finally {
    await srv.close();
  }
});

test('differential: a wrong blockmap is caught by the digest, then the whole file', async () => {
  // Claims chunk 10 is unchanged: the assembled file cannot match.
  const lying = checksumsOf(NEW);
  lying[10] = checksumsOf(OLD)[10];
  const { route, served } = diffServer({ newMap: makeBlockmap(NEW, lying) });
  const srv = await startServer(route);
  try {
    const { updater, cacheDir } = makeUpdater(srv.base, { baseFile: baseFileWith(OLD) });
    assert.equal((await updater.check({ manual: true })).release.size, DIFF_BYTES - CHUNK);
    const s = await updater.download();
    assert.equal(s.phase, 'ready');
    assert.equal(fs.readFileSync(path.join(cacheDir, SETUP)).equals(NEW), true);
    assert.equal(served.bytes, DIFF_BYTES - CHUNK + NEW.length, 'the ranges, then the whole file');
    assert.deepEqual(fs.readdirSync(cacheDir), [SETUP], 'no half-built file left over');
  } finally {
    await srv.close();
  }
});

test('differential: an installed copy that is not the release\'s Setup.exe is not used', async () => {
  const local = Buffer.from(OLD);
  local[5] ^= 0xff; // a local build of 4.0.0, say
  const { route, served } = diffServer();
  const srv = await startServer(route);
  try {
    const { updater } = makeUpdater(srv.base, { baseFile: baseFileWith(local) });
    assert.equal((await updater.check({ manual: true })).release.size, NEW.length);
    assert.equal((await updater.download()).phase, 'ready');
    assert.equal(served.ranged, 0);
  } finally {
    await srv.close();
  }
});

test('differential: without a blockmap, a base file or a release build, the whole file', async () => {
  const noMap = await startServer(diffServer({ withMap: false }).route);
  const srv = await startServer(diffServer().route);
  try {
    const sizeFor = async (base, overrides) =>
      (await makeUpdater(base, { baseFile: baseFileWith(OLD), ...overrides }).updater.check({ manual: true })).release.size;
    assert.equal(await sizeFor(noMap.base, {}), NEW.length, 'no blockmap in the release');
    assert.equal(await sizeFor(srv.base, { baseFile: path.join(tempDir(), 'missing.bin') }), NEW.length, 'no base file');
    assert.equal(await sizeFor(srv.base, { currentVersion: '4.0.0-dev.57' }), NEW.length, 'a dev build');
  } finally {
    await noMap.close();
    await srv.close();
  }
});

test('differential: a release that changes nearly everything still reuses what stayed', async () => {
  // A new Electron, say: all but the first 3 of 60 chunks are new.
  const mostlyNew = Buffer.concat([OLD.subarray(0, CHUNK * 3), crypto.randomBytes(CHUNK * 57)]);
  const { route, served } = diffServer({ next: mostlyNew });
  const srv = await startServer(route);
  try {
    const { updater, cacheDir } = makeUpdater(srv.base, { baseFile: baseFileWith(OLD) });
    assert.equal((await updater.check({ manual: true })).release.size, CHUNK * 57);
    assert.equal((await updater.download()).phase, 'ready');
    assert.equal(fs.readFileSync(path.join(cacheDir, SETUP)).equals(mostlyNew), true);
    assert.equal(served.bytes, CHUNK * 57);
    assert.equal(served.ranged, served.requests);
  } finally {
    await srv.close();
  }
});

test('differential: with nothing in common, the plain whole download', async () => {
  const allNew = crypto.randomBytes(CHUNK * 60);
  const { route, served } = diffServer({ next: allNew });
  const srv = await startServer(route);
  try {
    const { updater } = makeUpdater(srv.base, { baseFile: baseFileWith(OLD) });
    assert.equal((await updater.check({ manual: true })).release.size, allNew.length);
    assert.equal((await updater.download()).phase, 'ready');
    assert.equal(served.ranged, 0);
  } finally {
    await srv.close();
  }
});

test('differential: cancelling stops it — no whole download behind it', async () => {
  const hanging = [];
  const { route, served } = diffServer({
    onRange: (res, start, end, total) => {
      // Headers, then nothing.
      res.writeHead(206, { 'content-range': `bytes ${start}-${end}/${total}`, 'content-length': end - start + 1 });
      hanging.push(res);
      return true;
    },
  });
  const srv = await startServer(route);
  try {
    const { updater, cacheDir } = makeUpdater(srv.base, { baseFile: baseFileWith(OLD) });
    await updater.check({ manual: true });
    const running = updater.download();
    for (let i = 0; i < 100 && hanging.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
    updater.cancel();
    const s = await running;
    assert.equal(s.phase, 'available');
    assert.equal(s.error, null);
    assert.equal(served.ranged, served.requests, 'no whole download was started');
    assert.deepEqual(fs.readdirSync(cacheDir), []);
  } finally {
    for (const res of hanging) res.destroy();
    await srv.close();
  }
});
