import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SerializedTransaction } from './fints-types';
import { txKey } from './categories.ts';
import { compactBooking, sanitizeBooking } from './history.ts';
import { purposePlace, reservedAmount, withPartyFromPurpose } from './purpose-party.ts';

// Targobank's camt, as the bookings showed it (numbers changed).
function tb(bookingText: string, amount: number, ...purpose: string[]): SerializedTransaction {
  return {
    valueDate: '2026-11-12T00:00:00.000Z', entryDate: '2026-11-12T00:00:00.000Z', bankDay: '2026-11-12',
    amount, currency: 'EUR', purpose: purpose.join('\n'), bookingText,
    remoteName: '', remoteIban: '', remoteBic: '', creditorId: '', ultimateName: '',
    e2eReference: '', mandateReference: '', customerReference: '', bankReference: 'B1', transactionCode: '',
    primeNotesNr: '', textKeyExtension: '', additionalInformation: '', statementNumber: '',
  };
}

const LASTSCHRIFT = tb('SEPA Lastschrift', -52.5,
  'SEPA LASTSCHRIFT', 'PayPal Europe S.a.r.l. et Cie S.C.A',
  '1053918153621/PP.1405.PP/. ZOEVA GmbH, Ihr Einkauf bei', 'ZOEVA GmbH',
  'Kundenreferenz: 1053918153621', 'Gläubiger-ID : LU96ZZZ0000000000000000058', 'Mandat: 5TWJ2252J7QQE',
  'IBAN: LU89751000135104200E');

test('a direct debit: the payee, the IBAN and the references move to their fields', () => {
  const t = withPartyFromPurpose(LASTSCHRIFT);
  assert.equal(t.remoteName, 'PayPal Europe S.a.r.l. et Cie S.C.A');
  assert.equal(t.remoteIban, 'LU89751000135104200E');
  assert.equal(t.creditorId, 'LU96ZZZ0000000000000000058');
  assert.equal(t.mandateReference, '5TWJ2252J7QQE');
  assert.equal(t.customerReference, '1053918153621');
  assert.equal(t.purpose, '1053918153621/PP.1405.PP/. ZOEVA GmbH, Ihr Einkauf bei\nZOEVA GmbH');
  assert.equal(t.fromPurpose, 'purpose customerReference creditorId mandateReference remoteIban remoteName');
});

test('a credit: the payer after the booking text', () => {
  const t = withPartyFromPurpose(tb('Gutschrift', 259, 'GUTSCHRIFT', 'Bundesagentur für Arbeit - Familienkasse',
    'KG527006FK978520 1126 115012743624/3000164059286', 'KundenRef: 115012743624'));
  assert.equal(t.remoteName, 'Bundesagentur für Arbeit - Familienkasse');
  assert.equal(t.customerReference, '115012743624');
  assert.equal(t.purpose, 'KG527006FK978520 1126 115012743624/3000164059286');
});

test('an instant transfer from online banking: the channel code is not the payee', () => {
  const t = withPartyFromPurpose(tb('Echtzeitüberweisung Inland', -75, 'ECHTZEITÜBERWEISUNG INLAND', 'TBOL', 'NINO BORNEMANN',
    'DEUTSCHLANDTICKET', 'IBAN DE02120300000000202051 BIC BYLADEM1001', 'AM 03.11.2026 UM 15.48.36'));
  assert.equal(t.remoteName, 'NINO BORNEMANN');
  assert.equal(t.remoteIban, 'DE02120300000000202051');
  assert.equal(t.remoteBic, 'BYLADEM1001');
  assert.equal(t.purpose, 'DEUTSCHLANDTICKET\nAM 03.11.2026 UM 15.48.36\nTBOL');
  const order = withPartyFromPurpose(tb('Dauerauftrag', -900, 'DAUERAUFTRAG', 'TBOL', 'Max Vermieter', 'Miete'));
  assert.equal(order.remoteName, 'Max Vermieter');
});

test('a short name in capitals is a payee, not a channel', () => {
  const t = withPartyFromPurpose(tb('Überweisung', -100, 'ÜBERWEISUNG', 'ADAC', 'Mitgliedsbeitrag 2026'));
  assert.equal(t.remoteName, 'ADAC');
  assert.equal(t.purpose, 'Mitgliedsbeitrag 2026');
});

test('no name where the lines hold none: a purpose first, a card bill, cash', () => {
  assert.equal(withPartyFromPurpose(tb('SEPA Lastschrift', -10, 'SEPA LASTSCHRIFT', 'Rechnung 4711 vom', 'Mandat: X1')).remoteName, '');
  assert.equal(withPartyFromPurpose(tb('Kreditkartenabrechnung', -80, 'KREDITKARTENABRECHNUNG', 'Abrechnung November')).remoteName, '');
  assert.equal(withPartyFromPurpose(tb('Bargeldauszahlung', -50, 'BARGELDAUSZAHLUNG', 'GA Urbar')).remoteName, '');
});

test('a card payment: the shop, and the town under it', () => {
  const t = withPartyFromPurpose(tb('NFC Kartenzahlung', -82.98, 'NFC KARTENZAHLUNG', 'OIL 120', '/Urbar', '// 74003818',
    'AM 10.11.2026 AUTORISIERUNGSNR. 693421', 'KARTENNUMMER 439556XXXXXX801X GÜLTIG BIS 08/27'));
  assert.equal(t.remoteName, 'OIL 120');
  assert.deepEqual(purposePlace(t), { city: 'Urbar', country: null });
  assert.equal(reservedAmount(t), null);
});

test('a reservation booked as 0,00: the shop after the card, the sum it holds', () => {
  const t = withPartyFromPurpose(tb('Reserv. Betrag POS', 0, 'RESERV. BETRAG POS', 'EUR', '78,01', 'AUTORISIERUNGSNR', '765455',
    'KARTENNUMMER(439556XXXXXX801X)', 'OIL 120', 'Urbar', 'DE'));
  assert.equal(t.remoteName, 'OIL 120');
  assert.deepEqual(purposePlace(t), { city: 'Urbar', country: 'DE' });
  assert.deepEqual(reservedAmount(t), { amount: -78.01, currency: 'EUR' });
  assert.deepEqual(reservedAmount({ ...t, amount: -78.01 }), null);
  // Another bank's 0,00 "Reservierung" with an amount in its lines is no card's hold.
  assert.equal(reservedAmount(tb('Reservierung Hotel', 0, 'Reservierung Hotel', 'EUR', '1.234,50')), null);
});

test('untouched: a named payee, SEPA tags, one line, no echo of the booking text, the bank\'s own bookings', () => {
  const named = { ...LASTSCHRIFT, remoteName: 'PayPal' };
  assert.equal(withPartyFromPurpose(named), named);
  const tagged = tb('SEPA Lastschrift', -1, 'SEPA LASTSCHRIFT', 'EREF+123 SVWZ+Miete');
  assert.equal(withPartyFromPurpose(tagged), tagged);
  const oneLine = tb('Gutschrift', 1, 'GUTSCHRIFT Max Mustermann');
  assert.equal(withPartyFromPurpose(oneLine), oneLine);
  const noEcho = tb('Gutschrift', 1, 'Max Mustermann', 'Danke');
  assert.equal(withPartyFromPurpose(noEcho), noEcho);
  const fee = withPartyFromPurpose(tb('Entgelt', -4.9, 'ENTGELT', 'Kontoführung November'));
  assert.equal(fee.remoteName, '');
  assert.equal(fee.purpose, 'Kontoführung November');
});

test('a field the bank filled keeps its value, and the line stays', () => {
  const t = withPartyFromPurpose({ ...LASTSCHRIFT, mandateReference: 'OTHER' });
  assert.equal(t.mandateReference, 'OTHER');
  assert.match(t.purpose, /Mandat: 5TWJ2252J7QQE/);
});

test('once only, the same from a fresh answer and from kept history, and the key stays', () => {
  const t = withPartyFromPurpose(LASTSCHRIFT);
  assert.equal(withPartyFromPurpose(t), t);
  assert.equal(txKey(t), txKey(LASTSCHRIFT));
  // Kept before this version: read out on load, like a fresh answer.
  const kept = sanitizeBooking(compactBooking(LASTSCHRIFT))!;
  assert.equal(kept.remoteName, t.remoteName);
  assert.equal(kept.fromPurpose, t.fromPurpose);
  // Kept after: loaded as it is.
  const again = sanitizeBooking(compactBooking(t))!;
  assert.equal(again.purpose, t.purpose);
  assert.equal(txKey(again), txKey(LASTSCHRIFT));
});
