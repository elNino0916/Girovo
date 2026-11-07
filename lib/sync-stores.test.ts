import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { folderStore, SyncPlaceError, webdavStore } from './sync-stores.ts';

const NAME = `${'a'.repeat(24)}.devices`;

/** A WebDAV server that answers every request with `status`. */
async function serving(status: number) {
  const server = http.createServer((req, res) => {
    req.resume();
    res.statusCode = status;
    res.end(status === 200 ? 'x' : '');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/dav`, close: () => new Promise<void>((r) => server.close(() => r())) };
}

const place = (url: string) => ({ kind: 'webdav' as const, url, user: 'u', password: 'p' });

async function reason(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return 'none';
  } catch (err) {
    return err instanceof SyncPlaceError ? err.reason : `fault: ${(err as Error).message}`;
  }
}

test('a WebDAV place out of reach or refusing is a SyncPlaceError, never a fault to report', async () => {
  const refused = await serving(401);
  const down = await serving(503);
  const odd = await serving(409);
  try {
    assert.equal(await reason(() => webdavStore(place(refused.url)).get(NAME)), 'refused');
    assert.equal(await reason(() => webdavStore(place(down.url)).put(NAME, new Uint8Array([1]))), 'unreachable');
    // An answer nobody expects stays a fault, so it is still reported.
    assert.equal(await reason(() => webdavStore(place(odd.url)).get(NAME)), 'fault: WebDAV 409');
  } finally {
    await Promise.all([refused.close(), down.close(), odd.close()]);
  }
  // No room (a quota, the desktop's full shelf answers the same): said as such, so a round skips that one file.
  const quota = await serving(507);
  try {
    assert.equal(await reason(() => webdavStore(place(quota.url)).put(NAME, new Uint8Array([1]))), 'full');
  } finally {
    await quota.close();
  }
  // A receipt's file that is gone already is no error; a refusal stays one.
  const missing = await serving(404);
  const gone204 = await serving(204);
  const refusing = await serving(401);
  try {
    const DOC = `${'a'.repeat(24)}.${'b'.repeat(32)}.doc`;
    assert.equal(await reason(() => webdavStore(place(missing.url)).remove!(DOC)), 'none');
    assert.equal(await reason(() => webdavStore(place(gone204.url)).remove!(DOC)), 'none');
    assert.equal(await reason(() => webdavStore(place(refusing.url)).remove!(DOC)), 'refused');
  } finally {
    await Promise.all([missing.close(), gone204.close(), refusing.close()]);
  }
  // Nothing listening at all: fetch's "fetch failed".
  const gone = await serving(200);
  await gone.close();
  assert.equal(await reason(() => webdavStore(place(gone.url)).get(NAME)), 'unreachable');
});

test('a folder place removes the file of a receipt, gone already or not, and nothing that is no sync file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'girovo-sync-folder-'));
  try {
    const store = folderStore(dir);
    const DOC = `${'a'.repeat(24)}.${'b'.repeat(32)}.doc`;
    await store.put(DOC, new Uint8Array([1, 2, 3]));
    assert.ok(fs.existsSync(path.join(dir, DOC)));
    await store.remove!(DOC);
    assert.equal(fs.existsSync(path.join(dir, DOC)), false);
    await store.remove!(DOC);
    await assert.rejects(store.remove!('../outside.doc'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
