import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATTEMPT_LINGER_MS, beginAttempt, cancelAttempt, settleAttempt } from './connect-attempts.ts';

let n = 0;
const newId = () => `attempt-${Date.now().toString(36)}-${(++n).toString().padStart(6, '0')}`;

test('cancelling a running login aborts its bank request', () => {
  const id = newId();
  const a = beginAttempt(id);
  assert.equal(a.signal.aborted, false);
  assert.equal(cancelAttempt(id), null);
  assert.equal(a.signal.aborted, true);
});

test('a login that already made its session hands it over to be dropped — once', () => {
  const id = newId();
  const a = beginAttempt(id);
  settleAttempt(a, 'session-1');
  // The request ending afterwards keeps the session on record.
  settleAttempt(a);
  assert.equal(cancelAttempt(id), 'session-1');
  assert.equal(cancelAttempt(id), null);
});

test('a cancel that overtakes its login keeps that login from starting', () => {
  const id = newId();
  assert.equal(cancelAttempt(id), null);
  assert.equal(beginAttempt(id).signal.aborted, true);
});

test('without a usable id a login runs, it just cannot be called off', () => {
  const a = beginAttempt('kurz');
  assert.equal(a.id, null);
  assert.equal(cancelAttempt('kurz'), null);
  assert.equal(a.signal.aborted, false);
  assert.equal(beginAttempt(undefined).id, null);
});

test('finished attempts are forgotten after a while', () => {
  const id = newId();
  const now = Date.now();
  const a = beginAttempt(id, now);
  settleAttempt(a, 'session-2', now);
  // Another call long after sweeps it: the late cancel finds nothing to drop.
  beginAttempt(newId(), now + ATTEMPT_LINGER_MS + 1);
  assert.equal(cancelAttempt(id, now + ATTEMPT_LINGER_MS + 2), null);
});
