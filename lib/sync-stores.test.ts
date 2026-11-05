import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { SyncPlaceError, webdavStore } from './sync-stores.ts';

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
  // Nothing listening at all: fetch's "fetch failed".
  const gone = await serving(200);
  await gone.close();
  assert.equal(await reason(() => webdavStore(place(gone.url)).get(NAME)), 'unreachable');
});
