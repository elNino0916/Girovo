import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardAmount, cardDay, cardStatements, readCardBooking } from './fints-cards.ts';

// Bookings as DIKKU carries them: one data group each, its fields split by
// ':' and escaped the FinTS way (hbci4java KreditkartenUmsatz).
const REWE = '4930123412341234:20261002:20261001:RF-1:12,34:EUR:D::12,34:EUR:D:REWE MARKT GMBH:BERLIN:::::::J';
const FOREIGN = '4930123412341234:20261005:20261003::12,99:USD:D:1,0923:11,89:EUR:D:AMAZON?:US MKTPL:SEATTLE:::::::N';
const REFUND = '4930123412341234:2026-10-07:2026-10-06::5,00:EUR:C::5,00:EUR:C:Gutschrift ZALANDO::::::::J';

test('cardDay: yyyymmdd and yyyy-mm-dd as the local day, nothing else', () => {
  assert.deepEqual(cardDay('20261002'), new Date(2026, 9, 2));
  assert.deepEqual(cardDay('2026-10-02'), new Date(2026, 9, 2));
  assert.equal(cardDay('20261302'), null);
  assert.equal(cardDay('2.10.2026'), null);
  assert.equal(cardDay(undefined), null);
});

test('cardAmount: German and plain figures, signed by C/D whatever sign they carry', () => {
  assert.equal(cardAmount('1.234,56', 'D'), -1234.56);
  assert.equal(cardAmount('12,34', 'C'), 12.34);
  assert.equal(cardAmount('-12,34', 'D'), -12.34);
  assert.equal(cardAmount('-12,34', 'C'), 12.34);
  assert.equal(cardAmount('12.34', undefined), 12.34);
  assert.equal(cardAmount('-7,50', ''), -7.5);
  assert.equal(cardAmount('', 'D'), null);
  assert.equal(cardAmount('zwölf', 'D'), null);
});

test('a booking: dates, the signed amount, the shop and its place', () => {
  const b = readCardBooking(REWE);
  assert.ok(b);
  assert.deepEqual(b.bookingDate, new Date(2026, 9, 2));
  assert.deepEqual(b.valueDate, new Date(2026, 9, 1));
  assert.equal(b.amount, -12.34);
  assert.equal(b.currency, 'EUR');
  assert.equal(b.shop, 'REWE MARKT GMBH');
  assert.equal(b.location, 'BERLIN');
  assert.equal(b.reference, 'RF-1');
  // Paid in euros: nothing to say about another currency.
  assert.equal(b.original, null);
});

test('an escaped colon stays in the shop; a payment abroad keeps what it was there', () => {
  const b = readCardBooking(FOREIGN);
  assert.ok(b);
  assert.equal(b.shop, 'AMAZON:US MKTPL');
  assert.equal(b.location, 'SEATTLE');
  assert.equal(b.amount, -11.89);
  assert.deepEqual(b.original, { amount: -12.99, currency: 'USD', rate: 1.0923 });
});

test('a refund is a credit, and ISO dates read as well', () => {
  const b = readCardBooking(REFUND);
  assert.ok(b);
  assert.equal(b.amount, 5);
  assert.deepEqual(b.bookingDate, new Date(2026, 9, 7));
});

test('a booking without a date or an amount is not read', () => {
  assert.equal(readCardBooking('4930123412341234::20261001::::::::EUR:D:SHOP'), null);
  assert.equal(readCardBooking('4930123412341234:20261002:20261001:::::::EUR:D:SHOP'), null);
  assert.equal(readCardBooking(''), null);
});

test('the answer as one statement: the card balance closes it, the opening is marked invented', () => {
  const balanceDate = new Date(Date.UTC(2026, 9, 8));
  const { statements, unread } = cardStatements([
    {
      header: { segId: 'DIKKU', segNr: 4, version: 2 },
      accountNumber: '4930123412341234',
      balance: { creditDebit: 'D', amount: { value: 153.64, currency: 'EUR' }, date: balanceDate },
      transactions: [REWE, FOREIGN],
    },
    // The rest of a long list, in a second message.
    { header: { segId: 'DIKKU', segNr: 4, version: 2 }, transactions: [REFUND, 'garbage'] },
  ]);
  assert.equal(unread, 1);
  assert.equal(statements.length, 1);
  const [st] = statements;
  assert.equal(st.transactions.length, 3);
  assert.equal(st.closingBalance.value, -153.64);
  assert.equal(st.closingBalance.currency, 'EUR');
  // Never a figure the Kontoverlauf could check the bookings against: 0 on
  // the closing day, which lib/serialize.ts statementBlocks reads as invented.
  assert.notEqual(st.openingBalance, st.closingBalance);
  assert.equal(st.openingBalance.value, 0);
  assert.deepEqual(st.openingBalance.date, st.closingBalance.date);

  const amazon = st.transactions.find((t) => t.remoteName === 'AMAZON:US MKTPL');
  assert.ok(amazon);
  assert.equal(amazon.amount, -11.89);
  assert.equal(amazon.bookingText, 'Kreditkartenumsatz');
  assert.equal(amazon.purpose, 'SEATTLE · 12,99 USD, Kurs 1,0923');
  assert.deepEqual(amazon.entryDate, new Date(2026, 9, 5));
  assert.equal(st.transactions.find((t) => t.remoteName === 'REWE MARKT GMBH')?.purpose, 'BERLIN');
});

test('no DIKKU at all: no statement, and nothing that reads as a balance', () => {
  assert.deepEqual(cardStatements([]), { statements: [], unread: 0 });
  const { statements } = cardStatements([{ header: { segId: 'DIKKU', segNr: 3, version: 2 }, transactions: [REWE] }]);
  assert.equal(statements[0].transactions.length, 1);
  // Without a balance there is none to show (lib/serialize.ts balanceFromStatements needs its date).
  assert.equal(statements[0].closingBalance, undefined);
});
