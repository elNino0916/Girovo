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
const { createUpdater, PREF_AUTO } = require('./updater.cjs');

const PAYLOAD = crypto.randomBytes(300_000);
const SHA = crypto.createHash('sha256').update(PAYLOAD).digest('hex');
const SETUP = 'Sooskasse-FinTS-9.9.9-Setup.exe';
const PORTABLE = 'Sooskasse-FinTS-9.9.9-portable.exe';
const PAGE = 'https://github.com/elNino0916/Sooskasse-FinTS/releases';

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
    name: `Sooskasse-FinTS ${tag}`,
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sooskasse-updater-test-'));
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
