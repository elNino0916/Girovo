import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SerializedTransaction } from './fints-types';
import { transferHistoryHint } from './transfer-history-hint.ts';

const IBAN = 'DE69430609674012345600';
const OTHER = 'DE89370400440532013000';

const tx = (over: Partial<SerializedTransaction> = {}): SerializedTransaction => ({
  valueDate: '2026-10-02T10:00:00.000Z',
  entryDate: '2026-10-02T10:00:00.000Z',
  amount: -25,
  currency: 'EUR',
  purpose: 'Pizza',
  bookingText: 'UEBERWEISUNG',
  remoteName: 'LEA HOFFMANN',
  remoteIban: IBAN,
  remoteBic: '',
  e2eReference: '',
  mandateReference: '',
  customerReference: '',
  bankReference: '',
  transactionCode: '116',
  primeNotesNr: '',
  textKeyExtension: '',
  additionalInformation: '',
  statementNumber: '',
  ...over,
});

const hint = (cents: number, txByAccount: Record<string, SerializedTransaction[]>, iban = IBAN) =>
  transferHistoryHint({ iban, cents, txByAccount });

test('three earlier transfers of the same amount, ten times as much now: the same amount', () => {
  const h = hint(25_000, { 1: [tx(), tx(), tx()] });
  assert.deepEqual(h, { count: 3, largest: 25, same: 25 });
});

test('earlier amounts that differ: the largest, no same', () => {
  const h = hint(25_000, { 1: [tx({ amount: -40 }), tx({ amount: -12.5 })], 2: [tx({ amount: -30 })] });
  assert.deepEqual(h, { count: 3, largest: 40, same: null });
});

test('the IBAN matches however it is spaced or cased', () => {
  const h = hint(10_000, { 1: [tx({ remoteIban: 'de69 4306 0967 4012 3456 00' }), tx()] }, 'DE69 4306 0967 4012 3456 00');
  assert.equal(h?.count, 2);
});

test('fewer than two earlier transfers: no hint', () => {
  assert.equal(hint(25_000, { 1: [tx()] }), null);
  assert.equal(hint(25_000, {}), null);
});

test('less than three times the largest: no hint', () => {
  assert.equal(hint(7_499, { 1: [tx(), tx()] }), null);
  assert.notEqual(hint(7_500, { 1: [tx(), tx()] }), null);
});

test('another IBAN, a booking without one, or a name alone: not counted', () => {
  assert.equal(hint(25_000, { 1: [tx({ remoteIban: OTHER }), tx({ remoteIban: OTHER })] }), null);
  assert.equal(hint(25_000, { 1: [tx({ remoteIban: '' }), tx({ remoteIban: '' })] }), null);
  assert.equal(hint(25_000, { 1: [tx(), tx({ remoteIban: '' })] }), null);
});

test('credits, direct debits and card payments to the IBAN are not money sent', () => {
  assert.equal(hint(25_000, { 1: [tx({ amount: 25 }), tx({ amount: 25 })] }), null);
  assert.equal(hint(25_000, { 1: [tx({ bookingText: 'LASTSCHRIFT', transactionCode: '105' }), tx({ bookingText: 'LASTSCHRIFT', transactionCode: '105' })] }), null);
  assert.equal(hint(25_000, { 1: [tx({ bookingText: 'KARTENZAHLUNG' }), tx({ bookingText: 'KARTENZAHLUNG' })] }), null);
});

test('an instant transfer and a standing order count', () => {
  const h = hint(25_000, { 1: [tx({ bookingText: 'ECHTZEIT-UEBERWEISUNG' }), tx({ bookingText: 'DAUERAUFTRAG' })] });
  assert.equal(h?.count, 2);
});

test('a booking in another currency is left out', () => {
  assert.equal(hint(25_000, { 1: [tx(), tx({ currency: 'USD' })] }), null);
});

test('no IBAN or no amount: no hint', () => {
  assert.equal(hint(25_000, { 1: [tx(), tx()] }, ''), null);
  assert.equal(hint(0, { 1: [tx(), tx()] }), null);
});
