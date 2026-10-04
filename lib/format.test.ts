import './__fixtures__/tz.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addBusinessDays, addDaysKey, dayKey, dayNumber, displayName, easterSunday, expectedCreditDate, fmtAmountInput,
  fmtDayHeader, fmtMonth, fmtRange, fmtShortIban, fmtSignedDecimal, fmtSignedMoney, initials, isTargetBusinessDay,
  nextTargetBusinessDay, parseAmount, presetRange, prettyBookingText, prettyPurpose, splitMoney, toLocalDate,
} from './format.ts';
import { mt940Date } from './__fixtures__/transactions.ts';

const MINUS = '−';
const day = (d: Date | null) => (d ? dayKey(d) : null);

test('splitMoney sets a negative balance with a real minus, everything else unchanged', () => {
  assert.deepEqual(splitMoney(-1234.56), { euros: `${MINUS}1.234`, cents: ',56', suffix: '€' });
  assert.deepEqual(splitMoney(1234.56), { euros: '1.234', cents: ',56', suffix: '€' });
  assert.deepEqual(splitMoney(0), { euros: '0', cents: ',00', suffix: '€' });
  assert.deepEqual(splitMoney(null), { euros: '0', cents: ',00', suffix: '€' });
  assert.deepEqual(splitMoney(-0.5), { euros: `${MINUS}0`, cents: ',50', suffix: '€' });
  assert.ok(!splitMoney(-7).euros.includes('-'), 'no hyphen-minus left');
});

test('the printed statement helpers keep their output', () => {
  // Statement.tsx prints with these, not splitMoney — they must not move.
  assert.equal(fmtSignedDecimal(-6.11), `${MINUS}6,11`);
  assert.equal(fmtSignedDecimal(128.4), '128,40');
  assert.equal(fmtSignedMoney(-1000), `${MINUS}1.000,00 €`);
});

test('parseAmount reads German input and what people paste', () => {
  const cases: [string, number | null][] = [
    ['1.000,50', 1000.5],
    ['1000.5', 1000.5],
    ['12,99 €', 12.99],
    ['12,99€', 12.99],
    [`${MINUS}49,90`, -49.9],
    ['-49.90', -49.9],
    ['–49,90', -49.9],
    ['+12,50', 12.5],
    ['49,90-', -49.9],
    ['1.000', 1000],
    ['12.500', 12500],
    ['1.000.000,00', 1000000],
    ['1,000.50', 1000.5],
    ['1 000,50', 1000.5],
    ['1 000,50 EUR', 1000.5],
    ['0,5', 0.5],
    [',50', 0.5],
    ['12,', 12],
    ['7', 7],
    ['-0', 0],
    // Ambiguous or broken: refused, never guessed.
    ['1,000', null],
    ['12,999', null],
    ['0.500', null],
    ['12.5.3', null],
    ['1.00,5', null],
    ['abc', null],
    ['', null],
    ['€', null],
    ['--5', null],
    ['1-2', null],
  ];
  for (const [input, want] of cases) assert.equal(parseAmount(input), want, `parseAmount(${JSON.stringify(input)})`);
  assert.equal(parseAmount(null), null);
  assert.equal(Object.is(parseAmount('-0'), -0), false, 'no negative zero');
});

test('fmtAmountInput writes what parseAmount reads back', () => {
  assert.equal(fmtAmountInput(1000), '1.000,00');
  assert.equal(fmtAmountInput(12.5), '12,50');
  assert.equal(fmtAmountInput(0), '0,00');
  assert.equal(fmtAmountInput(Number.NaN), '');
  assert.equal(fmtAmountInput(null), '');
  for (const n of [0.01, 12.99, 1000, 123456.78]) assert.equal(parseAmount(fmtAmountInput(n)), n);
});

test('fmtShortIban keeps the tail whole, on the full IBAN grid', () => {
  assert.deepEqual(fmtShortIban('DE78 1234 5678 9012 5932 71'), { head: 'DE78 ···', tail: '5932 71' });
  assert.deepEqual(fmtShortIban('de78123456789012593271'), { head: 'DE78 ···', tail: '5932 71' });
  // 20 characters (AT): the last six straddle a group boundary differently.
  assert.deepEqual(fmtShortIban('AT611904300234573201'), { head: 'AT61 ···', tail: '57 3201' });
  assert.deepEqual(fmtShortIban('1234567'), { head: '', tail: '1234 567' });
  assert.deepEqual(fmtShortIban(''), { head: '', tail: '' });
  assert.deepEqual(fmtShortIban(null), { head: '', tail: '' });
});

test('displayName re-cases ALL CAPS names and leaves the rest alone', () => {
  assert.equal(displayName('DB VERTRIEB GMBH'), 'DB Vertrieb GmbH');
  assert.equal(displayName('STADTWERKE MUENCHEN GMBH'), 'Stadtwerke Muenchen GmbH');
  assert.equal(displayName('MAX MUSTERMANN'), 'Max Mustermann');
  assert.equal(displayName('ULF-TORSTEN MUELLER'), 'Ulf-Torsten Mueller');
  assert.equal(displayName('REWE SAGT DANKE 46511234'), 'REWE Sagt Danke 46511234');
  assert.equal(displayName('1&1 TELECOM GMBH'), '1&1 Telecom GmbH');
  assert.equal(displayName('R+V ALLGEMEINE VERSICHERUNG AG'), 'R+V Allgemeine Versicherung AG');
  assert.equal(displayName('HUK-COBURG'), 'HUK-Coburg');
  assert.equal(displayName('E.ON ENERGIE DEUTSCHLAND'), 'E.ON Energie Deutschland');
  assert.equal(displayName('MUSTER GMBH & CO. KG'), 'Muster GmbH & Co. KG');
  assert.equal(displayName('PAYPAL (EUROPE) S.A R.L. ET CIE, S.C.A.'), 'PayPal (Europe) S.à r.l. et Cie, S.C.A.');
  assert.equal(displayName('STADTWERKE VON DER HEIDE'), 'Stadtwerke von der Heide');
  assert.equal(displayName('ST. MARTIN APOTHEKE'), 'St. Martin Apotheke');
  assert.equal(displayName('BVG'), 'BVG');
  assert.equal(displayName('DM-DROGERIE MARKT'), 'DM-Drogerie Markt');
  assert.equal(displayName('PAYPAL EUROPE DE'), 'PayPal Europe DE');
  assert.equal(displayName('GRÜNE ERDE'), 'Grüne Erde');
  // Mixed case is the company's own spelling.
  assert.equal(displayName('PayPal Europe S.a.r.l.'), 'PayPal Europe S.a.r.l.');
  assert.equal(displayName('dm-drogerie markt'), 'dm-drogerie markt');
  assert.equal(displayName('  12345  '), '12345');
  assert.equal(displayName(null), '');
});

test('displayName re-cases joined parts one by one, legal forms canonically, Mc names with their capital', () => {
  // Hyphen- and slash-joined parts are words of their own.
  assert.equal(displayName('REWE MARKT GMBH-ZWNL'), 'REWE Markt GmbH-Zwnl');
  assert.equal(displayName('STADTWERKE MUSTERSTADT/NETZ GMBH'), 'Stadtwerke Musterstadt/Netz GmbH');
  assert.equal(displayName('MAX MUSTERMANN/ERIKA MUSTERFRAU'), 'Max Mustermann/Erika Musterfrau');
  // Legal forms in their own spelling.
  assert.equal(displayName('VOLKSBANK MUSTERSTADT EG'), 'Volksbank Musterstadt eG');
  assert.equal(displayName('ALLIANZ VERSICHERUNGS-AG'), 'Allianz Versicherungs-AG');
  assert.equal(displayName('ZALANDO SE'), 'Zalando SE');
  assert.equal(displayName('MUSTER KG'), 'Muster KG');
  assert.equal(displayName('TSV MUSTERSTADT 1860 E.V.'), 'TSV Musterstadt 1860 e.V.');
  assert.equal(displayName('TSV MUSTERSTADT 1860 EV'), 'TSV Musterstadt 1860 eV');
  assert.equal(displayName('NETFLIX INTERNATIONAL B.V.'), 'Netflix International B.V.');
  assert.equal(displayName('AMAZON PAYMENTS EUROPE S.A.'), 'Amazon Payments Europe S.A.');
  assert.equal(displayName('HAUSVERWALTUNG KRAEMER GMBH'), 'Hausverwaltung Kraemer GmbH');
  // Mc and Mac names.
  assert.equal(displayName('MCDONALDS 1182'), 'McDonalds 1182');
  assert.equal(displayName('MCFIT GMBH'), 'McFit GmbH');
  assert.equal(displayName("MCDONALD'S"), "McDonald's");
  assert.equal(displayName('MACDONALD BAKERY'), 'MacDonald Bakery');
  assert.equal(displayName('MACHER GMBH'), 'Macher GmbH', 'a German word, not a Gaelic name');
  // Short acronyms stay; mixed case is the bank's own and stays too.
  assert.equal(displayName('REWE ALDI DB BVG ADAC HUK AOK DKB ING'), 'REWE ALDI DB BVG ADAC HUK AOK DKB ING');
  assert.equal(displayName('dm-drogerie markt GmbH'), 'dm-drogerie markt GmbH');
  assert.equal(displayName('McDonalds Deutschland LLC'), 'McDonalds Deutschland LLC');
});

test('displayName spells PayPal and the S.à r.l. the way they are written', () => {
  assert.equal(displayName('PAYPAL'), 'PayPal');
  assert.equal(displayName('PAYPAL EUROPE S.A.R.L. ET CIE S.C.A'), 'PayPal Europe S.à r.l. et Cie S.C.A');
  assert.equal(displayName('PAYPAL EUROPE S.A.R.L ET CIE S.C.A.'), 'PayPal Europe S.à r.l. et Cie S.C.A.');
  assert.equal(displayName('PAYPAL *STEAM'), 'PayPal *Steam');
  assert.equal(displayName('PAYPAL/EBAY'), 'PayPal/Ebay');
  // A system's title-casing of the brand is fixed even in a mixed-case name…
  assert.equal(displayName('Paypal Europe S.a.r.l.'), 'PayPal Europe S.a.r.l.');
  assert.equal(displayName('Paypal *Steam'), 'PayPal *Steam');
  // …and nothing else in it is touched.
  assert.equal(displayName('PayPal Europe S.a.r.l. et Cie S.C.A'), 'PayPal Europe S.a.r.l. et Cie S.C.A');
  assert.equal(displayName('Paypalmuster GmbH'), 'Paypalmuster GmbH', 'only the whole word');
  assert.equal(displayName('HAUS SARL'), 'Haus SARL', 'the undotted form stays an acronym');
});

test('initials skip trailing legal forms and numbers', () => {
  assert.equal(initials('Hausverwaltung Kraemer GmbH'), 'HK');
  assert.equal(initials('Netflix International B.V.'), 'NI');
  assert.equal(initials('HAUSVERWALTUNG KRAEMER GMBH'), 'HK');
  assert.equal(initials('Muster GmbH & Co. KG'), 'M');
  assert.equal(initials('Beispiel Bau GmbH & Co. KG'), 'BB');
  assert.equal(initials('PAYPAL (EUROPE) S.A R.L. ET CIE, S.C.A.'), 'PE');
  assert.equal(initials('PayPal Europe S.a.r.l. et Cie S.C.A'), 'PE');
  // The display spelling of the same name, as the avatar gets it.
  assert.equal(initials(displayName('PAYPAL EUROPE S.A.R.L. ET CIE S.C.A')), 'PE');
  assert.equal(initials('Muster S.à r.l.'), 'M');
  assert.equal(initials('Amazon Payments Europe S.C.A.'), 'AE');
  assert.equal(initials('Volksbank Musterstadt eG'), 'VM');
  assert.equal(initials('TSV Musterstadt 1860 e.V.'), 'TM');
  assert.equal(initials('Google Ireland Limited'), 'GI');
  assert.equal(initials('Apple Distribution International Ltd'), 'AI');
  assert.equal(initials('Stripe Payments Europe Ltd.'), 'SE');
  assert.equal(initials('Spotify AB'), 'S');
  assert.equal(initials('Banco Santander S.A.'), 'BS');
  assert.equal(initials('Fiat Chrysler S.p.A.'), 'FC');
  assert.equal(initials('Shopify Commerce LLC'), 'SC');
  assert.equal(initials('Acme Inc.'), 'A');
  assert.equal(initials('Lloyds Bank plc'), 'LB');
  assert.equal(initials('Booking Holdings N.V.'), 'BH');
  assert.equal(initials('Taxi Berlin UG'), 'TB');
  assert.equal(initials('Müller OHG'), 'M');
  assert.equal(initials('Praxis Dr. Weber GbR'), 'PW');
  assert.equal(initials('Meier e.K.'), 'M');
  assert.equal(initials('Iberia S.L.'), 'I');
  assert.equal(initials('Haus SARL'), 'H');
  // A branch hyphenated onto the legal form goes with it.
  assert.equal(initials('REWE MARKT GMBH-ZWNL'), 'RM');
  assert.equal(initials('REWE Markt GmbH-Zwnl'), 'RM');
  assert.equal(initials('HUK-COBURG'), 'H');
  assert.equal(initials('Allianz Versicherungs-AG'), 'AV');
  // Numbers, as before.
  assert.equal(initials('REWE SAGT DANKE 46511234'), 'RD');
  assert.equal(initials('MCDONALDS 1182'), 'M');
  // A name that is nothing but a legal form still gets its letter.
  assert.equal(initials('GmbH'), 'G');
  assert.equal(initials('12345'), '•');
  assert.equal(initials(''), '•');
});

test('prettyPurpose re-cases an all-caps purpose and keeps every reference exactly', () => {
  assert.equal(prettyPurpose('LOHN/GEHALT 09/2026 PERSONALNR. 44821'), 'Lohn/Gehalt 09/2026 Personalnr. 44821');
  assert.equal(
    prettyPurpose('MIETE WHG 3.OG LINKS INKL. NEBENKOSTEN 10/2026'),
    'Miete WHG 3.OG Links inkl. Nebenkosten 10/2026',
  );
  assert.equal(prettyPurpose('UMBUCHUNG AUF GIROKONTO'), 'Umbuchung auf Girokonto');
  // Codes with digits in them are kept letter for letter.
  assert.equal(prettyPurpose('SPOTIFY P2C8F1A9D2 PREMIUM 10/2026'), 'Spotify P2C8F1A9D2 Premium 10/2026');
  assert.equal(prettyPurpose('302-1180443-9921776 AMAZON.DE BESTELLUNG'), '302-1180443-9921776 Amazon.de Bestellung');
  assert.equal(
    prettyPurpose('HAUSRAT + PRIVATHAFTPFLICHT VS-NR. AS-8841-2207 BEITRAG 11-01/2027'),
    'Hausrat + Privathaftpflicht VS-Nr. AS-8841-2207 Beitrag 11-01/2027',
  );
  assert.equal(prettyPurpose('KD-NR. 6113 4401 22 RG 10/2026 MOBILFUNK'), 'Kd-Nr. 6113 4401 22 RG 10/2026 Mobilfunk');
  // Short acronyms stay; known words get their umlauts back; the masked card
  // number and a trailing country are marks, not words.
  assert.equal(prettyPurpose('ABSCHLAG STROM/GAS VK 4021889120'), 'Abschlag Strom/Gas VK 4021889120');
  assert.equal(prettyPurpose('ERSTATTUNG SEPA-UEBERWEISUNG AN MAX MUSTERMANN'), 'Erstattung SEPA-Überweisung an Max Mustermann');
  assert.equal(
    prettyPurpose('KREDITKARTENABRECHNUNG VISA 4930 XXXX XXXX 1234 VOM 30.09.2026'),
    'Kreditkartenabrechnung Visa 4930 XXXX XXXX 1234 vom 30.09.2026',
  );
  assert.equal(prettyPurpose('ARAL TANKSTELLE//MUSTERSTADT/DE'), 'Aral Tankstelle//Musterstadt/DE');
  assert.equal(prettyPurpose('NETFLIX.COM MITGLIEDSCHAFT'), 'Netflix.com Mitgliedschaft');
  // The first word is capitalised even when it is one that is lowercase inside a sentence.
  assert.equal(prettyPurpose('INKL. MWST.'), 'Inkl. MwSt.');
  assert.equal(prettyPurpose('AUF WIEDERSEHEN'), 'Auf Wiedersehen');
});

test('prettyPurpose drops the PayPal reference block and leaves mixed case alone', () => {
  assert.equal(
    prettyPurpose('PP.5840.PP . Muster GmbH, Ihr Einkauf bei Muster GmbH'),
    'Muster GmbH, Ihr Einkauf bei Muster GmbH',
  );
  assert.equal(prettyPurpose('PP.5840.PP MUSTER GMBH IHR EINKAUF BEI MUSTER GMBH'), 'Muster GmbH Ihr Einkauf bei Muster GmbH');
  assert.equal(prettyPurpose('PP.12.PP.Shop'), 'Shop');
  assert.equal(prettyPurpose('Zinsen 07–09/2026 1,75 % p. a.'), 'Zinsen 07–09/2026 1,75 % p. a.');
  assert.equal(prettyPurpose('Taschengeld für ALLES'), 'Taschengeld für ALLES', "a person's own capitals stay");
  assert.equal(prettyPurpose('  12345 '), '12345');
  assert.equal(prettyPurpose(''), '');
  assert.equal(prettyPurpose(null), '');
});

test('prettyBookingText restores the words, part by part', () => {
  assert.equal(prettyBookingText('LOHN/GEHALT'), 'Lohn/Gehalt');
  assert.equal(prettyBookingText('LOHN'), 'Lohn');
  assert.equal(prettyBookingText('GEHALT'), 'Gehalt');
  assert.equal(prettyBookingText('MIETE'), 'Miete');
  assert.equal(prettyBookingText('RATE'), 'Rate');
  assert.equal(prettyBookingText('ZINS'), 'Zins');
  assert.equal(prettyBookingText('ZINSEN'), 'Zinsen');
  assert.equal(prettyBookingText('RENTE'), 'Rente');
  assert.equal(prettyBookingText('BEZUEGE'), 'Bezüge');
  assert.equal(prettyBookingText('RENTE/BEZUEGE'), 'Rente/Bezüge');
  assert.equal(prettyBookingText('SEPA-UEBERWEISUNG'), 'SEPA-Überweisung');
  assert.equal(prettyBookingText('SEPA LASTSCHRIFT'), 'SEPA Lastschrift');
  assert.equal(prettyBookingText('ONLINE-UEBERWEISUNG'), 'Online-Überweisung');
  assert.equal(prettyBookingText('KARTENZAHLUNG'), 'Kartenzahlung');
  assert.equal(prettyBookingText('POS'), 'POS');
  // The bank's own mixed case stays exactly as sent.
  assert.equal(prettyBookingText('Lohn/Gehalt'), 'Lohn/Gehalt');
  assert.equal(prettyBookingText(''), '');
  assert.equal(prettyBookingText(null), '');
});

test('dayKey buckets by the local day, never by the UTC string', () => {
  // MT940: 3 October, local midnight, is the 2nd in UTC.
  assert.equal(mt940Date('2026-10-03'), '2026-10-02T22:00:00.000Z');
  assert.equal(dayKey('2026-10-02T22:00:00.000Z'), '2026-10-03');
  // In winter the offset is one hour.
  assert.equal(dayKey('2026-01-14T23:00:00.000Z'), '2026-01-15');
  // Both DST switch days are whole days of their own.
  assert.equal(dayKey(mt940Date('2026-03-29')), '2026-03-29');
  assert.equal(dayKey(mt940Date('2026-03-30')), '2026-03-30');
  assert.equal(dayKey(mt940Date('2026-10-25')), '2026-10-25');
  assert.equal(dayKey(mt940Date('2026-10-26')), '2026-10-26');
  assert.equal(dayKey('2026-07-05'), '2026-07-05');
  assert.equal(dayKey(new Date(2026, 6, 5, 23, 59)), '2026-07-05');
  assert.equal(dayKey(''), '');
  assert.equal(dayKey(null), '');
  assert.equal(dayKey('not a date'), '');
});

test('day arithmetic is calendar arithmetic, across DST and leap days', () => {
  assert.equal(dayNumber('2026-03-30') - dayNumber('2026-03-28'), 2);
  assert.equal(dayNumber('2026-10-26') - dayNumber('2026-10-24'), 2);
  assert.equal(addDaysKey('2026-03-28', 1), '2026-03-29');
  assert.equal(addDaysKey('2026-03-29', 1), '2026-03-30');
  assert.equal(addDaysKey('2026-10-25', -1), '2026-10-24');
  assert.equal(addDaysKey('2028-02-28', 1), '2028-02-29');
  assert.equal(addDaysKey('2027-02-28', 1), '2027-03-01');
  assert.equal(addDaysKey('2026-12-31', 1), '2027-01-01');
  assert.ok(Number.isNaN(dayNumber('2026-1-1')));
});

test('toLocalDate reads a bare date as a local day', () => {
  const d = toLocalDate('2026-07-05')!;
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 6);
  assert.equal(d.getDate(), 5);
  assert.equal(d.getHours(), 0);
  assert.equal(toLocalDate('nope'), null);
  assert.equal(toLocalDate(undefined), null);
});

test('easterSunday follows the Gregorian computus', () => {
  const known: [number, string][] = [
    [2019, '2019-04-21'], [2024, '2024-03-31'], [2025, '2025-04-20'], [2026, '2026-04-05'],
    [2027, '2027-03-28'], [2038, '2038-04-25'], [2285, '2285-03-22'], [1818, '1818-03-22'], [1943, '1943-04-25'],
  ];
  for (const [year, want] of known) assert.equal(dayKey(easterSunday(year)), want, String(year));
});

test('TARGET2 business days: weekends and the six closing days, nothing regional', () => {
  const closed = ['2026-01-01', '2026-04-03', '2026-04-06', '2026-05-01', '2026-12-25', '2026-12-26', '2026-10-03', '2026-10-04'];
  for (const d of closed) assert.equal(isTargetBusinessDay(d), false, d);
  // Christmas Eve, New Year's Eve, Tag der Deutschen Einheit on a weekday,
  // Whit Monday: banks may close, SEPA settles.
  const open = ['2026-12-24', '2026-12-31', '2025-10-03', '2026-05-25', '2026-04-02', '2026-04-07'];
  for (const d of open) assert.equal(isTargetBusinessDay(d), true, d);
  assert.equal(isTargetBusinessDay('2027-03-26'), false, 'Good Friday 2027');
  assert.equal(isTargetBusinessDay('2027-03-29'), false, 'Easter Monday 2027');
});

test('nextTargetBusinessDay rolls forward over weekends and Easter', () => {
  assert.equal(day(nextTargetBusinessDay('2026-10-03')), '2026-10-05');
  assert.equal(day(nextTargetBusinessDay('2026-04-03')), '2026-04-07');
  assert.equal(day(nextTargetBusinessDay('2026-12-25')), '2026-12-28');
  assert.equal(day(nextTargetBusinessDay('2026-12-24')), '2026-12-24');
  assert.equal(day(nextTargetBusinessDay(mt940Date('2026-11-01'))), '2026-11-02');
  const d = nextTargetBusinessDay(new Date(2026, 9, 3, 18, 30));
  assert.equal(d.getHours(), 0, 'always local midnight');
});

test('addBusinessDays counts TARGET2 days, never the start day', () => {
  assert.equal(day(addBusinessDays('2026-10-02', 1)), '2026-10-05');
  assert.equal(day(addBusinessDays('2026-04-02', 1)), '2026-04-07');
  assert.equal(day(addBusinessDays('2026-10-05', -1)), '2026-10-02');
  assert.equal(day(addBusinessDays('2026-04-07', -1)), '2026-04-02');
  assert.equal(day(addBusinessDays('2026-10-03', 0)), '2026-10-05');
  assert.equal(day(addBusinessDays('2026-12-23', 3)), '2026-12-29');
});

test('expectedCreditDate: next business day, a late order counts as the next day, instant is now', () => {
  // The spec's example: a Saturday order is credited Monday.
  assert.equal(day(expectedCreditDate(new Date(2026, 9, 3, 10), false)), '2026-10-05');
  assert.equal(day(expectedCreditDate(new Date(2026, 9, 1, 10), false)), '2026-10-02');
  assert.equal(day(expectedCreditDate(new Date(2026, 9, 1, 16), false)), '2026-10-05');
  assert.equal(day(expectedCreditDate(new Date(2026, 9, 2, 16), false)), '2026-10-05');
  // Maundy Thursday afternoon: Friday and Monday are closed.
  assert.equal(day(expectedCreditDate(new Date(2026, 3, 2, 16), false)), '2026-04-07');
  const now = new Date(2026, 9, 3, 23, 15, 7);
  assert.equal(expectedCreditDate(now, true)!.getTime(), now.getTime());
  assert.equal(expectedCreditDate(new Date('nope'), false), null);
});

test('fmtDayHeader speaks in days relative to today', () => {
  const today = new Date(2026, 9, 3, 9, 0);
  assert.equal(fmtDayHeader('2026-10-03', today), 'Heute');
  assert.equal(fmtDayHeader(mt940Date('2026-10-03'), today), 'Heute', 'a UTC string of local midnight is still today');
  assert.equal(fmtDayHeader('2026-10-02', today), 'Gestern');
  assert.equal(fmtDayHeader('2026-10-04', today), 'Morgen');
  assert.equal(fmtDayHeader('2026-09-28', today), 'Montag, 28. September');
  assert.equal(fmtDayHeader('2026-10-05', today), 'Montag, 5. Oktober');
  assert.equal(fmtDayHeader('2025-09-28', today), '28. September 2025');
  assert.equal(fmtDayHeader(null, today), 'Ohne Datum');
  // Across the spring-forward night, yesterday is still yesterday.
  assert.equal(fmtDayHeader('2026-03-28', new Date(2026, 2, 29, 12)), 'Gestern');
});

test('fmtRange writes the shared year once', () => {
  assert.equal(fmtRange('2026-07-05', '2026-10-03'), '05.07.–03.10.2026');
  assert.equal(fmtRange('2025-10-03', '2026-10-03'), '03.10.2025–03.10.2026');
  assert.equal(fmtRange('2026-10-03', '2026-10-03'), '03.10.2026');
  assert.equal(fmtRange(mt940Date('2026-07-05'), new Date(2026, 9, 3)), '05.07.–03.10.2026');
  assert.equal(fmtRange('', '2026-10-03'), '');
});

test('fmtMonth names the month in German', () => {
  assert.equal(fmtMonth('2026-10'), 'Oktober 2026');
  assert.equal(fmtMonth('2026-03'), 'März 2026');
  assert.equal(fmtMonth('2026-03-29'), 'März 2026');
  assert.equal(fmtMonth('bogus'), '');
});

test('presetRange: rolling windows end today, calendar ones stop at today', () => {
  const today = new Date(2026, 9, 3, 14, 30);
  assert.deepEqual(presetRange('30d', today), { from: '2026-09-03', to: '2026-10-03' });
  assert.deepEqual(presetRange('90d', today), { from: '2026-07-05', to: '2026-10-03' });
  assert.deepEqual(presetRange('365d', today), { from: '2025-10-03', to: '2026-10-03' });
  assert.deepEqual(presetRange('thisMonth', today), { from: '2026-10-01', to: '2026-10-03' });
  assert.deepEqual(presetRange('lastMonth', today), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(presetRange('thisYear', today), { from: '2026-01-01', to: '2026-10-03' });
  assert.deepEqual(presetRange('lastMonth', new Date(2024, 2, 15)), { from: '2024-02-01', to: '2024-02-29' });
  assert.deepEqual(presetRange('lastMonth', new Date(2027, 0, 10)), { from: '2026-12-01', to: '2026-12-31' });
  // Over the spring-forward night the window is still 30 calendar days.
  assert.deepEqual(presetRange('30d', new Date(2026, 3, 10)), { from: '2026-03-11', to: '2026-04-10' });
});

test('repairs umlauts a SWIFT conversion turned into "A." — only when the word is certain', async () => {
  const { repairBankText, repairSwiftUmlauts } = await import('./format.ts');
  assert.equal(repairBankText('Landesbank Hessen-ThA.ringen'), 'Landesbank Hessen-Thüringen');
  assert.equal(repairSwiftUmlauts('LANDESBANK HESSEN-THA.RINGEN'), 'LANDESBANK HESSEN-THÜRINGEN');
  assert.equal(repairSwiftUmlauts('Hauptstraße'.replace('ß', 'A.')), 'Hauptstraße');
  assert.equal(repairSwiftUmlauts('A.rztekammer Nordrhein'), 'Ärztekammer Nordrhein');
  assert.equal(repairSwiftUmlauts('MA.nchen'), 'München');
  // Müller or Möller? Both are names — left exactly as sent.
  assert.equal(repairSwiftUmlauts('MA.ller'), 'MA.ller');
  // An initial is not a broken umlaut.
  assert.equal(repairSwiftUmlauts('Frank A.Meier'), 'Frank A.Meier');
  assert.equal(repairSwiftUmlauts('Kto. A.B. 123'), 'Kto. A.B. 123');
});

test('displayName writes a web address the way people do', async () => {
  const { displayName } = await import('./format.ts');
  assert.equal(displayName('TEMU.COM'), 'Temu.com');
  assert.equal(displayName('AMAZON.DE MARKETPLACE'), 'Amazon.de Marketplace');
  assert.equal(displayName('LIEFERANDO.DE'), 'Lieferando.de');
  assert.equal(displayName('G2A.COM LIMITED'), 'G2A.com Limited');
});

test('fmtBytes states a download size the way a dialog does', async () => {
  const { fmtBytes } = await import('./format.ts');
  assert.equal(fmtBytes(104_919_142), '105 MB');
  assert.equal(fmtBytes(4_200_000), '4,2 MB');
  assert.equal(fmtBytes(860_000), '860 kB');
  assert.equal(fmtBytes(512), '512 Byte');
  assert.equal(fmtBytes(1_500_000_000), '1,5 GB');
  // Progress: the total picks the unit, the figure goes without it.
  assert.equal(`${fmtBytes(47_300_000, { unitOf: 104_919_142, bare: true })} von ${fmtBytes(104_919_142)}`, '47 von 105 MB');
  assert.equal(fmtBytes(860_000, { unitOf: 104_919_142, bare: true }), '0,9');
  assert.equal(fmtBytes(-1), '');
  assert.equal(fmtBytes(Number.NaN), '');
});
