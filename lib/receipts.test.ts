import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchAwaiting } from './receipts.ts';
import { sanitizeDoc, sniffMime, safeDocName, type KeptDoc } from './docs.ts';
import type { SerializedTransaction } from './fints-types';

const IBAN = 'DE12500105170648489890';

const doc = (id: string, sentAt: string, cents = 12000, iban = IBAN): KeptDoc => sanitizeDoc({
  id: id.padEnd(32, '0'), kind: 'receipt', mime: 'application/pdf', name: 'Rechnung.pdf', size: 10,
  addedAt: sentAt, accountNumber: '1234', tx: null, awaiting: { iban, cents, sentAt },
})!;

const tx = (day: string, amount: number, iban = IBAN): SerializedTransaction => ({
  valueDate: day, entryDate: day, amount, currency: 'EUR', purpose: 'Rechnung 4711', bookingText: 'ONLINE-UEBERWEISUNG',
  remoteName: 'Stadtwerke', remoteIban: iban, remoteBic: '', e2eReference: '', mandateReference: '', customerReference: '',
  bankReference: day, transactionCode: '', primeNotesNr: '', textKeyExtension: '', additionalInformation: '', statementNumber: '',
});

test('the booking of the order takes its invoice', () => {
  const hits = matchAwaiting([doc('a', '2026-10-12T09:00:00.000Z')], [tx('2026-10-13', -120), tx('2026-10-13', -12)]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].tx.amount, -120);
});

test('not another amount, another IBAN, money coming in, or a day too early or too late', () => {
  const d = [doc('a', '2026-10-12T09:00:00.000Z')];
  assert.equal(matchAwaiting(d, [tx('2026-10-13', -120.01)]).length, 0);
  assert.equal(matchAwaiting(d, [tx('2026-10-13', -120, 'DE89370400440532013000')]).length, 0);
  assert.equal(matchAwaiting(d, [tx('2026-10-13', 120)]).length, 0);
  assert.equal(matchAwaiting(d, [tx('2026-10-10', -120)]).length, 0);
  assert.equal(matchAwaiting(d, [tx('2026-10-27', -120)]).length, 0);
  assert.equal(matchAwaiting(d, [tx('2026-10-11', -120)]).length, 1);
});

test('two invoices for the same amount take two bookings, in order', () => {
  const hits = matchAwaiting(
    [doc('b', '2026-10-14T09:00:00.000Z'), doc('a', '2026-10-12T09:00:00.000Z')],
    [tx('2026-10-15', -120), tx('2026-10-13', -120)],
  );
  assert.deepEqual(hits.map((h) => [h.doc.id[0], String(h.tx.entryDate)]), [['a', '2026-10-13'], ['b', '2026-10-15']]);
});

test('a document is what its bytes say, and its name is safe', () => {
  assert.equal(sniffMime(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])), 'application/pdf');
  assert.equal(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(sniffMime(new Uint8Array([0x3c, 0x68, 0x74, 0x6d])), null);
  assert.equal(safeDocName('../../Rechnung: Oktober?.exe', 'application/pdf', 'Beleg'), 'Rechnung Oktober.pdf');
  assert.equal(safeDocName('', 'image/png', 'Beleg'), 'Beleg.png');
});

test('an index entry from disk is checked, field by field', () => {
  assert.equal(sanitizeDoc({ id: 'x', kind: 'receipt' }), null);
  const d = sanitizeDoc({ ...doc('c', '2026-10-12T09:00:00.000Z'), tx: '2026-10-13|-120.00|DE…|' });
  assert.ok(d);
  // A receipt on its booking waits for nothing.
  assert.equal(d.awaiting, null);
});
