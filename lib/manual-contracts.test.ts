import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearAmount, sanitizeManual } from './manual-contracts.ts';

test('a similar amount: within a quarter, at least a euro', () => {
  assert.equal(nearAmount(1299, 1499), true, 'a price change still fits');
  assert.equal(nearAmount(1299, 4999), false);
  assert.equal(nearAmount(200, 290), true, 'a euro either way for small amounts');
  assert.equal(nearAmount(200, 320), false);
});

test('the vault keeps only well-formed manual contracts', () => {
  assert.deepEqual(sanitizeManual({
    ok: { key: 'out|cred:DE12ZZZ00000123456|mref:KFZ', cents: 31240, cadence: 'yearly', name: ' Kfz\u0007 ', at: '2026-11-07' },
    shop: { key: 'out|cred:LU96ZZZ0000000000000000058|mref:M', shop: 'NETFLIX', cents: 1299, cadence: 'monthly', name: '', at: 'x' },
    badCadence: { key: 'out|iban:DE1', cents: 100, cadence: 'daily', name: '', at: '2026-11-07' },
    badCents: { key: 'out|iban:DE1', cents: 0, cadence: 'monthly', name: '', at: '2026-11-07' },
    noKey: { cents: 100, cadence: 'monthly' },
  }), {
    ok: { key: 'out|cred:DE12ZZZ00000123456|mref:KFZ', cents: 31240, cadence: 'yearly', name: 'Kfz', at: '2026-11-07' },
    shop: { key: 'out|cred:LU96ZZZ0000000000000000058|mref:M', shop: 'NETFLIX', cents: 1299, cadence: 'monthly', name: '', at: '1970-01-01' },
  });
  assert.equal(sanitizeManual([]), undefined);
  assert.equal(sanitizeManual({}), undefined);
});
