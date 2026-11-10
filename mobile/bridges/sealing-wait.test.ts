import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VERIFY_WAIT_MS, loginsVerified } from './sealing-wait.ts';
import type { LiveLogin } from '../server/logins';

const login = (userId: string, verified: boolean): LiveLogin => ({ blz: '50050201', userId, pin: '12345', verified });

/** A server whose answers the test lines up, one per ask; the last one repeats. */
function server(...rounds: Array<Array<LiveLogin | null>>) {
  let asked = 0;
  const ask = async () => rounds[Math.min(asked++, rounds.length - 1)];
  return { ask, asked: () => asked };
}
const noSleep = async () => {};

test('already checked: sealed at once, no waiting', async () => {
  const s = server([login('a', true), login('b', true)]);
  const got = await loginsVerified(['s1', 's2'], VERIFY_WAIT_MS.seal, s.ask, noSleep);
  assert.deepEqual(got.map((l) => l?.verified), [true, true]);
  assert.equal(s.asked(), 1);
});

test('a further bank on its remembered device: waited for until the bank has answered for it', async () => {
  const s = server(
    [login('a', true), login('b', false)],
    [login('a', true), login('b', false)],
    [login('a', true), login('b', true)],
  );
  const got = await loginsVerified(['s1', 's2'], VERIFY_WAIT_MS.seal, s.ask, noSleep);
  assert.deepEqual(got.map((l) => l?.verified), [true, true]);
  assert.equal(s.asked(), 3);
});

test('no answer within the wait: the logins as they stand, the unchecked one marked so', async () => {
  const s = server([login('a', true), login('b', false)]);
  const slept: number[] = [];
  const got = await loginsVerified(['s1', 's2'], 5_000, s.ask, async (ms) => {
    slept.push(ms);
  });
  assert.deepEqual(got.map((l) => l?.verified), [true, false]);
  assert.equal(slept.reduce((a, b) => a + b, 0), 5_000);
});

test('a session that ends meanwhile ends the wait; one that was never there does not hold it up', async () => {
  const gone = server([login('a', false)], [null]);
  assert.deepEqual(await loginsVerified(['s1'], VERIFY_WAIT_MS.enroll, gone.ask, noSleep), [null]);
  assert.equal(gone.asked(), 2);
  const never = server([null, login('b', true)]);
  assert.deepEqual((await loginsVerified(['s0', 's2'], VERIFY_WAIT_MS.seal, never.ask, noSleep)).map((l) => l?.userId ?? null), [null, 'b']);
  assert.equal(never.asked(), 1);
});
