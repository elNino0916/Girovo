'use strict';

// Sync "Direkt im WLAN" (lib/sync.ts, lib/sync-stores.ts): while the app runs,
// the shell serves the sync folder to the home network, so the phone can leave
// its files there and read the computer's. The computer's own server reads
// and writes the same folder directly.
//
// It is a dumb file shelf: GET and PUT of one file by name under
// /girovo-sync/v1/, nothing else. Every file is sealed with the group's key
// before it gets here, so the network and this shelf see sizes and times,
// never content. A name must look like a sync file, and its group must
// already have a devices file here — written by this computer's own sync —
// so nobody on the network can start storing things of their own.
//
// Kept apart from main.cjs (http, fs and the folder come in as arguments) so
// `npm test` runs it without Electron (sync-lan.test.cjs).

const NAME = /^([0-9a-f]{24})(\.[0-9a-f]{16,32})?\.(devices|state|doc)$/;
const PREFIX = '/girovo-sync/v1/';
const MAX_BYTES = 64 * 1024 * 1024;

/** This computer's addresses on private networks, the ones the phone can reach. */
function privateAddresses(interfaces) {
  const out = [];
  for (const list of Object.values(interfaces || {})) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal) continue;
      if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) out.push(a.address);
    }
  }
  return out.slice(0, 4);
}

/**
 * @param {object} deps
 * @param {typeof import('node:http')} deps.http
 * @param {typeof import('node:fs')} deps.fs
 * @param {typeof import('node:path')} deps.path
 * @param {() => string} deps.dir  The sync folder (lib/sync-stores.ts lanHostDir).
 * @param {{ warn(...args: unknown[]): void }} [deps.log]
 */
function createLanServer({ http, fs, path, dir, log = console }) {
  let server = null;

  function handle(req, res) {
    // With its length, never chunked: the phone reads the answer over a plain socket (SyncPlugin.java).
    const done = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/octet-stream', 'content-length': body ? body.length : 0, connection: 'close' });
      res.end(body);
    };
    const url = String(req.url || '');
    if (!url.startsWith(PREFIX)) return done(404);
    const name = url.slice(PREFIX.length);
    const m = NAME.exec(name);
    if (!m) return done(404);
    const folder = dir();
    // Only groups this computer is in: its own sync writes the devices file first.
    if (!fs.existsSync(path.join(folder, `${m[1]}.devices`))) return done(404);
    const file = path.join(folder, name);
    if (req.method === 'GET') {
      fs.readFile(file, (err, data) => (err ? done(404) : done(200, data)));
      return undefined;
    }
    if (req.method === 'PUT') {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BYTES) {
          done(413);
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        if (size > MAX_BYTES) return;
        const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFile(tmp, Buffer.concat(chunks), (err) => {
          if (err) return done(500);
          fs.rename(tmp, file, (err2) => (err2 ? done(500) : done(204)));
          return undefined;
        });
      });
      return undefined;
    }
    return done(405);
  }

  return {
    /** Starts listening on `port` (all interfaces); resolves once it does. */
    start(port) {
      if (server) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const s = http.createServer(handle);
        s.on('error', (err) => {
          log.warn('[sync-lan]', err?.code || err?.message || err);
          if (server !== s) reject(err);
        });
        s.listen(port, '0.0.0.0', () => {
          server = s;
          resolve();
        });
      });
    },
    stop() {
      server?.close();
      server = null;
    },
    running: () => !!server,
  };
}

module.exports = { createLanServer, privateAddresses, NAME, PREFIX };
