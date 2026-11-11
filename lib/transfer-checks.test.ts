import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ActivityEntry } from './app-types';
import type { SerializedBalance, SerializedBankOrder, SerializedTransaction } from './fints-types';
import type { SentOrder } from './sent-orders';
import { findDuplicate, findPlacedOrder, findSentTransfer, fundsWarning, spendable } from './transfer-checks.ts';

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
    'Am 03.10.2026 um 18:40 Uhr hast du bereits eine Überweisung über 120,00 € an Lea Becker gesendet. Ihr Status ist unklar.',
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
  assert.equal(check({ pending: { 1: [debit] } })?.sentence, 'Stadtwerke zieht bereits 120,00 € per Lastschrift ein. Die Buchung ist vorgemerkt.');
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

// The order went out on 4 October at 15:00; the lists were read at 9:00 that day.
const SENT = new Date(2026, 9, 4, 15, 0);
const READ = new Date(2026, 9, 4, 9, 0).getTime();
const day = (d: number, over: Partial<SerializedTransaction> = {}) => tx({ entryDate: at(2026, 10, d), valueDate: at(2026, 10, d), ...over });
const sightingOf = (over: Partial<Parameters<typeof findSentTransfer>[0]>) =>
  findSentTransfer({ iban: IBAN, cents: 12_000, since: SENT, accountNumber: '1', ...over });

test('findSentTransfer: an identical booking that was there before the order is not it', () => {
  const morning = day(4, { purpose: 'Rechnung 117' });
  const ours = day(4);
  const before = { booked: [morning], pending: [], at: READ };
  // Only the morning's: nothing new — not "found".
  assert.equal(sightingOf({ booked: [morning], before }), null);
  // The morning's and one more: that one, and certain.
  const s = sightingOf({ booked: [morning, ours], before });
  assert.equal(s?.where, 'booked');
  assert.equal(s?.unsure, undefined);
  assert.equal(s?.tx, ours);
  // Two identical ones on the same day, the first held: still counted, not matched by position.
  assert.equal(sightingOf({ booked: [ours, day(4)], before: { booked: [day(4)], pending: [], at: READ } })?.unsure, undefined);
});

test('findSentTransfer: of several new debits, the one nearest after the order', () => {
  const s = sightingOf({ booked: [day(6), day(5)], before: { booked: [], pending: [], at: READ } });
  assert.equal(s?.tx.entryDate, at(2026, 10, 5));
});

test('findSentTransfer: a Vormerkposten still listed is no new one; a new one is found', () => {
  const held = day(4, { purpose: 'Miete' });
  const ours = day(4);
  const before = { booked: [], pending: [held], at: READ };
  assert.equal(sightingOf({ booked: [], pending: [held], before }), null);
  assert.equal(sightingOf({ booked: [], pending: [held, ours], before })?.where, 'pending');
  // One held under an earlier day, still listed there, takes nothing away.
  const stuck = day(2);
  assert.equal(sightingOf({ booked: [], pending: [stuck, ours], before: { booked: [], pending: [stuck], at: READ } })?.unsure, undefined);
  // A held Vormerkposten gone, a booking in its place: maybe that one booked, maybe this order.
  const s = sightingOf({ booked: [ours], pending: [], before });
  assert.equal(s?.unsure, true);
  assert.equal(s?.unsure && s.count, 1);
});

test('findSentTransfer: another order of the same payment the lists cannot show makes it unclear', () => {
  const before = { booked: [], pending: [], at: READ };
  // Sent at 11:00, after the lists were read: its debit may be the one there.
  const other = sent({ at: at(2026, 10, 4, 11, 0) });
  const one = sightingOf({ booked: [day(4)], before, sent: [other] });
  assert.equal(one?.unsure, true);
  assert.equal(one?.unsure && one.count, 1);
  // Two debits for two orders: one is this one.
  assert.equal(sightingOf({ booked: [day(4), day(4)], before, sent: [other] })?.unsure, undefined);
  // Not the same payment, another account, or this very order (logged after it went out): no matter.
  for (const o of [sent({ at: at(2026, 10, 4, 11, 0), cents: 12_001 }), sent({ at: at(2026, 10, 4, 11, 0), accountNumber: '2' }), sent({ at: at(2026, 10, 4, 15, 1) })]) {
    assert.equal(sightingOf({ booked: [day(4)], before, sent: [o] })?.unsure, undefined);
  }
  // Sent before the read, the same day: a debit the lists held may be its own
  // or someone else's, and its own may still come — unclear.
  const early = sent({ at: at(2026, 10, 4, 8, 0) });
  assert.equal(sightingOf({ booked: [day(4)], before, sent: [early] })?.unsure, true);
  const itsDebit = day(4, { purpose: 'Rechnung 117' });
  assert.equal(sightingOf({ booked: [itsDebit, day(4)], before: { ...before, booked: [itsDebit] }, sent: [early] })?.unsure, true);
  // A Terminüberweisung due that day books a debit like it too.
  const dated = sent({ at: at(2026, 9, 28), kind: 'dated', due: '2026-10-04' });
  assert.equal(sightingOf({ booked: [day(4)], before, sent: [dated] })?.unsure, true);
  // Orders long before carry no weight.
  assert.equal(sightingOf({ booked: [day(4)], before, sent: [sent({ at: at(2026, 9, 28) })] })?.unsure, undefined);
  // Lists not on hand: one sent two days before is explained by its debit, now listed under its own day.
  const monday = sent({ at: at(2026, 10, 2, 10, 0), outcome: 'executed' });
  assert.equal(sightingOf({ booked: [day(2), day(4)], sent: [monday] })?.unsure, undefined);
  assert.equal(sightingOf({ booked: [day(4)], sent: [monday] })?.unsure, true);
});

test('findSentTransfer: an earlier order is explained only by a debit that can be its own, each debit once', () => {
  // (a) 120 € paid in online banking on the 2nd; order E from Girovo at 9:00
  // on the 4th; the bookings read at 9:05 without E's; this order at 15:00
  // never went out — E's booking is all that is new.
  const online = day(2, { purpose: 'Online-Banking' });
  const e = sent({ at: at(2026, 10, 4, 9, 0), outcome: 'executed' });
  const eDebit = day(4, { purpose: 'E' });
  const read905 = new Date(2026, 9, 4, 9, 5).getTime();
  assert.equal(sightingOf({ booked: [online, eDebit], pending: [], before: { booked: [online], pending: [], at: read905 }, sent: [e] })?.unsure, true);
  assert.equal(sightingOf({ booked: [online, eDebit], pending: [], sent: [e] })?.unsure, true);
  // (b) An unrelated Vormerkposten held and still listed does not account for E either.
  const other = day(4, { purpose: 'Online-Banking gestern' });
  const e8 = sent({ at: at(2026, 10, 4, 8, 0) });
  assert.equal(sightingOf({ booked: [eDebit], pending: [other], before: { booked: [], pending: [other], at: read905 }, sent: [e8] })?.unsure, true);
  // A debit dated before an order's own day is not its own.
  const tuesday = sent({ at: at(2026, 10, 3, 10, 0) });
  assert.equal(sightingOf({ booked: [day(2), day(4)], sent: [tuesday] })?.unsure, true);
  assert.equal(sightingOf({ booked: [day(3), day(4)], sent: [tuesday] })?.unsure, undefined);
  // One debit for one order: two orders on the 2nd, one debit from then.
  const twice = [sent({ at: at(2026, 10, 2, 10, 0) }), sent({ at: at(2026, 10, 2, 11, 0) })];
  assert.equal(sightingOf({ booked: [day(2), day(4)], sent: twice })?.unsure, true);
  assert.equal(sightingOf({ booked: [day(2), day(2, { purpose: 'Rechnung 119' }), day(4)], sent: twice })?.unsure, undefined);
  // A debit the lists held is the order's own only if the order went out before they were read.
  const held3 = day(3, { purpose: 'Rechnung 119' });
  const readOn3 = { booked: [], pending: [held3], at: new Date(2026, 9, 3, 9, 0).getTime() };
  assert.equal(sightingOf({ booked: [day(4)], pending: [held3], before: readOn3, sent: [sent({ at: at(2026, 10, 3, 11, 0) })] })?.unsure, true);
  assert.equal(sightingOf({ booked: [day(4)], pending: [held3], before: readOn3, sent: [sent({ at: at(2026, 10, 3, 8, 0) })] })?.unsure, undefined);
});

test('findSentTransfer: two new debits that may both be older ones are counted', () => {
  const s = sightingOf({
    booked: [day(4), day(5)],
    before: { booked: [], pending: [], at: READ },
    sent: [sent({ at: at(2026, 10, 4, 10, 0) }), sent({ at: at(2026, 10, 4, 11, 0) })],
  });
  assert.equal(s?.unsure, true);
  assert.equal(s?.unsure && s.count, 2);
  assert.equal(s?.tx.entryDate, at(2026, 10, 4));
});

// ---------------------------------------------------------------------------
// Orders the bank keeps for later (lib/order-schedule.ts, lib/sent-orders.ts)

const standing = { kind: 'standing' as const, first: '2026-11-01', unit: 'M' as const, interval: 1, day: 1 };
const dated = { kind: 'dated' as const, date: '2026-10-20' };
const bankOrder = (over: Partial<SerializedBankOrder> = {}): SerializedBankOrder => ({
  ref: 'r1', kind: 'standing', orderId: 'DA-1', name: 'LEA BECKER', iban: IBAN, bic: null, amount: 120, currency: 'EUR',
  purpose: '', schedule: standing, more: 0, deletable: true, changeable: true, ...over,
});

test('a new Dauerauftrag is never a repeat of payments made — only of another Dauerauftrag', () => {
  // The rent paid by hand last week beside a new Dauerauftrag for it: no warning.
  assert.equal(check({ schedule: standing, activity: [activity()], sent: [sent()], txByAccount: { 1: [tx()] } }), null);
  const d = check({ schedule: standing, activity: [activity({ schedule: standing })] });
  assert.equal(d?.sentence, 'Heute um 9:05 Uhr hast du bereits einen Dauerauftrag über 120,00 € an Lea Becker eingerichtet.');
  assert.equal(d?.title, 'Schon eingerichtet?');
  const held = check({ schedule: standing, bankOrders: [bankOrder()] });
  assert.equal(held?.sentence, 'Bei deiner Bank besteht schon ein Dauerauftrag über 120,00 € an Lea Becker (monatlich am 1.).');
});

test('a terminierte Überweisung is one payment: payments and other Terminüberweisungen count, Daueraufträge do not', () => {
  assert.equal(
    check({ schedule: dated, txByAccount: { 1: [tx()] } })?.sentence,
    'Am 02.10.2026 hast du bereits 120,00 € an Lea Becker überwiesen.',
  );
  assert.equal(check({ schedule: dated, activity: [activity({ schedule: standing })] }), null);
  assert.equal(check({ schedule: dated, bankOrders: [bankOrder()] }), null);
  const vault = check({ schedule: dated, sent: [sent({ kind: 'dated', due: '2026-10-20', outcome: 'executed' })] });
  assert.equal(vault?.sentence, 'Am 03.10.2026 um 18:40 Uhr hast du bereits eine Terminüberweisung über 120,00 € an Lea Becker zum 20.10.2026 angelegt.');
  assert.equal(vault?.title, 'Schon angelegt?');
  assert.equal(
    check({ schedule: dated, bankOrders: [bankOrder({ kind: 'dated', schedule: dated })] })?.sentence,
    'Bei deiner Bank liegt schon eine Terminüberweisung über 120,00 € an Lea Becker zum 20.10.2026.',
  );
});

test('a transfer now is warned about a terminierte Überweisung of the same payment, never about a Dauerauftrag', () => {
  assert.match(check({ activity: [activity({ schedule: dated, outcome: 'unknown' })] })?.sentence ?? '', /Terminüberweisung .* zum 20\.10\.2026 gesendet. Ihr Status ist unklar/);
  assert.equal(check({ sent: [sent({ kind: 'standing', due: '2026-11-01' })] }), null);
  assert.equal(check({ activity: [activity()] })?.title, 'Schon einmal überwiesen?');
});

test('findPlacedOrder: the order in the bank\'s list, the same schedule first', () => {
  const other = bankOrder({ ref: 'r2', schedule: { ...standing, day: 15, first: '2026-11-15' } });
  const same = bankOrder({ ref: 'r3' });
  assert.equal(findPlacedOrder({ iban: IBAN, cents: 12_000, schedule: standing, orders: [other, same] })?.ref, 'r3');
  assert.equal(findPlacedOrder({ iban: IBAN, cents: 12_000, schedule: standing, orders: [other] })?.ref, 'r2');
  assert.equal(findPlacedOrder({ iban: IBAN, cents: 12_000, schedule: dated, orders: [same] }), null);
  assert.equal(findPlacedOrder({ iban: IBAN, cents: 12_001, schedule: standing, orders: [same] }), null);
});
