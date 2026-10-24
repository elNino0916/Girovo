import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readInvoiceText, readSomething } from './invoice-text.ts';

// Valid IBANs: the Bundesbank's documented example and a well-known test one.
const IBAN = 'DE89370400440532013000';
const IBAN_2 = 'DE02120300000000202051';

const STADTWERKE = [
  'Stadtwerke Musterstadt GmbH',
  'Hauptstraße 1 · 12345 Musterstadt',
  'Rechnung',
  'Rechnungsnummer: 2026-104417',
  'Kundennummer: 778812',
  'Rechnungsdatum 20.10.2026',
  'Strom Oktober 70,76 €',
  'Nettobetrag 70,76 €',
  'zzgl. 19 % MwSt 13,44 €',
  'Rechnungsbetrag 84,20 €',
  'Bitte überweisen Sie den Betrag bis zum 03.11.2026 auf unser Konto',
  'IBAN DE89 3704 0044 0532 0130 00 · BIC COBADEFFXXX',
].join('\n');

test('reads IBAN, amount, invoice number and the letterhead from a typical invoice', () => {
  const r = readInvoiceText(STADTWERKE);
  assert.equal(r.iban, IBAN);
  assert.equal(r.amount, 84.2);
  assert.equal(r.purpose, 'Rechnung 2026-104417 Kd.-Nr. 778812');
  assert.equal(r.name, 'Stadtwerke Musterstadt GmbH');
  assert.equal(r.debit, false);
  assert.ok(readSomething(r));
});

test('says on which line it found each value, blank lines counted', () => {
  const r = readInvoiceText(STADTWERKE.replace('Rechnung\n', '\nRechnung\n'));
  assert.deepEqual(r.at, { iban: 12, amount: 10, purpose: 4, name: 0 });
});

test('takes a spelled-out Verwendungszweck as it is', () => {
  const r = readInvoiceText(`Firma Beispiel AG\nVerwendungszweck: RE 4711 / KD 0815\nZu zahlen: 1.234,56 EUR\nIBAN: ${IBAN}`);
  assert.equal(r.purpose, 'RE 4711 / KD 0815');
  assert.equal(r.amount, 1234.56);
});

test('repairs the common misreadings of a digit, and only keeps an IBAN whose check digits hold', () => {
  assert.equal(readInvoiceText('IBAN DE89 37O4 OO44 O532 O13O OO').iban, IBAN);
  assert.equal(readInvoiceText('IBAN DE89 3704 0044 0532 0130 01').iban, null);
});

test('an IBAN printed across two lines is joined', () => {
  assert.equal(readInvoiceText('Bankverbindung: DE89 3704 0044\n0532 0130 00').iban, IBAN);
});

test('never takes the reader’s own IBAN, by the text or by the list of own accounts', () => {
  const debit = `Der Betrag wird per SEPA-Lastschrift von Ihrem Konto ${IBAN_2} abgebucht.\nGesamtbetrag 12,99 €`;
  const r = readInvoiceText(debit);
  assert.equal(r.iban, null);
  assert.equal(r.debit, true);
  assert.equal(r.amount, 12.99);
  assert.equal(readInvoiceText(`IBAN ${IBAN}`, [IBAN]).iban, null);
});

test('two different IBANs in the same kind of place are no answer', () => {
  assert.equal(readInvoiceText(`IBAN ${IBAN}\nIBAN ${IBAN_2}`).iban, null);
});

test('the amount comes from the line that names it, never a net or tax line', () => {
  assert.equal(readInvoiceText('Nettobetrag 70,76 €\nMwSt 13,44 €').amount, null);
  assert.equal(readInvoiceText('Zwischensumme 50,00 €\nGesamt 59,50 €').amount, 59.5);
  // The label over a table column: the figure on the next line.
  assert.equal(readInvoiceText('Rechnungsbetrag\n€ 1.020,00').amount, 1020);
  // "Zu zahlen" outranks the gross total.
  assert.equal(readInvoiceText('Gesamtbetrag 100,00 €\nbereits bezahlt 40,00 €\nZu zahlen 60,00 €').amount, 60);
  // A total that says what tax it includes is still the total; dates and percentages are no amounts.
  assert.equal(readInvoiceText('Gesamtbetrag inkl. 19 % MwSt. 84,20 € fällig am 03.11.2026').amount, 84.2);
});

test('a mention of Lastschrift as an option does not make the invoice a debit', () => {
  assert.equal(readInvoiceText('Sie können auch per Überweisung zahlen. Lastschrift auf Wunsch möglich.').debit, false);
  assert.equal(readInvoiceText('Wir buchen den Betrag am 05.11. von Ihrem Konto ab.').debit, true);
});

test('a name from a label wins over the letterhead', () => {
  const r = readInvoiceText(`Muster Service GmbH\nKontoinhaber: Max Mustermann e.K.\nIBAN ${IBAN}`);
  assert.equal(r.name, 'Max Mustermann e.K.');
});

test('empty or unrelated text finds nothing', () => {
  const r = readInvoiceText('Vielen Dank für Ihren Einkauf!');
  assert.equal(readSomething(r), false);
  assert.equal(readSomething(readInvoiceText('')), false);
});
