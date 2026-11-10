import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fingerprintIdOf } from './fingerprint-id.ts';

test('a login\'s name behind the fingerprint: the hash BiometricPlugin.java takes, the same for the page and the background check', () => {
  const id = fingerprintIdOf('50050201', 'max.muster');
  // What mobile/bridges/biometric.ts has always sealed entries under: a change here would orphan every one of them.
  assert.equal(id, crypto.createHash('sha256').update('50050201|max.muster|biometric').digest('hex').slice(0, 32));
  // BiometricPlugin's ID pattern: anything else is not noted, and not looked up.
  assert.match(id, /^[0-9a-f]{32}$/);
  assert.notEqual(id, fingerprintIdOf('50050201', 'max.muster2'));
  assert.notEqual(id, fingerprintIdOf('12030000', 'max.muster'));
  // Not the device profile's name (lib/state-store.ts): the two stores stay apart.
  assert.notEqual(id, crypto.createHash('sha256').update('50050201|max.muster').digest('hex').slice(0, 32));
});
