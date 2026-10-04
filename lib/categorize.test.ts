import './__fixtures__/tz.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SerializedTransaction } from './fints-types';
import { counterpartyKey, txKey } from './categories.ts';
import {
  bookingKind, bookingKindLabel, categorize, foldText, guessCategory, isBusinessCredit, isOwnAccount, keywordCategory,
} from './categorize.ts';
import { CRED, IBAN, OWN_GIRO, OWN_IBANS, OWN_SAVINGS, camt, mt940 } from './__fixtures__/transactions.ts';

const auto = (tx: SerializedTransaction, merchantLabel?: string) =>
  categorize(tx, { ownIbans: OWN_IBANS, merchantLabel }).id;

test('foldText spells umlauts out and flattens punctuation', () => {
  assert.equal(foldText('Müller-Lüdenscheidt Straße 5'), 'MUELLER LUEDENSCHEIDT STRASSE 5');
  assert.equal(foldText('Café Größenwahn'), 'CAFE GROESSENWAHN');
  assert.equal(foldText('APPLE.COM/BILL'), 'APPLE COM BILL');
  assert.equal(foldText('  '), '');
  assert.equal(foldText(null), '');
});

test('isOwnAccount accepts arrays, sets and spaced IBANs', () => {
  assert.ok(isOwnAccount('DE02 1203 0000 0000 2020 51', OWN_IBANS));
  assert.ok(isOwnAccount(OWN_SAVINGS, new Set(OWN_IBANS)));
  assert.ok(isOwnAccount('de02120300000000202051', new Set(['DE02 1203 0000 0000 2020 51'])));
  assert.ok(!isOwnAccount(IBAN.person, OWN_IBANS));
  assert.ok(!isOwnAccount('', OWN_IBANS));
  assert.ok(!isOwnAccount(OWN_GIRO, undefined));
});

test('bookingKind reads MT940 Geschäftsvorfallcodes', () => {
  const k = (gvc: string, text: string, amount: number) => bookingKind(mt940({ day: '2026-09-01', amount, gvc, text }));
  assert.equal(k('105', 'BASISLASTSCHRIFT', -12.99), 'lastschrift');
  assert.equal(k('005', 'LASTSCHRIFT', -20), 'lastschrift');
  assert.equal(k('106', 'KARTENZAHLUNG', -45.1), 'karte');
  assert.equal(k('106', '', -45.1), 'karte');
  assert.equal(k('166', 'GUTSCHRIFT', 100), 'gutschrift');
  assert.equal(k('116', 'ONLINE-UEBERWEISUNG', -100), 'ueberweisung');
  assert.equal(k('117', 'DAUERAUFTRAG', -850), 'dauerauftrag');
  assert.equal(k('152', 'DAUERAUFTRAGSGUTSCHRIFT', 850), 'gutschrift');
  assert.equal(k('153', 'LOHN, GEHALT, RENTE', 2650), 'gehalt');
  assert.equal(k('153', '', 2650), 'gehalt');
  assert.equal(k('083', 'BARGELDAUSZAHLUNG', -200), 'bargeld');
  assert.equal(k('083', '', -200), 'bargeld');
  assert.equal(k('805', 'ABSCHLUSS', -7.95), 'entgelt');
  assert.equal(k('805', 'ABSCHLUSS', 0.12), 'zinsen');
  assert.equal(k('805', '', -7.95), 'entgelt');
  assert.equal(k('808', 'ENTGELTABSCHLUSS', -4.5), 'entgelt');
  assert.equal(k('116', 'ECHTZEIT-UEBERWEISUNG', -50), 'echtzeit');
  assert.equal(k('166', 'ECHTZEIT-GUTSCHRIFT', 50), 'echtzeit');
  assert.equal(k('109', 'RUECKLASTSCHRIFT', 12.99), 'ruecklastschrift');
  assert.equal(k('105', 'KARTENZAHLUNG ONLINE', -9), 'karte', "the bank's specific label beats a generic code");
  // A credit-only code cannot describe a debit; the text decides then.
  assert.equal(k('166', 'UEBERWEISUNG', -5), 'ueberweisung');
  assert.equal(k('999', 'ZINSEN', 3.21), 'zinsen');
  assert.equal(k('999', 'FINANZINSTITUT XY', -3), 'sonstige', '"Finanzinstitut" is not interest');
  assert.equal(k('', '', 10), 'gutschrift');
  assert.equal(k('', '', -10), 'sonstige');
});

test('bookingKind reads CAMT ISO sub-family codes', () => {
  const k = (code: string, text: string, amount: number) => bookingKind(camt({ day: '2026-09-01', amount, code, text }));
  assert.equal(k('ESDD', 'SEPA-Basislastschrift', -12.99), 'lastschrift');
  assert.equal(k('BBDD', 'SEPA-Firmenlastschrift', -300), 'lastschrift');
  assert.equal(k('ESDD', '', 12.99), 'gutschrift');
  assert.equal(k('ESCT', 'SEPA-Überweisung', -100), 'ueberweisung');
  assert.equal(k('ESCT', 'SEPA-Gutschrift', 100), 'gutschrift');
  assert.equal(k('SALA', 'Gutschrift', 2650), 'gehalt');
  assert.equal(k('PENS', '', 1400), 'gehalt');
  assert.equal(k('CWDL', 'Auszahlung', -100), 'bargeld');
  assert.equal(k('POSD', 'Kartenzahlung girocard', -23.4), 'karte');
  assert.equal(k('CCRD', '', -23.4), 'karte');
  assert.equal(k('STDO', 'Dauerauftrag', -850), 'dauerauftrag');
  assert.equal(k('STDO', '', 850), 'gutschrift');
  assert.equal(k('FEES', 'Kontoführung', -4.95), 'entgelt');
  assert.equal(k('INTR', '', 0.42), 'zinsen');
  assert.equal(k('UPDD', '', 12.99), 'ruecklastschrift');
  assert.equal(k('RRTN', '', 100), 'gutschrift');
  assert.equal(k('PMNT-RCDT-ESCT', '', 100), 'gutschrift', 'a full domain-family-subfamily code');
  assert.equal(k('OTHR', '', -1), 'sonstige');
});

test('bookingKindLabel has words for every kind', () => {
  assert.equal(bookingKindLabel('lastschrift'), 'Lastschrift');
  assert.equal(bookingKindLabel('karte'), 'Kartenzahlung');
  assert.equal(bookingKindLabel('echtzeit'), 'Echtzeitüberweisung');
  assert.equal(bookingKindLabel('ruecklastschrift'), 'Rücklastschrift');
  assert.equal(bookingKindLabel('ueberweisung'), 'Überweisung');
  assert.equal(bookingKindLabel('sonstige'), 'Buchung');
});

test('the ladder: manual beats rule beats own account beats everything automatic', () => {
  const tx = mt940({
    day: '2026-09-15', amount: -850, gvc: '117', text: 'DAUERAUFTRAG', name: 'Hausverwaltung Kramer',
    iban: IBAN.landlord, purpose: 'Miete September',
  });
  assert.deepEqual(categorize(tx, { ownIbans: OWN_IBANS }), { id: 'housing', source: 'auto' });
  const rules = { [counterpartyKey(tx)]: 'savings' as const };
  assert.deepEqual(categorize(tx, { ownIbans: OWN_IBANS, rules }), { id: 'savings', source: 'rule' });
  const overrides = { [txKey(tx)]: 'leisure' as const };
  assert.deepEqual(categorize(tx, { ownIbans: OWN_IBANS, rules, overrides }), { id: 'leisure', source: 'manual' });
  // A stored value that is no category (an old vault) is ignored, not trusted.
  const broken = { [txKey(tx)]: 'nope' } as unknown as Record<string, 'other'>;
  assert.deepEqual(categorize(tx, { ownIbans: OWN_IBANS, overrides: broken }), { id: 'housing', source: 'auto' });

  const toSavings = mt940({ day: '2026-09-15', amount: -200, gvc: '116', text: 'UEBERWEISUNG', name: 'Nino', iban: OWN_SAVINGS, purpose: 'Miete Rücklage' });
  assert.equal(auto(toSavings), 'transfer', 'own IBAN beats the keyword in the text');
  assert.equal(categorize(toSavings, { ownIbans: new Set(OWN_IBANS) }).id, 'transfer');
  assert.equal(categorize(toSavings, { ownIbans: OWN_IBANS, rules: { [counterpartyKey(toSavings)]: 'savings' } }).id, 'savings');
});

test('booking codes decide salary, cash and fees before any keyword', () => {
  assert.equal(auto(mt940({ day: '2026-09-30', amount: 2650, gvc: '153', text: 'LOHN/GEHALT', name: 'REWE Markt GmbH', iban: IBAN.employer })), 'income',
    'a REWE employee is paid salary, not refunded groceries');
  assert.equal(auto(camt({ day: '2026-09-30', amount: 2650, code: 'SALA', name: 'ACME GmbH' })), 'income');
  assert.equal(auto(mt940({ day: '2026-09-12', amount: -200, gvc: '083', text: 'BARGELDAUSZAHLUNG', name: 'GA NR00001234 BLZ12030000' })), 'cash');
  assert.equal(auto(camt({ day: '2026-09-12', amount: -100, code: 'CWDL', text: 'Bargeldauszahlung' })), 'cash');
  assert.equal(auto(mt940({ day: '2026-09-30', amount: -7.95, gvc: '805', text: 'ABSCHLUSS' })), 'fees');
  assert.equal(auto(camt({ day: '2026-09-30', amount: 0.42, code: 'INTR', text: 'Zinsen' })), 'fees');
  assert.equal(auto(mt940({ day: '2026-09-30', amount: -50, gvc: '116', text: 'UMBUCHUNG', name: 'Nino Muster', iban: 'DE12345678901234567890' })), 'transfer');
});

test('German merchants by name, MT940 card payments', () => {
  const card = (name: string, amount = -23.45) => auto(mt940({ day: '2026-09-12', amount, gvc: '106', text: 'KARTENZAHLUNG', name }));
  assert.equal(card('REWE SAGT DANKE. 46511234//BERLIN/DE'), 'groceries');
  assert.equal(card('EDEKA CENTER 1234'), 'groceries');
  assert.equal(card('ALDI SUED SAGT DANKE'), 'groceries');
  assert.equal(card('LIDL DIENSTLEISTUNG'), 'groceries');
  assert.equal(card('NETTO MARKEN-DISCOUNT'), 'groceries');
  assert.equal(card('DM-DROGERIE MARKT SAGT DANKE'), 'groceries');
  assert.equal(card('ROSSMANN 2241'), 'groceries');
  assert.equal(card('MUELLER 0815 MUENCHEN'), 'groceries', 'Müller the drugstore on a card terminal');
  assert.equal(card('ARAL STATION 4711'), 'mobility');
  assert.equal(card('SHELL 1234 BERLIN'), 'mobility');
  assert.equal(card('JET TANKSTELLE 12'), 'mobility');
  assert.equal(card('TOTAL SERVICE STATION'), 'mobility');
  assert.equal(card('IKEA DEUTSCHLAND'), 'shopping');
  assert.equal(card('H&M HENNES & MAURITZ'), 'shopping');
  assert.equal(card('MEDIAMARKT BERLIN'), 'shopping');
  assert.equal(card('STARBUCKS COFFEE'), 'leisure');
  assert.equal(card("MCDONALD'S 1234"), 'leisure');
  assert.equal(card('BURGER KING 4401'), 'leisure');
  assert.equal(card('RESTAURANT ZUM LOEWEN'), 'leisure');
  assert.equal(card('CAFÉ EINSTEIN'), 'leisure');
  assert.equal(card('LÖWEN-APOTHEKE'), 'health');
  assert.equal(card('FIELMANN AG'), 'health');
  assert.equal(card('UBER *TRIP'), 'mobility');
  assert.equal(card('UBER EATS'), 'leisure', 'the longer phrase wins');
});

test('German direct debits and transfers, both wire shapes', () => {
  assert.equal(auto(mt940({ day: '2026-09-01', amount: -12.99, gvc: '105', text: 'BASISLASTSCHRIFT', name: 'Netflix International B.V.', iban: IBAN.netflix, cred: CRED.netflix })), 'media');
  assert.equal(auto(camt({ day: '2026-09-01', amount: -9.99, code: 'ESDD', text: 'SEPA-Basislastschrift', name: 'Spotify AB', purpose: 'Spotify Premium' })), 'media');
  assert.equal(auto(camt({ day: '2026-09-01', amount: -39.99, code: 'ESDD', name: 'Telekom Deutschland GmbH' })), 'media');
  assert.equal(auto(camt({ day: '2026-09-01', amount: -19.99, code: 'ESDD', name: '1&1 Telecom GmbH' })), 'media');
  assert.equal(auto(camt({ day: '2026-09-01', amount: -7.99, code: 'ESDD', name: 'ALDI TALK' })), 'media', 'ALDI TALK is a phone plan, not groceries');
  assert.equal(auto(mt940({ day: '2026-09-01', amount: -98, gvc: '105', text: 'BASISLASTSCHRIFT', name: 'STADTWERKE MUENCHEN GMBH', cred: CRED.stadtwerke })), 'housing');
  assert.equal(auto(camt({ day: '2026-09-01', amount: -76, code: 'ESDD', name: 'MVV Energie AG' })), 'housing', 'MVV Energie, not the Munich transit MVV');
  assert.equal(auto(camt({ day: '2026-09-01', amount: -63, code: 'ESDD', name: 'MVV Muenchner Verkehrs- und Tarifverbund' })), 'mobility');
  assert.equal(auto(camt({ day: '2026-09-01', amount: -55, code: 'ESDD', name: 'E.ON Energie Deutschland GmbH' })), 'housing');
  assert.equal(auto(mt940({ day: '2026-09-01', amount: -18.36, gvc: '105', text: 'BASISLASTSCHRIFT', name: 'RUNDFUNK ARD, ZDF, DRADIO' })), 'taxes');
  assert.equal(auto(camt({ day: '2026-09-01', amount: -120, code: 'ESDD', name: 'Finanzamt Muenchen' })), 'taxes');
  assert.equal(auto(camt({ day: '2026-09-01', amount: -120, code: 'ESDD', name: 'Bundeskasse Trier', purpose: 'Kfz-Steuer M-AB 1234' })), 'taxes');
  assert.equal(auto(camt({ day: '2026-09-01', amount: -45.6, code: 'ESDD', name: 'HUK-COBURG' })), 'insurance');
  assert.equal(auto(camt({ day: '2026-09-01', amount: -45.6, code: 'ESDD', name: 'R+V Allgemeine Versicherung AG' })), 'insurance');
  assert.equal(auto(camt({ day: '2026-09-01', amount: -210, code: 'ESDD', name: 'Techniker Krankenkasse' })), 'insurance');
  assert.equal(auto(camt({ day: '2026-09-01', amount: -100, code: 'ESDD', name: 'Trade Republic Bank GmbH', purpose: 'Sparplan' })), 'savings');
  assert.equal(auto(camt({ day: '2026-09-01', amount: -50, code: 'ESDD', name: 'Bausparkasse Schwäbisch Hall' })), 'savings');
  assert.equal(auto(camt({ day: '2026-09-01', amount: -35, code: 'ESDD', name: 'DB Vertrieb GmbH' })), 'mobility');
  assert.equal(auto(camt({ day: '2026-09-01', amount: -49, code: 'ESDD', name: 'Deutsche Bahn AG', purpose: 'Deutschlandticket' })), 'mobility');
  assert.equal(auto(camt({ day: '2026-09-01', amount: -24.9, code: 'ESDD', name: 'ADAC e.V.' })), 'mobility');
  assert.equal(auto(camt({ day: '2026-09-01', amount: -29.99, code: 'ESDD', name: 'McFIT GmbH' })), 'leisure');
});

test('the remittance text counts for debits, and only the name for credits', () => {
  const person = (amount: number, purpose: string) =>
    auto(mt940({ day: '2026-09-01', amount, gvc: amount < 0 ? '116' : '166', text: amount < 0 ? 'UEBERWEISUNG' : 'GUTSCHRIFT', name: 'Max Mustermann', iban: IBAN.person, purpose }));
  assert.equal(person(-850, 'Miete Oktober Whg 3'), 'housing');
  assert.equal(person(-850, 'Kaltmiete 10/2026'), 'housing');
  assert.equal(person(850, 'Miete Oktober Whg 3'), 'otherIn', "a tenant's rent is not the user's housing cost");
  assert.equal(person(-30, 'Zahnarzt Rechnung 4711'), 'health');
  assert.equal(person(-20, 'Kino und Pizza'), 'leisure');
  assert.equal(person(-500, 'Gehalt Oktober Kinderbetreuung'), 'other', 'paying a wage is not income');
  assert.equal(person(2500, 'Gehalt Oktober'), 'income');
  assert.equal(person(250, 'Kindergeld'), 'income');
  assert.equal(person(-5, 'Danke!'), 'other');
  assert.equal(person(5, 'Danke!'), 'otherIn');
  // A merchant's own credit is a refund and lands in its category.
  assert.equal(auto(camt({ day: '2026-09-03', amount: 39.9, code: 'ESCT', name: 'AMAZON EU S.A R.L., NIEDERLASSUNG DEUTSCHLAND', purpose: 'Erstattung 302-1234567' })), 'shopping');
  assert.equal(auto(camt({ day: '2026-09-03', amount: 312, code: 'ESCT', name: 'Finanzamt Muenchen', purpose: 'Erstattung ESt 2025' })), 'taxes');
  assert.equal(auto(camt({ day: '2026-09-03', amount: 1400, code: 'ESCT', name: 'Deutsche Rentenversicherung Bund' })), 'income');
});

test('people who share a name with a shop stay people', () => {
  const transfer = (name: string) => auto(mt940({ day: '2026-09-01', amount: -40, gvc: '116', text: 'UEBERWEISUNG', name, iban: IBAN.person, purpose: 'Geschenk' }));
  assert.equal(transfer('Hans Mueller'), 'other');
  assert.equal(transfer('MUELLER, HANS'), 'other');
  assert.equal(transfer('Otto Schmidt'), 'other');
  assert.equal(transfer('Norma Becker'), 'other');
  assert.equal(transfer('Zara Klein'), 'other');
  assert.equal(auto(camt({ day: '2026-09-01', amount: -89, code: 'ESDD', name: 'Otto GmbH & Co KG' })), 'shopping');
});

test('payment wrappers: the shop behind them wins, the wrapper is the fallback', () => {
  const pp = (purpose: string, label?: string) =>
    auto(mt940({ day: '2026-09-01', amount: -12.99, gvc: '105', text: 'BASISLASTSCHRIFT', name: 'PayPal Europe S.a.r.l. et Cie S.C.A', iban: IBAN.paypal, cred: CRED.paypal, purpose }), label);
  assert.equal(pp('PP.8126.PP . Netflix International B.V., Ihr Einkauf bei Netflix International B.V.'), 'media');
  assert.equal(pp('PP.8126.PP . Kaufland, Ihr Einkauf bei Kaufland'), 'groceries');
  assert.equal(pp('PP.8126.PP . ABC Handels UG, Ihr Einkauf bei ABC Handels UG'), 'shopping');
  assert.equal(pp('', 'Netflix'), 'media', 'the resolved merchant outranks the wrapper');
  assert.equal(pp('', 'PayPal'), 'shopping');
});

test('specific phrases beat the umbrella brand', () => {
  const amazon = (purpose: string) => auto(camt({ day: '2026-09-01', amount: -8.99, code: 'ESDD', name: 'AMAZON EU S.A R.L.', purpose }));
  assert.equal(amazon('Amazon Prime Mitgliedschaft'), 'media');
  assert.equal(amazon('Prime Video Channels'), 'media');
  assert.equal(amazon('302-1234567-1234567 Amazon.de'), 'shopping');
  assert.equal(auto(camt({ day: '2026-09-01', amount: -2.99, code: 'POSD', name: 'APPLE.COM/BILL' })), 'media');
});

test('run-together MT940 tags still yield the readable text', () => {
  const tx = mt940({
    day: '2026-09-01', amount: -18.36, gvc: '105', text: 'BASISLASTSCHRIFT', name: 'BEITRAGSSERVICE',
    rawTags: true, eref: 'RF123', mref: 'M-1', cred: 'DE70ZZZ00000000001', purpose: 'Rundfunk 10.2026 - 12.2026 Beitragsnr. 123456789',
  });
  assert.match(tx.purpose, /^EREF\+RF123MREF\+M-1CRED\+DE70ZZZ00000000001SVWZ\+/);
  assert.equal(auto(tx), 'taxes');
});

test('keywordCategory is null when nothing is known', () => {
  assert.equal(keywordCategory(mt940({ day: '2026-09-01', amount: -12, name: 'Erika Musterfrau', purpose: 'Danke' })), null);
  assert.equal(keywordCategory(mt940({ day: '2026-09-01', amount: -12 })), null);
});

test('guessCategory ignores the user\'s rules and keeps the auto ladder', () => {
  const tx = camt({ day: '2026-09-01', amount: -60, code: 'POSD', name: 'REWE Markt GmbH' });
  assert.equal(guessCategory(tx), 'groceries');
  assert.equal(guessCategory(camt({ day: '2026-09-01', amount: -60, code: 'ESCT', iban: OWN_GIRO })), 'other');
  assert.equal(guessCategory(camt({ day: '2026-09-01', amount: -60, code: 'ESCT', iban: OWN_GIRO }), { ownIbans: OWN_IBANS }), 'transfer');
});

test('fallback: credits are Sonstige Eingänge, debits Sonstiges', () => {
  assert.equal(auto(camt({ day: '2026-09-01', amount: 17, code: 'ESCT', name: 'Erika Musterfrau' })), 'otherIn');
  assert.equal(auto(camt({ day: '2026-09-01', amount: -17, code: 'ESCT', name: 'Erika Musterfrau' })), 'other');
  assert.equal(auto(camt({ day: '2026-09-01', amount: 0, code: '' })), 'other');
});

test('a Visa Debit purchase via the Sparkassen card processor is a card payment, not a bank fee', async () => {
  const { guessCategory, bookingKind } = await import('./categorize.ts');
  const base = {
    valueDate: '2026-08-18T00:00:00.000Z', entryDate: '2026-08-18T00:00:00.000Z', currency: 'EUR',
    remoteName: 'Landesbank Hessen-Thüringen', remoteIban: 'DE41500500000001234567', remoteBic: 'HELADEFFXXX',
    e2eReference: '', mandateReference: '', customerReference: 'NONREF', bankReference: '',
    transactionCode: '', primeNotesNr: '', textKeyExtension: '', additionalInformation: '', statementNumber: '',
    bookingText: '',
  };
  const purchases = [
    { ...base, amount: -10.99, purpose: '2026-08-18T10:12 Debitk.0 2030-12 Einsatzentgelt 1,00 EUR Zahl.System VISA Debit' },
    { ...base, amount: -9.51, purpose: '2026-08-31T09:01 Debitk.0 2030-12 Original 9,85 USD 1 Euro=1,1563 USD Einsatzentgelt 0,15 EUR Zahl.System VISA Debit' },
    { ...base, amount: -25.97, purpose: '2026-08-05T18:40 Debitk.0 2030-12 Einsatzentgelt 1,00 EUR Teillieferung(Final) Zahl.System VISA Debit' },
  ];
  for (const tx of purchases) {
    assert.equal(bookingKind(tx), 'karte');
    assert.notEqual(guessCategory(tx), 'fees');
  }
  // A fee the bank books on its own is still a fee, even when it names the card.
  const fee = { ...base, amount: -1.75, bookingText: 'ENTGELT', purpose: 'Auslandseinsatzentgelt Debitk.0 2030-12' };
  assert.equal(guessCategory(fee), 'fees');
});

test('isBusinessCredit: refunds, creditors, payment services and spending categories are never sent back', () => {
  // A person paying the user back: the one credit "Zurücküberweisen" is for.
  const friend = mt940({ day: '2026-09-12', amount: 25, gvc: '166', text: 'GUTSCHRIFT', name: 'Max Mustermann', iban: IBAN.person, purpose: 'Pizza Freitag' });
  assert.equal(isBusinessCredit(friend, 'otherIn'), false, '"Gutschrift" as the booking text is just money coming in');
  assert.equal(isBusinessCredit(friend), false);
  // The Amazon return refund of the critique.
  const amazon = mt940({
    day: '2026-09-20', amount: 34.99, gvc: '166', text: 'GUTSCHRIFT', name: 'AMAZON PAYMENTS EUROPE S.C.A.',
    iban: 'DE87300308801908262006', purpose: '302-8841923-5521307 ERSTATTUNG AMAZON.DE RUECKSENDUNG',
  });
  assert.equal(isBusinessCredit(amazon), true);
  for (const purpose of ['Rückerstattung Bestellung 4711', 'Retoure 12345', 'Gutschrift aus Reklamation', 'Refund order 99', 'Storno Rechnung 7']) {
    assert.equal(isBusinessCredit({ ...friend, purpose }), true, purpose);
  }
  assert.equal(isBusinessCredit({ ...friend, bookingText: 'ERSTATTUNG' }), true);
  // A creditor's money back (a utility's Guthaben) and a payment service.
  assert.equal(isBusinessCredit(mt940({ day: '2026-09-02', amount: 41.2, gvc: '166', text: 'GUTSCHRIFT', name: 'Stadtwerke', iban: IBAN.stadtwerke, cred: CRED.stadtwerke, purpose: 'Abrechnung 2025' })), true);
  assert.equal(isBusinessCredit({ ...friend, name: '', remoteName: 'PAYPAL EUROPE S.A.R.L. ET CIE S.C.A', purpose: 'Auszahlung' } as SerializedTransaction), true);
  // Filed under a spending category (a shop's refund) or as an Umbuchung.
  assert.equal(isBusinessCredit(friend, 'shopping'), true);
  assert.equal(isBusinessCredit(friend, 'transfer'), true);
});
