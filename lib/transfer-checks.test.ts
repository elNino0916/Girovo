import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ActivityEntry } from './app-types';
import type { SerializedBalance, SerializedTransaction } from './fints-types';
import type { SentOrder } from './sent-orders';
import { findDuplicate, findSentTransfer, fundsWarning, spendable } from './transfer-checks.ts';

const IBAN = 'DE02120300000000202051';
const NOW = new Date(2026, 9, 4, 15, 30);
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
const fmt = (v: number) => `${v.toFixed(2).replace('.', ',')} €`;

const tx = (over: Partial<SerializedTransaction> = {}): SerializedTransaction => ({
  valueDate: at(2026, 10, 2),
  entryDate: at(2026, 10, 2),
  amount: -120,
  currency: 'EUR',
  purpose: 'Rechnung 118',
  bookingText: 'UEBERWEISUNG',
  remoteName: 'LEA BECKER',
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

const activity = (over: Partial<ActivityEntry> = {}): ActivityEntry => ({
  id: 'a1', at: at(2026, 10, 4, 9, 5), kind: 'transfer', outcome: 'executed',
  accountNumber: '1', name: 'Lea Becker', iban: IBAN, amount: 120, instant: false, ...over,
});

const sent = (over: Partial<SentOrder> = {}): SentOrder => ({
  at: at(2026, 10, 3, 18, 40), accountNumber: '1', iban: IBAN, cents: 12_000, outcome: 'unknown', ...over,
});

const check = (over: Partial<Parameters<typeof findDuplicate>[0]> = {}) => findDuplicate({
  iban: IBAN, cents: 12_000, name: 'Lea Becker', activity: [], sent: [], pending: {}, txByAccount: {}, fmt, now: NOW, ...over,
});

test('nothing alike: no warning', () => {
  assert.equal(check(), null);
  assert.equal(check({ txByAccount: { 1: [tx({ amount: -119.99 })] } }), null);
  assert.equal(check({ sent: [sent({ iban: 'DE89370400440532013000' })] }), null);
});

test('this session\'s own order comes first, with the time it went out', () => {
  const d = check({ activity: [activity()], sent: [sent()], txByAccount: { 1: [tx()] } });
  assert.equal(d?.sentence, 'Heute um 9:05 Uhr hast du bereits 120,00 € an Lea Becker überwiesen.');
});

test('a refused order is no duplicate', () => {
  assert.equal(check({ activity: [activity({ outcome: 'failed' })] }), null);
});

test('an unclear order from before a logout is found in the vault log', () => {
  const d = check({ sent: [sent()] });
  assert.equal(
    d?.sentence,
    'Am 03.10.2026 um 18:40 Uhr hast du bereits eine Überweisung über 120,00 € an Lea Becker gesendet – ihr Status ist unklar.',
  );
});

test('the vault log only looks back two weeks', () => {
  assert.equal(check({ sent: [sent({ at: at(2026, 9, 18) })] }), null);
  assert.ok(check({ sent: [sent({ at: at(2026, 9, 21) })] }));
});

test('a vorgemerkte payment counts before the booked statements', () => {
  const d = check({ pending: { 1: [tx({ entryDate: at(2026, 10, 4), valueDate: at(2026, 10, 4) })] }, txByAccount: { 1: [tx()] } });
  assert.equal(d?.sentence, 'Bei deinen vorgemerkten Umsätzen steht bereits eine Zahlung über 120,00 € an Lea Becker.');
});

test('a direct debit is named as one', () => {
  const debit = tx({ bookingText: 'LASTSCHRIFT', transactionCode: '105', remoteName: 'STADTWERKE' });
  assert.equal(check({ txByAccount: { 1: [debit] } })?.sentence, 'Am 02.10.2026 hat Stadtwerke bereits 120,00 € per Lastschrift eingezogen.');
  assert.equal(check({ pending: { 1: [debit] } })?.sentence, 'Stadtwerke zieht bereits 120,00 € per Lastschrift ein – die Buchung ist vorgemerkt.');
});

test('a booked transfer is found by IBAN and amount', () => {
  assert.equal(
    check({ txByAccount: { 1: [tx()] }, iban: 'de02 1203 0000 0000 2020 51' })?.sentence,
    'Am 02.10.2026 hast du bereits 120,00 € an Lea Becker überwiesen.',
  );
});

// ---------------------------------------------------------------------------

const balance = (over: Partial<SerializedBalance> = {}): SerializedBalance => ({
  balance: 1822.9, currency: 'EUR', date: at(2026, 10, 4), availableAmount: 3749.52, ...over,
});

test('spendable prefers the bank\'s Verfügbar over the Kontostand', () => {
  assert.equal(spendable(balance())?.kind, 'available');
  assert.equal(spendable(balance({ availableAmount: null }))?.kind, 'balance');
  assert.equal(spendable(null), null);
});

test('within the Kontostand: nothing to say', () => {
  assert.equal(fundsWarning(balance(), 100_000), null);
});

test('within Verfügbar but below zero: the Dispositionsrahmen is used', () => {
  assert.deepEqual(fundsWarning(balance(), 200_000), { kind: 'overdraft', balanceAfter: -177.1 });
  // Not for a card, not without a Verfügbar figure to trust.
  assert.equal(fundsWarning(balance(), 200_000, { overdraft: false }), null);
});

test('more than Verfügbar — or, without it, the Kontostand — is the stronger warning', () => {
  assert.deepEqual(fundsWarning(balance(), 400_000), { kind: 'over', basis: 'available' });
  assert.deepEqual(fundsWarning(balance({ availableAmount: null }), 200_000), { kind: 'over', basis: 'balance' });
});

test('no euro account, no figures, no amount: no warning', () => {
  assert.equal(fundsWarning(balance(), 400_000, { currency: 'CHF' }), null);
  assert.equal(fundsWarning(null, 400_000), null);
  assert.equal(fundsWarning(balance(), 0), null);
});

// ---------------------------------------------------------------------------

test('findSentTransfer: a booking from the send day on, before a Vormerkposten', () => {
  const since = new Date(2026, 9, 2, 13, 12);
  const booked = tx({ entryDate: at(2026, 10, 2), valueDate: at(2026, 10, 2) });
  const pending = tx({ entryDate: at(2026, 10, 3), valueDate: at(2026, 10, 3) });
  assert.equal(findSentTransfer({ iban: IBAN, cents: 12_000, since, booked: [booked], pending: [pending] })?.where, 'booked');
  assert.equal(findSentTransfer({ iban: IBAN, cents: 12_000, since, booked: [], pending: [pending] })?.where, 'pending');
});

test('findSentTransfer: older bookings, other amounts and other IBANs do not count', () => {
  const since = new Date(2026, 9, 3, 9, 0);
  const older = tx({ entryDate: at(2026, 10, 2), valueDate: at(2026, 10, 2) });
  const other = tx({ entryDate: at(2026, 10, 4), remoteIban: 'DE89370400440532013000' });
  const credit = tx({ entryDate: at(2026, 10, 4), amount: 120 });
  assert.equal(findSentTransfer({ iban: IBAN, cents: 12_000, since, booked: [older, other, credit], pending: null }), null);
});
