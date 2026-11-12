import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SerializedTransaction } from './fints-types';
import { de, en } from './i18n/messages/ask.ts';
import { explainBooking, explainLines, explainPurpose, isExplainQuestion } from './ask-explain.ts';

const tx = (over: Partial<SerializedTransaction> = {}): SerializedTransaction => ({
  valueDate: '2026-10-02T10:00:00.000Z',
  entryDate: '2026-10-02T10:00:00.000Z',
  amount: -25,
  currency: 'EUR',
  purpose: '',
  bookingText: '',
  remoteName: '',
  remoteIban: '',
  remoteBic: '',
  e2eReference: '',
  mandateReference: '',
  customerReference: '',
  bankReference: '',
  transactionCode: '',
  primeNotesNr: '',
  textKeyExtension: '',
  additionalInformation: '',
  statementNumber: '',
  ...over,
});

const NETFLIX = tx({
  amount: -13.99,
  bookingText: 'FOLGELASTSCHRIFT',
  remoteName: 'NETFLIX INTERNATIONAL B.V.',
  purpose: 'EREF+NF-88123MREF+M-0042CRED+NL98ZZZ123456780000SVWZ+NETFLIX MITGLIEDSCHAFT OKTOBER',
});

const CARD = tx({
  amount: -42.17,
  bookingText: 'KARTENZAHLUNG',
  remoteName: 'REWE SAGT DANKE//KOELN/DE',
  purpose: '2026-10-12T18:22 Debitk.0 2030-12 Zahl.System VISA Debit',
});

const RENT = tx({
  amount: -850,
  bookingText: 'ONLINE-UEBERWEISUNG',
  remoteName: 'LEA HOFFMANN',
  purpose: 'SVWZ+Miete November',
});

const NADINE = tx({
  amount: 586.75,
  bookingText: 'GUTSCHRIFT UEBERWEISUNG',
  transactionCode: '166',
  remoteName: 'NADINE MILLEVILLE',
  purpose: 'Danke fuer die Tickets',
});

test('a SEPA direct debit: who collected it, its purpose, its mandate and creditor ID', () => {
  const e = explainBooking(NETFLIX, { name: 'Netflix' });
  assert.equal(e.kind, 'lastschrift');
  assert.equal(e.directDebit, true);
  assert.equal(e.mandate, 'M-0042');
  assert.equal(e.creditorId, 'NL98ZZZ123456780000');
  assert.equal(e.purpose, 'Netflix Mitgliedschaft Oktober');
  assert.deepEqual(explainLines(e, de.explain), [
    'Netflix hat das per SEPA-Lastschrift abgebucht.',
    'Verwendungszweck: „Netflix Mitgliedschaft Oktober“',
    'Girovo kennt das noch nicht als Vertrag oder Abo.',
  ]);
});

test('a booking a contract holds says its rhythm instead', () => {
  const e = explainBooking(NETFLIX, { name: 'Netflix', contract: { cadence: 'monatlich' } });
  assert.equal(explainLines(e, de.explain)[2], 'Kommt monatlich, steht bei deinen Verträgen & Abos.');
  const en1 = explainLines(explainBooking(NETFLIX, { name: 'Netflix', contract: { cadence: 'monthly' } }), en.explain);
  assert.deepEqual(en1, [
    'Netflix collected this by SEPA direct debit.',
    'Payment reference: “Netflix Mitgliedschaft Oktober”',
    'Comes monthly, listed in your contracts & subscriptions.',
  ]);
});

test('a card payment: the shop, no terminal record, nothing about contracts', () => {
  const e = explainBooking(CARD, { name: 'Rewe' });
  assert.equal(e.kind, 'karte');
  assert.equal(e.purpose, '');
  assert.equal(e.directDebit, false);
  assert.deepEqual(explainLines(e, de.explain), ['Eine Kartenzahlung bei Rewe.']);
  assert.deepEqual(explainLines({ ...e, credit: true }, de.explain), ['Eine Erstattung von Rewe auf deine Karte.']);
});

test('a transfer out and one in: to whom or from whom, and what it was for', () => {
  assert.deepEqual(explainLines(explainBooking(RENT, { name: 'Lea Hoffmann' }), de.explain), [
    'Eine Überweisung an Lea Hoffmann.',
    'Verwendungszweck: „Miete November“',
  ]);
  const inn = explainBooking(NADINE, { name: 'Nadine Milleville' });
  assert.equal(inn.credit, true);
  // Money in by transfer is a Gutschrift, as the bank names it.
  assert.deepEqual(explainLines(inn, de.explain), [
    'Eine Gutschrift von Nadine Milleville.',
    'Verwendungszweck: „Danke fuer die Tickets“',
  ]);
});

test('a purpose that only repeats the name or the booking text is left out', () => {
  assert.equal(explainPurpose(tx({ purpose: 'LEA HOFFMANN' }), 'Lea Hoffmann', 'ueberweisung'), '');
  assert.equal(explainPurpose(tx({ purpose: 'Dauerauftrag', bookingText: 'DAUERAUFTRAG' }), 'Lea', 'dauerauftrag'), '');
  assert.equal(explainPurpose(tx({ purpose: 'Miete Dezember.' }), 'Lea', 'dauerauftrag'), 'Miete Dezember');
});

test('a booking the text leaves open, with a mandate and a creditor ID, is a direct debit', () => {
  const e = explainBooking(tx({ mandateReference: 'ABC-1', creditorId: 'DE98ZZZ09999999999', remoteName: 'STADTWERKE' }), { name: 'Stadtwerke' });
  assert.equal(e.kind, 'lastschrift');
  assert.equal(e.directDebit, true);
  assert.equal(explainLines(e, de.explain)[0], 'Stadtwerke hat das per SEPA-Lastschrift abgebucht.');
});

test('"NOTPROVIDED" is no mandate; a Lastschrift without one is a plain Lastschrift', () => {
  const e = explainBooking(tx({ bookingText: 'LASTSCHRIFT', mandateReference: 'NOTPROVIDED' }), { name: 'Telekom' });
  assert.equal(e.mandate, '');
  assert.equal(e.directDebit, false);
  assert.equal(explainLines(e, de.explain)[0], 'Telekom hat das per Lastschrift abgebucht.');
});

test('the lines carry no dashes', () => {
  for (const words of [de.explain, en.explain]) {
    for (const t of [NETFLIX, CARD, RENT, NADINE]) {
      for (const line of explainLines(explainBooking(t, { name: 'X', contract: { cadence: 'monatlich' } }), words)) {
        assert.doesNotMatch(line, /[–—]| - /);
      }
    }
  }
});

test('the explain question is recognised in both languages, and only about the booking in front of you', () => {
  for (const q of [
    de.explain.question, en.explain.question, 'Was ist diese Abbuchung?', 'Was ist das hier für eine Buchung?',
    'Erklär mir diesen Umsatz', 'Wer steckt hinter dieser Lastschrift?', "What's this charge?", 'Explain this transaction',
  ]) assert.equal(isExplainQuestion(q), true, q);
  for (const q of [
    'Was ist die größte Abbuchung?', 'Was ging dieses Jahr an Amazon Payments?', 'Wie oft zahle ich bei Netflix?',
    'Was kam dieses Jahr von Nadine Milleville?', 'Lebensmittel letzten Monat', 'What was my largest payment?',
    // A period between the pointing word and the booking word: about all of that period's bookings.
    'Wer hat mir diesen Monat Überweisungen geschickt?', 'Was waren diese Woche Abbuchungen?', 'Who sent me this week deposits?',
    'Was kam dieses Jahr an Gutschriften?', 'What were this month payments?',
  ]) assert.equal(isExplainQuestion(q), false, q);
  assert.equal(isExplainQuestion('What is this weird charge?'), true);
});
