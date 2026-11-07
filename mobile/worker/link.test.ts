// The in-page server's line to the page (link.ts), over a MessageChannel as
// it would run over a worker: calls both ways, errors with their code,
// moved buffers, event sources, and requests and answers across.
import test from 'node:test';
import assert from 'node:assert/strict';

import { Direct, Link, moved, packRequest, packResponse, unpackRequest, unpackResponse, wholeBuffer, type Calls, type Port, type Sources } from './link.ts';

function pair(a: { calls?: Calls; sources?: Sources } = {}, b: { calls?: Calls; sources?: Sources } = {}) {
  const { port1, port2 } = new MessageChannel();
  const page = new Link(port1 as unknown as Port, a);
  const worker = new Link(port2 as unknown as Port, b);
  return { page, worker, close: () => port1.close() };
}

test('a call is answered with its value, both ways', async () => {
  const { page, worker, close } = pair({ calls: { add: (x: number, y: number) => x + y } }, { calls: { hello: async (name: string) => `hallo ${name}` } });
  try {
    assert.equal(await worker.call('add', [2, 3]), 5);
    assert.equal(await page.call('hello', ['Welt']), 'hallo Welt');
  } finally {
    close();
  }
});

test('an error keeps its name, message and code; a plain rejection stays what it was', async () => {
  const { worker, close } = pair({
    calls: {
      fail: () => {
        throw Object.assign(new TypeError('fetch failed'), { code: 'ENOTFOUND' });
      },
      refuse: () => Promise.reject('EACCES: no access'),
    },
  });
  try {
    await assert.rejects(worker.call('fail'), (err: Error & { code?: string }) => {
      assert.ok(err instanceof Error);
      assert.equal(err.name, 'TypeError');
      assert.equal(err.message, 'fetch failed');
      assert.equal(err.code, 'ENOTFOUND');
      return true;
    });
    await assert.rejects(worker.call('refuse'), (err: unknown) => err === 'EACCES: no access');
    await assert.rejects(worker.call('missing'), /no "missing"/);
  } finally {
    close();
  }
});

test('buffers move rather than copy, when asked', async () => {
  let received: ArrayBuffer | null = null;
  const { page, worker, close } = pair(
    { calls: { take: (bytes: Uint8Array) => (received = bytes.buffer as ArrayBuffer, bytes.byteLength), give: () => { const b = new ArrayBuffer(8); return moved(b, [b]); } } },
  );
  try {
    const bytes = new TextEncoder().encode('ein Tresor');
    assert.equal(await worker.call('take', [bytes], wholeBuffer(bytes)), 10);
    assert.equal(bytes.byteLength, 0, 'the sender gave its buffer away');
    assert.equal(received!.byteLength, 10);
    const got = await worker.call<ArrayBuffer>('give');
    assert.equal(got.byteLength, 8);
    assert.ok(page);
  } finally {
    close();
  }
});

test('a view into a larger buffer is copied, not moved', () => {
  const big = new Uint8Array(16);
  assert.deepEqual(wholeBuffer(big.subarray(4, 8)), []);
  assert.deepEqual(wholeBuffer(big), [big.buffer]);
});

test('an answer that cannot be cloned is an error, not a wait', async () => {
  const { worker, close } = pair({ calls: { fn: () => () => 1 } });
  try {
    await assert.rejects(worker.call('fn'));
  } finally {
    close();
  }
});

test('an event source sends until it is stopped', async () => {
  let stopped = false;
  let emitNow: ((v: unknown) => void) | null = null;
  const { worker, close } = pair({
    sources: {
      ticks: (emit, start: number) => {
        emit(start);
        emitNow = emit;
        return () => {
          stopped = true;
        };
      },
    },
  });
  try {
    const heard: unknown[] = [];
    const stop = worker.listen('ticks', [7], (v) => heard.push(v));
    await new Promise((r) => setTimeout(r, 20));
    emitNow!(8);
    await new Promise((r) => setTimeout(r, 20));
    stop();
    await new Promise((r) => setTimeout(r, 20));
    emitNow!(9);
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(heard, [7, 8]);
    assert.equal(stopped, true);
  } finally {
    close();
  }
});

test('a send wants no answer', async () => {
  const seen: unknown[] = [];
  const { worker, close } = pair({ calls: { log: (text: string) => void seen.push(text) } });
  try {
    worker.send('log', ['eins']);
    worker.send('nothing-here', ['zwei']); // no such call: dropped on the other side, no reply
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(seen, ['eins']);
  } finally {
    close();
  }
});

test('a request and its answer cross with method, headers, body and the page language', async () => {
  const req = new Request('http://tauri.localhost/api/vault', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-girovo': 'yes' },
    body: JSON.stringify({ pin: '1234', blob: 'Ü'.repeat(3) }),
  });
  const wire = await packRequest(req, 'en');
  assert.equal(wire.transfer.length, 1);
  assert.equal(wire.value.locale, 'en');
  const back = unpackRequest(structuredClone(wire.value, { transfer: wire.transfer }));
  assert.equal(back.method, 'POST');
  assert.equal(back.url, 'http://tauri.localhost/api/vault');
  assert.equal(back.headers.get('content-type'), 'application/json');
  assert.deepEqual(await back.json(), { pin: '1234', blob: 'ÜÜÜ' });

  const get = await packRequest(new Request('http://tauri.localhost/api/meta'));
  assert.equal(get.value.body, null);
  assert.equal(unpackRequest(get.value).method, 'GET');

  const res = new Response(JSON.stringify({ error: 'Nicht gefunden' }), { status: 404, headers: { 'content-type': 'application/json' } });
  const answer = await packResponse(res);
  const out = unpackResponse(structuredClone(answer.value, { transfer: answer.transfer }));
  assert.equal(out.status, 404);
  assert.equal(out.ok, false);
  assert.equal(out.headers.get('content-type'), 'application/json');
  assert.deepEqual(await out.json(), { error: 'Nicht gefunden' });

  const empty = unpackResponse((await packResponse(new Response(null, { status: 204 }))).value);
  assert.equal(empty.status, 204);
  assert.equal(empty.body, null);
});

test('Direct calls in place and hands over what a call moved', async () => {
  let calledSync = false;
  const buf = new ArrayBuffer(4);
  const line = new Direct({
    calls: {
      now: () => {
        calledSync = true;
        return moved(buf, [buf]);
      },
    },
    sources: { one: (emit) => emit('x') },
  });
  const p = line.call<ArrayBuffer>('now');
  assert.equal(calledSync, true, 'called before the first await');
  assert.equal(await p, buf);
  assert.equal(buf.byteLength, 4, 'nothing moved within one thread');
  const heard: unknown[] = [];
  line.listen('one', [], (v) => heard.push(v));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(heard, ['x']);
  await assert.rejects(line.call('missing'), /no "missing"/);
});

test('close ends every subscription the other side holds (a worker that was ended)', async () => {
  let stopped = 0;
  const { page, worker, close } = pair({
    sources: {
      ticks: () => () => {
        stopped++;
      },
    },
  });
  try {
    worker.listen('ticks', [], () => {});
    worker.listen('ticks', [], () => {});
    await new Promise((r) => setTimeout(r, 20));
    page.close();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(stopped, 2);
    page.close();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(stopped, 2, 'once each');
  } finally {
    close();
  }
});
