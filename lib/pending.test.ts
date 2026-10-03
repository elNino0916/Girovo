import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unbookedPending } from './pending.ts';
import type { SerializedTransaction } from './fints-types';

/** JSON of a local calendar day — what the wire carries for a booking date. */
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d).toISOString();

const tx = (over: Partial<SerializedTransaction> = {}): SerializedTransaction => ({
  valueDate: day(2026, 10, 5),
  entryDate: day(2026, 10, 5),
  amount: -120,
  currency: 'EUR',
  purpose: 'Abschlag Strom',
  bookingText: 'LASTSCHRIFT',
  remoteName: 'Stadtwerke Musterstadt',
  remoteIban: 'DE02120300000000202051',
  remoteBic: '',
  e2eReference: 'ABS-2026-10-4711',
  mandateReference: 'M-1',
  customerReference: '',
  bankReference: '',
  transactionCode: '105',
  primeNotesNr: '',
  textKeyExtension: '',
  additionalInformation: '',
  statementNumber: '',
  ...over,
});

test('a Vormerkposten the statement now lists as booked is gone', () => {
  const pending = [tx()];
  const booked = [tx({ bankReference: 'B-991' }), tx({ remoteName: 'REWE', remoteIban: '', e2eReference: '', amount: -12.9 })];
  assert.deepEqual(unbookedPending(pending, booked), []);
});

test('nothing booked: the very same array comes back', () => {
  const pending = [tx(), tx({ amount: -9.99, e2eReference: 'NF-1', remoteName: 'Netflix' })];
  assert.equal(unbookedPending(pending, []), pending);
  assert.equal(unbookedPending(pending, [tx({ amount: -1, e2eReference: '' })]), pending);
});

test('a card payment booked days later is matched by its end-to-end reference', () => {
  const card = tx({
    entryDate: day(2026, 10, 1), valueDate: day(2026, 10, 1), amount: -54.3,
    remoteName: 'Tankstelle', remoteIban: '', e2eReference: 'CARD-88123',
  });
  const booking = { ...card, entryDate: day(2026, 10, 3), valueDate: day(2026, 10, 1) };
  assert.deepEqual(unbookedPending([card], [booking]), []);
});

test('the same reference a month earlier is the last instalment, not this one', () => {
  // A debit whose creditor reuses one reference every month.
  const now = tx({ e2eReference: 'MIETE', entryDate: day(2026, 11, 1), valueDate: day(2026, 11, 1) });
  const lastMonth = tx({ e2eReference: 'MIETE', entryDate: day(2026, 10, 1), valueDate: day(2026, 10, 1) });
  assert.deepEqual(unbookedPending([now], [lastMonth]), [now]);
});

test('a reference match needs the same amount and IBAN', () => {
  const p = tx({ entryDate: day(2026, 10, 2) });
  assert.equal(unbookedPending([p], [tx({ amount: -121 })]).length, 1);
  assert.equal(unbookedPending([p], [tx({ remoteIban: 'DE89370400440532013000' })]).length, 1);
});

test('"NOTPROVIDED" is no reference and matches nothing by itself', () => {
  const p = tx({ e2eReference: 'NOTPROVIDED', entryDate: day(2026, 10, 2) });
  const b = tx({ e2eReference: 'NOTPROVIDED', entryDate: day(2026, 10, 4) });
  assert.equal(unbookedPending([p], [b]).length, 1);
});

test('one booking accounts for one Vormerkposten only', () => {
  const coffee = () => tx({ amount: -3.2, remoteName: 'Café', remoteIban: '', e2eReference: '', bookingText: 'KARTENZAHLUNG' });
  const a = coffee();
  const b = coffee();
  const left = unbookedPending([a, b], [coffee()]);
  assert.equal(left.length, 1);
  assert.equal(left[0], b);
});
