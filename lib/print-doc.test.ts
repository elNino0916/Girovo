import './__fixtures__/tz.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SerializedTransaction } from './fints-types';
import {
  bookingReferences, bookingState, creditLine, cssString, fmtBalance, fmtBlz, fmtMovement, paperText, statementLedger,
  statementNumberRange, statementPeriod,
} from './print-doc.ts';
import { block, camt, mt940, mt940Date, newestFirst } from './__fixtures__/transactions.ts';

// ---------------------------------------------------------------------------
// Booking state

test('a booking dated after the day of printing is "ahead", not booked', () => {
  // Printed on Saturday 3 October, 10:00; MT940 dates are local midnight.
  const now = new Date(2026, 9, 3, 10, 0);
  const monday = mt940({ day: '2026-10-05', valueDay: '2026-10-03', amount: -64.18, gvc: '106', text: 'KARTENZAHLUNG' });
  const today = mt940({ day: '2026-10-03', amount: -12, gvc: '106' });
  const before = mt940({ day: '2026-10-02', amount: -12, gvc: '106' });
  assert.equal(bookingState(monday, false, now), 'ahead');
  assert.equal(bookingState(today, false, now), 'booked');
  assert.equal(bookingState(before, false, now), 'booked');
  // Pending wins, whatever its provisional date says.
  assert.equal(bookingState(monday, true, now), 'pending');
  assert.equal(bookingState(before, true, now), 'pending');
});

test('state follows the local calendar day, also for CAMT noon dates', () => {
  // 23:30 local on the 4th: CAMT dates the 5th at local noon, the 4th too.
  const lateEvening = new Date(2026, 9, 4, 23, 30);
  assert.equal(bookingState(camt({ day: '2026-10-05', amount: -1 }), false, lateEvening), 'ahead');
  assert.equal(bookingState(camt({ day: '2026-10-04', amount: -1 }), false, lateEvening), 'booked');
});

// ---------------------------------------------------------------------------
// Names and text

test('prints the bank\'s casing and repairs only encoding damage', () => {
  const tx: SerializedTransaction = {
    ...mt940({ day: '2026-09-18', amount: -34.62, name: 'Landesbank Hessen-ThA.ringen', gvc: '005', text: 'LASTSCHRIFT',
      purpose: '2026-09-18T14:08 Debitk.0 2030-12 Original 39,86 USD 1 Euro=1,1563 USD Einsatzentgelt 0,15 EUR Zahl.System VISA Debit' }),
    ultimateName: 'OPENAI *CHATGPT SUBSCR',
  };
  const t = paperText(tx);
  assert.equal(t.name, 'OPENAI *CHATGPT SUBSCR');
  assert.equal(t.via, 'Landesbank Hessen-Thüringen');
  assert.equal(t.bankName, null);
  assert.equal(t.bookingText, 'Lastschrift');
  assert.deepEqual(t.purposeLines, [tx.purpose]);
});

test('a card descriptor leads with the shop and keeps the bank\'s whole string', () => {
  const tx: SerializedTransaction = {
    ...mt940({ day: '2026-09-18', amount: -4.2, name: 'Adyen N.V.', gvc: '106', text: 'KARTENZAHLUNG' }),
    ultimateName: 'LS Caf Nova Deutzer F/Frankenwerft 1/Kln/DE',
  };
  const t = paperText(tx);
  // The shop as the app restores it on screen…
  assert.equal(t.name, 'Café Nova Deutzer F');
  // …and the descriptor exactly as the bank sent it.
  assert.equal(t.bankName, 'LS Caf Nova Deutzer F/Frankenwerft 1/Kln/DE');
  assert.equal(t.via, 'Adyen N.V.');
});

test('references carry the drawer\'s labels, skip SEPA placeholders and print a repeated value once', () => {
  const raw = mt940({
    day: '2026-09-15', amount: -148, name: 'STADTWERKE', gvc: '105', text: 'BASISLASTSCHRIFT',
    eref: 'SWM2026094021889120', mref: 'SWM-4021889120', cred: 'DE98ZZZ09999999999', rawTags: true,
    purpose: 'ABSCHLAG STROM/GAS',
  });
  const refs = bookingReferences(raw);
  assert.deepEqual(refs.map((r) => [r.label, r.value]), [
    ['End-to-End-Referenz', 'SWM2026094021889120'],
    ['Mandatsreferenz', 'SWM-4021889120'],
    ['Gläubiger-ID', 'DE98ZZZ09999999999'],
  ]);
  const camtRefs = bookingReferences(camt({ day: '2026-09-15', amount: -1, ref: '2123456789012345' }));
  assert.deepEqual(camtRefs.map((r) => r.label), ['Bankreferenz']);
});

// ---------------------------------------------------------------------------
// Account figures

test('the credit line is named as on screen and printed as its size', () => {
  assert.deepEqual(creditLine(-2000, 'CheckingAccount'), { label: 'Dispositionsrahmen', amount: 2000 });
  assert.deepEqual(creditLine(2500, 'CreditCardAccount'), { label: 'Kreditrahmen', amount: 2500 });
  // A card by its numeric Kontoart (50–59) is a card on paper too, as on screen.
  assert.deepEqual(creditLine(2500, '50'), { label: 'Kreditrahmen', amount: 2500 });
  assert.deepEqual(creditLine(-1500, '57'), { label: 'Kreditrahmen', amount: 1500 });
  // Any other Kontoart keeps its Dispositionsrahmen.
  assert.deepEqual(creditLine(-2000, '1'), { label: 'Dispositionsrahmen', amount: 2000 });
  assert.deepEqual(creditLine(-2000, '60'), { label: 'Dispositionsrahmen', amount: 2000 });
  assert.equal(creditLine(0, 'CheckingAccount'), null);
  assert.equal(creditLine(0.001, 'CheckingAccount'), null);
  assert.equal(creditLine(null, 'CheckingAccount'), null);
  assert.equal(creditLine(undefined, 'CheckingAccount'), null);
});

test('a BLZ is grouped the way statements print it', () => {
  assert.equal(fmtBlz('57069999'), '570 699 99');
  assert.equal(fmtBlz('570 699 99'), '570 699 99');
  assert.equal(fmtBlz('1234'), '1234');
  assert.equal(fmtBlz(null), '');
});

test('the period is the fetched range, not the span of booking dates', () => {
  const txs = [mt940({ day: '2026-10-05', amount: -1 }), mt940({ day: '2026-07-09', amount: -1 })];
  assert.deepEqual(statementPeriod('2026-07-06', '2026-10-03', txs), { from: '2026-07-06', to: '2026-10-03' });
  assert.deepEqual(statementPeriod(undefined, undefined, txs), { from: '2026-07-09', to: '2026-10-05' });
  assert.deepEqual(statementPeriod(undefined, undefined, []), { from: null, to: null });
});

// ---------------------------------------------------------------------------
// The statement's arithmetic

const TXS: SerializedTransaction[] = newestFirst([
  mt940({ day: '2026-09-25', amount: -50 }),
  mt940({ day: '2026-09-28', amount: 2000 }),
  mt940({ day: '2026-09-30', amount: -850 }),
  mt940({ day: '2026-10-02', amount: -20 }),
]);
// 1000 − 50 + 2000 − 850 − 20 = 2080
const BLOCKS = [
  block({ open: 2100, openDay: '2026-09-30', close: 2080, closeDay: '2026-10-02', count: 1 }),
  block({ open: 1000, openDay: '2026-09-24', close: 2100, closeDay: '2026-09-30', count: 3 }),
];

test('both ends from the bank, squared by the bookings', () => {
  const l = statementLedger({ txs: TXS, closing: { balance: 2080, date: mt940Date('2026-10-03') }, blocks: BLOCKS, currency: 'EUR' });
  assert.equal(l.mixed, false);
  assert.deepEqual(l.opening, { amount: 1000, date: '2026-09-24', source: 'bank' });
  assert.deepEqual(l.closing, { amount: 2080, date: '2026-10-03', source: 'bank' });
  assert.deepEqual(l.credits, { count: 1, sum: 2000 });
  assert.deepEqual(l.debits, { count: 3, sum: -920 });
  assert.equal(l.outstanding, null);
  assert.equal(l.difference, null);
});

test('a forward-dated booking the closing balance does not contain is printed apart', () => {
  // Fetched on Saturday the 3rd: Monday's card payment is listed, Saturday's balance lacks it.
  const txs = [...TXS, mt940({ day: '2026-10-05', valueDay: '2026-10-03', amount: -64.18 })];
  const l = statementLedger({ txs, closing: { balance: 2080, date: mt940Date('2026-10-03') }, blocks: BLOCKS, currency: 'EUR' });
  assert.deepEqual(l.opening, { amount: 1000, date: '2026-09-24', source: 'bank' });
  assert.deepEqual(l.debits, { count: 3, sum: -920 });
  assert.deepEqual(l.outstanding, { count: 1, sum: -64.18, firstDay: '2026-10-05' });
  assert.equal(l.difference, null);
  // The arithmetic printed above the line still holds.
  assert.equal(Math.round((l.opening!.amount + l.credits.sum + l.debits.sum) * 100), Math.round(l.closing!.amount * 100));
});

test('a bank whose balance already contains the forward-dated booking needs no split', () => {
  const txs = [...TXS, mt940({ day: '2026-10-05', amount: -64.18 })];
  const l = statementLedger({ txs, closing: { balance: 2015.82, date: mt940Date('2026-10-05') }, blocks: BLOCKS, currency: 'EUR' });
  assert.equal(l.outstanding, null);
  assert.equal(l.difference, null);
  assert.deepEqual(l.debits, { count: 4, sum: -984.18 });
});

test('bank figures the bookings cannot square are printed as they are, with the difference', () => {
  const l = statementLedger({ txs: TXS, closing: { balance: 2080.1, date: mt940Date('2026-10-03') }, blocks: BLOCKS, currency: 'EUR' });
  assert.deepEqual(l.opening, { amount: 1000, date: '2026-09-24', source: 'bank' });
  assert.deepEqual(l.closing, { amount: 2080.1, date: '2026-10-03', source: 'bank' });
  assert.equal(l.difference, 0.1);
  assert.equal(l.outstanding, null);
});

test('a gap next to a forward-dated booking is measured against the closer reading', () => {
  const txs = [...TXS, mt940({ day: '2026-10-05', amount: -64.18 })];
  const l = statementLedger({ txs, closing: { balance: 2080.1, date: mt940Date('2026-10-03') }, blocks: BLOCKS, currency: 'EUR' });
  assert.deepEqual(l.outstanding, { count: 1, sum: -64.18, firstDay: '2026-10-05' });
  assert.equal(l.difference, 0.1);
  // Opening + counted bookings + difference is the closing, to the cent.
  const sum = l.opening!.amount + l.credits.sum + l.debits.sum + (l.difference ?? 0);
  assert.equal(Math.round(sum * 100), Math.round(l.closing!.amount * 100));
});

test('without the bank\'s opening balance the old balance is worked out — and says so', () => {
  const l = statementLedger({ txs: TXS, closing: { balance: 2080, date: mt940Date('2026-10-03') }, blocks: [], currency: 'EUR' });
  assert.deepEqual(l.opening, { amount: 1000, date: null, source: 'derived' });
  assert.equal(l.closing?.source, 'bank');
  const noOpen = statementLedger({
    txs: TXS,
    closing: { balance: 2080, date: mt940Date('2026-10-03') },
    blocks: [block({ open: null, openDay: null, close: 2080, closeDay: '2026-10-02', count: 4 })],
    currency: 'EUR',
  });
  assert.equal(noOpen.opening?.source, 'derived');
});

test('worked out from a dated balance, bookings dated after it are set apart', () => {
  const txs = [...TXS, mt940({ day: '2026-10-05', amount: -64.18 })];
  const l = statementLedger({ txs, closing: { balance: 2080, date: mt940Date('2026-10-03') }, blocks: null, currency: 'EUR' });
  assert.deepEqual(l.opening, { amount: 1000, date: null, source: 'derived' });
  assert.deepEqual(l.outstanding, { count: 1, sum: -64.18, firstDay: '2026-10-05' });
  assert.deepEqual(l.debits, { count: 3, sum: -920 });
});

test('without a closing balance it is worked out from the bank\'s opening', () => {
  const l = statementLedger({ txs: TXS, closing: null, blocks: BLOCKS, currency: 'EUR' });
  assert.deepEqual(l.opening, { amount: 1000, date: '2026-09-24', source: 'bank' });
  assert.deepEqual(l.closing, { amount: 2080, date: null, source: 'derived' });
});

test('with neither end there is nothing to work out', () => {
  const l = statementLedger({ txs: TXS, closing: null, blocks: null, currency: 'EUR' });
  assert.equal(l.opening, null);
  assert.equal(l.closing, null);
  assert.deepEqual(l.credits, { count: 1, sum: 2000 });
});

test('the oldest opening wins, whichever order the blocks came in', () => {
  const sameDay = [
    block({ open: 1950, openDay: '2026-09-24', close: 2100, closeDay: '2026-09-30', count: 2 }),
    block({ open: 1000, openDay: '2026-09-24', close: 1950, closeDay: '2026-09-25', count: 1 }),
  ];
  const l = statementLedger({ txs: TXS.slice(0, 0), closing: null, blocks: sameDay, currency: 'EUR' });
  assert.equal(l.opening?.amount, 1000);
});

test('an empty period still prints both balances', () => {
  const l = statementLedger({
    txs: [],
    closing: { balance: 1250, date: mt940Date('2026-10-03') },
    blocks: [block({ open: 1250, openDay: '2026-07-05', close: 1250, closeDay: '2026-10-03', count: 0 })],
    currency: 'EUR',
  });
  assert.deepEqual(l.opening, { amount: 1250, date: '2026-07-05', source: 'bank' });
  assert.deepEqual(l.credits, { count: 0, sum: 0 });
});

test('bookings in another currency are never added up', () => {
  const txs = [...TXS, { ...mt940({ day: '2026-09-29', amount: -10 }), currency: 'USD' }];
  const l = statementLedger({ txs, closing: { balance: 2080, date: mt940Date('2026-10-03') }, blocks: BLOCKS, currency: 'EUR' });
  assert.equal(l.mixed, true);
  assert.equal(l.opening, null);
  assert.equal(l.closing?.amount, 2080);
});

test('sums are exact to the cent', () => {
  const txs = [mt940({ day: '2026-09-01', amount: 0.1 }), mt940({ day: '2026-09-02', amount: 0.2 })];
  const l = statementLedger({ txs, closing: { balance: 0.3, date: mt940Date('2026-09-02') }, blocks: [], currency: 'EUR' });
  assert.equal(l.credits.sum, 0.3);
  assert.equal(l.opening?.amount, 0);
});

// ---------------------------------------------------------------------------
// Figures

test('bookings carry both signs, balances only the minus, and zero carries none', () => {
  assert.equal(fmtMovement(3184.27), '+3.184,27');
  assert.equal(fmtMovement(-1090), '−1.090,00');
  assert.equal(fmtMovement(-0.001), '0,00');
  assert.equal(fmtBalance(-137.42), '−137,42');
  assert.equal(fmtBalance(1777.78), '1.777,78');
  assert.equal(fmtBalance(-0), '0,00');
});

test('statement numbers run in booking order, not text order', () => {
  assert.equal(statementNumberRange([{ statementNumber: '1225/001' }, { statementNumber: '0126/001' }]), '1225/001 – 0126/001');
  assert.equal(statementNumberRange([{ statementNumber: '00009/001' }, { statementNumber: '00009/001' }]), '00009/001');
  assert.equal(statementNumberRange([{ statementNumber: '' }]), null);
  assert.equal(statementNumberRange([]), null);
});

// ---------------------------------------------------------------------------

test('page-margin text is a safe CSS string', () => {
  assert.equal(cssString('Kontoauszug · SK-1'), '"Kontoauszug · SK-1"');
  assert.equal(cssString('a"b\\c\nd'), '"a\\"b\\\\c d"');
});
