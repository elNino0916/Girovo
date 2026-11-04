// Where the devices of a sync group meet (lib/sync.ts) — each a place that
// keeps files by name, and holds nothing it could read:
//
// - 'lan': the computer itself. Its shell serves the folder below to the home
//   network while the app runs (electron/sync-lan.cjs); the computer's own
//   server reads and writes it as a plain folder, the phone reaches it over
//   plain HTTP to a private address (SyncPlugin.java) — every file is sealed,
//   so the network learns sizes and times only.
// - 'webdav': a WebDAV folder over HTTPS (Nextcloud, ownCloud, a NAS), with
//   its user and an app password. The folder has to exist.
// - 'folder': a folder on the computer that a sync tool keeps in step with the
//   other computer (OneDrive, Dropbox, Syncthing, Google Drive for desktop).
//
// A file's name is checked before it touches any of them.

import fs from 'node:fs';
import path from 'node:path';
import { IS_ANDROID } from './platform.ts';
import { renameRetrying } from './sealed-file.ts';
import { STATE_DIR } from './state-store.ts';
import { groupOf, lanToken, type SyncPlace, type SyncStore } from './sync.ts';

const NAME = /^[0-9a-f]{24}(\.[0-9a-f]{16,32})?\.(devices|state|doc)$/;
const MAX_BYTES = 64 * 1024 * 1024;

function checked(name: string): string {
  if (!NAME.test(name)) throw new Error(`sync: not a sync file name: ${name.slice(0, 40)}`);
  return name;
}

/** The folder the computer's shell serves to the home network (electron/sync-lan.cjs reads the same). */
export function lanHostDir(): string {
  return path.join(STATE_DIR, 'sync-lan');
}

/**
 * The group's token beside its files, for the shelf to check every request
 * against: the phone sends it, a stranger on the network does not know it.
 * The shelf never serves this file (its name is no sync file's).
 */
export function keepLanToken(key: Buffer): void {
  const dir = lanHostDir();
  const file = path.join(dir, `${groupOf(key)}.token`);
  const token = lanToken(key);
  try {
    if (fs.readFileSync(file, 'utf8') === token) return;
  } catch {
    // not there yet
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, token, { mode: 0o600 });
}

export function folderStore(dir: string): SyncStore {
  return {
    async get(name) {
      try {
        const file = path.join(dir, checked(name));
        const st = await fs.promises.stat(file);
        if (st.size > MAX_BYTES) return null;
        return await fs.promises.readFile(file);
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
        throw err;
      }
    },
    async put(name, bytes) {
      const file = path.join(dir, checked(name));
      await fs.promises.mkdir(dir, { recursive: true });
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      await fs.promises.writeFile(tmp, bytes);
      try {
        // Riding out the brief locks OneDrive or a virus scanner hold on Windows.
        await renameRetrying(tmp, file);
      } catch (err) {
        // No half-written file left for the other devices (or the shelf's file count).
        await fs.promises.rm(tmp, { force: true }).catch(() => {});
        throw err;
      }
    },
  };
}

export function webdavStore(place: Extract<SyncPlace, { kind: 'webdav' }>): SyncStore {
  const auth = `Basic ${Buffer.from(`${place.user}:${place.password}`, 'utf8').toString('base64')}`;
  const url = (name: string) => `${place.url}/${checked(name)}`;
  return {
    async get(name) {
      const res = await fetch(url(name), { headers: { authorization: auth }, signal: AbortSignal.timeout(30_000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`WebDAV ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async put(name, bytes) {
      const res = await fetch(url(name), {
        method: 'PUT',
        headers: { authorization: auth, 'content-type': 'application/octet-stream' },
        body: Buffer.from(bytes),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`WebDAV ${res.status}`);
    },
  };
}

/** The phone's way to the computer: plain HTTP to a private address, through the app (mobile/runtime.ts). */
type LanHttp = (req: { method: 'GET' | 'PUT'; url: string; token: string; body?: string }) => Promise<{ status: number; body?: string }>;

export function lanStore(place: Extract<SyncPlace, { kind: 'lan' }>, key: Buffer): SyncStore {
  const token = lanToken(key);
  const found = (globalThis as typeof globalThis & { __girovoLanHttp?: LanHttp }).__girovoLanHttp;
  if (!found) throw new Error('sync: no way to the computer here');
  const http: LanHttp = found;
  let working: string | null = null;
  /** The computer at whichever of its addresses answers — the last one that did first. */
  async function ask(method: 'GET' | 'PUT', name: string, body?: Uint8Array) {
    const order = working ? [working, ...place.addresses.filter((a) => a !== working)] : place.addresses;
    let lastError: unknown = null;
    for (const address of order) {
      try {
        const res = await http({
          method,
          url: `http://${address}:${place.port}/girovo-sync/v1/${checked(name)}`,
          token,
          ...(body ? { body: Buffer.from(body).toString('base64') } : {}),
        });
        working = address;
        return res;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError ?? new Error('sync: the computer is not reachable');
  }
  return {
    async get(name) {
      const res = await ask('GET', name);
      if (res.status === 404) return null;
      if (res.status !== 200) throw new Error(`computer ${res.status}`);
      return Buffer.from(res.body ?? '', 'base64');
    },
    async put(name, bytes) {
      const res = await ask('PUT', name, bytes);
      if (res.status !== 200 && res.status !== 204) throw new Error(`computer ${res.status}`);
    },
  };
}

/** The place, as this device reaches it; null where it cannot (a folder on the phone). */
export function storeFor(place: SyncPlace, key: Buffer): SyncStore | null {
  if (place.kind === 'webdav') return webdavStore(place);
  if (place.kind === 'lan') return IS_ANDROID ? lanStore(place, key) : folderStore(lanHostDir());
  if (place.kind === 'folder' && place.path && !IS_ANDROID) return folderStore(place.path);
  return null;
}
