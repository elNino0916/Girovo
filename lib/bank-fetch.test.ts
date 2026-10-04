import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpClient } from 'lib-fints';
import {
  BankRequestCancelled, BankUnavailable, bankErrorKind, describeError, fetchFromBank, withBankSignal,
} from './bank-fetch.ts';
import { BANK_UNAVAILABLE, BANK_UNREACHABLE } from './bank-answer.ts';
import { OrderUnanswered, startOrder } from './fints-order.ts';

const URL_ = 'https://banking.example.de/fints';
/** "HNHBK:1:3+…" as a bank sends it: base64. */
const FINTS_REPLY = Buffer.from("HNHBK:1:3+000000000120+300+0+1'HNHBS:2:1+1'", 'latin1').toString('base64');

/** A fetch that answers after `ms` — or rejects the moment its signal aborts. */
function slowFetch(ms: number, answer: () => Response): typeof fetch {
  return ((_input: unknown, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const t = setTimeout(() => resolve(answer()), ms);
    init?.signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(init.signal!.reason);
    }, { once: true });
  })) as typeof fetch;
}

const quiet = { log: () => {} };

test('a FinTS reply passes through unchanged', async () => {
  const res = await fetchFromBank(slowFetch(1, () => new Response(FINTS_REPLY)), URL_, { method: 'POST' }, quiet);
  assert.equal(res.ok, true);
  assert.equal(await res.text(), FINTS_REPLY);
});

test('no first byte within the limit: BankUnavailable, not a five-minute wait', async () => {
  const started = Date.now();
  await assert.rejects(
    fetchFromBank(slowFetch(10_000, () => new Response(FINTS_REPLY)), URL_, {}, { ...quiet, firstByteMs: 30 }),
    (e: unknown) => e instanceof BankUnavailable && e.reason === 'timeout',
  );
  assert.ok(Date.now() - started < 2000);
});

test('the limit is on the first byte only: a slow body still arrives', async () => {
  // Headers at once, the body 80 ms later — past a 30 ms first-byte limit.
  const stream = new ReadableStream({
    start(c) { setTimeout(() => { c.enqueue(new TextEncoder().encode(FINTS_REPLY)); c.close(); }, 80); },
  });
  const res = await fetchFromBank(slowFetch(1, () => new Response(stream)), URL_, {}, { ...quiet, firstByteMs: 30 });
  assert.equal(await res.text(), FINTS_REPLY);
});

test('an error page is logged on the server and never passed on', async () => {
  const logged: string[] = [];
  const page = '<html><body><h1>Wartungsarbeiten</h1></body></html>';
  await assert.rejects(
    fetchFromBank(slowFetch(1, () => new Response(page, { status: 503 })), URL_, {}, { log: (l) => logged.push(l) }),
    (e: unknown) => e instanceof BankUnavailable && e.reason === 'status' && e.status === 503 && !e.message.includes('html'),
  );
  assert.equal(logged.length, 1);
  assert.match(logged[0], /banking\.example\.de answered HTTP 503: <html><body><h1>Wartungsarbeiten/);
});

test('a 200 that is no FinTS message is unreadable, not a crash in the decoder', async () => {
  await assert.rejects(
    fetchFromBank(slowFetch(1, () => new Response('<html>Bitte später</html>')), URL_, {}, quiet),
    (e: unknown) => e instanceof BankUnavailable && e.reason === 'unreadable',
  );
});

test('a cancel signal ends the request at once', async () => {
  const ctrl = new AbortController();
  const pending = fetchFromBank(slowFetch(10_000, () => new Response(FINTS_REPLY)), URL_, {}, { ...quiet, signal: ctrl.signal });
  setTimeout(() => ctrl.abort(), 10);
  await assert.rejects(pending, (e: unknown) => e instanceof BankRequestCancelled);
  ctrl.abort();
  await assert.rejects(
    fetchFromBank(slowFetch(1, () => new Response(FINTS_REPLY)), URL_, {}, { ...quiet, signal: ctrl.signal }),
    (e: unknown) => e instanceof BankRequestCancelled,
  );
});

test('a connection error stays what it was', async () => {
  const refused = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  await assert.rejects(
    fetchFromBank((() => Promise.reject(refused)) as typeof fetch, URL_, {}, quiet),
    (e: unknown) => e === refused,
  );
});

test('lib-fints requests run under the policy; other fetches pass through', async () => {
  const original = globalThis.fetch;
  const seen: (AbortSignal | undefined | null)[] = [];
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    seen.push(init?.signal);
    return new Response('<html>Wartung</html>', { status: 503 });
  }) as typeof fetch;
  const warn = console.warn;
  console.warn = () => {};
  try {
    const client = new HttpClient(URL_);
    const message = { encode: () => "HNHBK:1:3+'" } as unknown as Parameters<HttpClient['sendMessage']>[0];
    await assert.rejects(client.sendMessage(message), (e: unknown) => e instanceof BankUnavailable && e.status === 503);
    assert.ok(seen[0] instanceof AbortSignal, 'the bank request carries a signal');

    // Outside a bank call: untouched, error page and all.
    const res = await globalThis.fetch('https://example.org/');
    assert.equal(res.status, 503);
    assert.equal(seen[1], undefined);

    // A caller's signal reaches the request inside lib-fints.
    const ctrl = new AbortController();
    ctrl.abort();
    await assert.rejects(withBankSignal(ctrl.signal, () => client.sendMessage(message)), (e: unknown) => e instanceof BankRequestCancelled);
  } finally {
    globalThis.fetch = original;
    console.warn = warn;
  }
});

test('an order whose request breaks once the dialog is open still ends as OrderUnanswered', async () => {
  const client = {
    currentDialog: undefined as unknown,
    async startCustomerOrderInteraction() {
      client.currentDialog = { isInitialized: true, currentInteraction: { segId: 'HKCCS' }, responses: new Map() };
      throw new BankUnavailable('timeout');
    },
  };
  await assert.rejects(
    startOrder(client as never, { segId: 'HKCCS' } as never),
    (e: unknown) => e instanceof OrderUnanswered,
  );
});

test('every way a request breaks has its sentence; no body, no English', () => {
  assert.equal(describeError(new BankUnavailable('status', 503)), BANK_UNAVAILABLE);
  assert.equal(describeError(new BankUnavailable('timeout')), BANK_UNAVAILABLE);
  assert.equal(describeError(new BankUnavailable('unreadable')), BANK_UNAVAILABLE);
  assert.equal(describeError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })), BANK_UNREACHABLE);
  assert.equal(describeError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })), BANK_UNAVAILABLE);
  assert.match(describeError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'CERT_HAS_EXPIRED' } })), /nicht sicher/);
  assert.equal(describeError(new Error('Request failed with status code 503: <html>Wartung</html>')), BANK_UNAVAILABLE);
  assert.equal(
    describeError(new Error('TAN must be provided for non-decoupled TAN methods')),
    'Dieses Verfahren braucht eine TAN-Eingabe. Hier geht nur die Freigabe in einer Banking-App.',
  );
  assert.match(describeError(new TypeError("Cannot read properties of undefined (reading 'x')")), /unerwarteter Fehler/);
  // Our own German messages pass through.
  assert.equal(describeError(new Error('Kein offener Vorgang.')), 'Kein offener Vorgang.');
  assert.equal(describeError(new OrderUnanswered(new Error('x'))), new OrderUnanswered(null).message);
  assert.equal(bankErrorKind(new Error('9931: PIN falsch')), null);
});
