import { test } from 'node:test';
import assert from 'node:assert/strict';

// The shell's Windows Hello and the server, both in the test's hands: each
// unlock and each request waits until the test lets it go.
type Gesture = { result: string; key?: string; code?: string };
const unlocks: Array<(g: Gesture) => void> = [];
const requests: Array<(body: unknown) => void> = [];
let unlockCalls = 0;

(globalThis as { window?: unknown }).window = {
  electronHello: {
    available: async () => true,
    enroll: async () => ({ result: 'failed' }),
    unlock: () => {
      unlockCalls += 1;
      return new Promise<Gesture>((resolve) => unlocks.push(resolve));
    },
  },
  electronLinkedUnlock: { secret: async () => 'c2VjcmV0' },
  addEventListener: () => {},
  dispatchEvent: () => true,
};
globalThis.fetch = (async () =>
  new Promise<Response>((resolve) => requests.push((body) => resolve(new Response(JSON.stringify(body), { status: 200 }))))) as typeof fetch;

const { openWithHello } = await import('./windows-hello-client.ts');
const login = { blz: '12345678', userId: 'kunde1' };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('openWithHello: no second prompt while an earlier request is still at it', async () => {
  const first = openWithHello(login);
  await tick();
  assert.equal(unlockCalls, 1);

  // Its prompt open: the shell answers a second unlock with 'busy' (and brings the prompt to the front).
  const second = openWithHello(login);
  await tick();
  assert.equal(unlockCalls, 2);
  unlocks[1]({ result: 'busy' });
  assert.deepEqual(await second, { result: 'busy' });

  // Its gesture given, the PIN being opened: no unlock is asked for at all.
  unlocks[0]({ result: 'unlocked', key: 'a2V5' });
  await tick();
  assert.equal(requests.length, 1);
  assert.deepEqual(await openWithHello(login), { result: 'busy' });
  assert.equal(unlockCalls, 2);

  requests[0]({ pin: '12345' });
  assert.deepEqual(await first, { result: 'opened', pin: '12345' });

  // Done: the next one asks again.
  const third = openWithHello(login);
  await tick();
  assert.equal(unlockCalls, 3);
  unlocks[2]({ result: 'canceled' });
  assert.deepEqual(await third, { result: 'canceled' });
});
