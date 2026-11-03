'use strict';

// Sync "Direkt im WLAN" (lib/sync.ts, lib/sync-stores.ts): while the app runs,
// the shell serves the sync folder to the home network, so the phone can leave
// its files there and read the computer's. The computer's own server reads
// and writes the same folder directly.
//
// It is a dumb file shelf: GET and PUT of one file by name under
// /girovo-sync/v1/, nothing else. Every file is sealed with the group's key
// before it gets here, so the network and this shelf see sizes and times,
// never content. A name must look like a sync file, and every request must
// carry its group's token — derived from the key, kept here by this
// computer's own sync (lib/sync-stores.ts keepLanToken) — so nobody else on
// the network can read, overwrite or store anything. A group holds at most
// MAX_FILES files, and only a few uploads run at once.
//
// Kept apart from main.cjs (http, fs and the folder come in as arguments) so
// `npm test` runs it without Electron (sync-lan.test.cjs).

const NAME = /^([0-9a-f]{24})(\.[0-9a-f]{16,32})?\.(devices|state|doc)$/;
const PREFIX = '/girovo-sync/v1/';
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 600;
const MAX_UPLOADS = 3;
const TOKEN_HEADER = 'x-girovo-sync';
/** Adapters of virtual machines and containers: never where the phone is. */
const VIRTUAL = /vEthernet|VirtualBox|VMware|Hyper-V|WSL|Docker|vbox|veth|^br-|virbr|tailscale|zerotier/i;

/** This computer's addresses on private networks, the ones the phone can reach. */
function privateAddresses(interfaces) {
  const out = [];
  for (const [name, list] of Object.entries(interfaces || {})) {
    if (VIRTUAL.test(name)) continue;
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
  let uploads = 0;

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
    // Only groups this computer is in, and only with their token.
    let token = null;
    try {
      token = fs.readFileSync(path.join(folder, `${m[1]}.token`), 'utf8');
    } catch {
      return done(404);
    }
    if (!token || req.headers[TOKEN_HEADER] !== token) return done(404);
    const file = path.join(folder, name);
    if (req.method === 'GET') {
      fs.readFile(file, (err, data) => (err ? done(404) : done(200, data)));
      return undefined;
    }
    if (req.method === 'PUT') {
      if (!fs.existsSync(file)) {
        const count = fs.readdirSync(folder).filter((f) => f.startsWith(`${m[1]}.`)).length;
        if (count >= MAX_FILES) return done(507);
      }
      if (uploads >= MAX_UPLOADS) return done(503);
      uploads++;
      let counted = true;
      const release = () => {
        if (counted) uploads--;
        counted = false;
      };
      res.on('close', release);
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
