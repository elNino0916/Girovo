import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BankingInformation } from 'lib-fints';
import { canRestore, type DeviceProfile } from './state-store.ts';

const OWN = 'B0000000000000000000000CD';
const EARLIER = 'A0000000000000000000000AB';

const profile = (systemId: string | undefined, productId?: string): DeviceProfile => ({
  bankingInformation: { systemId } as unknown as BankingInformation,
  tanMethodId: 923,
  ...(productId ? { productId } : {}),
});

test('a remembered device opens as it is under the product ID it was set up with', () => {
  assert.equal(canRestore(profile('ABC123', OWN), OWN), true);
});

test('a Kundensystem-ID from another product ID is synchronised afresh, never sent (9391)', () => {
  assert.equal(canRestore(profile('ABC123', EARLIER), OWN), false);
  // Saved before profiles named their product ID: made under the one Girovo sent before its own.
  assert.equal(canRestore(profile('ABC123'), OWN), false);
});

test('a profile without a real Kundensystem-ID was never one to restore', () => {
  assert.equal(canRestore(profile('0', OWN), OWN), false);
  assert.equal(canRestore(profile(undefined, OWN), OWN), false);
  assert.equal(canRestore(null, OWN), false);
});
