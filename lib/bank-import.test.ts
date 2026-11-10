import './__fixtures__/tz.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectFormat, importHistory, importSpan, matchAccount, parseCsvExport, readAmount, readDate } from './bank-import.ts';
import { transactionsToCsv } from './csv.ts';
import type { SerializedAccount, SerializedTransaction } from './fints-types';
import { bookingDay } from './history.ts';
import { withLocale } from './i18n/server.ts';

const SPARKASSE = [
  '"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Glaeubiger ID";"Mandatsreferenz";"Kundenreferenz (End-to-End)";"Sammlerreferenz";"Lastschrift Ursprungsbetrag";"Auslagenersatz Ruecklastschrift";"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"BIC (SWIFT-Code)";"Betrag";"Waehrung";"Info"',
  '"DE02120300000000202051";"30.12.24";"30.12.24";"FOLGELASTSCHRIFT";"Beitrag 12/2024";"DE98ZZZ09999999999";"M-77";"E2E-1";"";"";"";"Sportverein Musterstadt e.V.";"DE75512108001245126199";"SOLADES1XXX";"-15,00";"EUR";"Umsatz gebucht"',
  '"DE02120300000000202051";"02.01.25";"02.01.25";"GUTSCHRIFT";"Lohn/Gehalt 12/2024";"";"";"";"";"";"";"ACME GmbH";"DE89370400440532013000";"COBADEFFXXX";"2.650,00";"EUR";"Umsatz gebucht"',
  '"DE02120300000000202051";"03.01.25";"03.01.25";"KARTENZAHLUNG";"REWE";"";"";"";"";"";"";"REWE Markt";"";"";"-23,45";"EUR";"Umsatz vorgemerkt"',
].join('\r\n');

const ATRUVIA = [
  'Bezeichnung Auftragskonto;IBAN Auftragskonto;BIC Auftragskonto;Bankname Auftragskonto;Buchungstag;Valutadatum;Name Zahlungsbeteiligter;IBAN Zahlungsbeteiligter;BIC (SWIFT-Code) Zahlungsbeteiligter;Buchungstext;Verwendungszweck;Betrag;Waehrung;Saldo nach Buchung;Bemerkung;Kategorie;Steuerrelevant;Glaeubiger ID;Mandatsreferenz',
  'Girokonto;DE62570699990105593271;GENODED1XXX;Volksbank Musterstadt eG;15.03.2025;15.03.2025;Hausverwaltung Kraemer GmbH;DE75512108001245126199;SOLADES1XXX;Dauerauftrag;Miete 03/2025;-1090,00;EUR;512,30;;;;;',
  'Girokonto;DE62570699990105593271;GENODED1XXX;Volksbank Musterstadt eG;01.03.2025;01.03.2025;"Müller; Anna";DE89370400440532013000;COBADEFFXXX;Gutschrift;"Geschenk ""Danke""";50,00;EUR;1602,30;;;;;',
].join('\n');

const ING = [
  'Umsatzanzeige;Datei erstellt am: 19.10.2026 12:00',
  '',
  'IBAN;DE89 5001 0517 0012 3456 78',
  'Kontoname;Girokonto',
  '',
  'Buchung;Valuta;Auftraggeber/Empfänger;Buchungstext;Verwendungszweck;Saldo;Währung;Betrag;Währung',
  '28.02.2025;28.02.2025;Telekom Deutschland GmbH;Lastschrift;Mobilfunk 02/2025;1.234,56;EUR;-39,95;EUR',
  '10.02.2025;10.02.2025;Stadtwerke;Lastschrift;Abschlag;1.274,51;EUR;-148,00;EUR',
].join('\n');

test('amounts and days, as the banks write them', () => {
  assert.equal(readAmount('-1.234,56'), -1234.56);
  assert.equal(readAmount('1234,56-'), -1234.56);
  assert.equal(readAmount('+12,99'), 12.99);
  assert.equal(readAmount('−12,99 €'), -12.99);
  assert.equal(readAmount('1,234.56'), 1234.56);
  assert.equal(readAmount('12.99'), 12.99);
  assert.equal(readAmount('1.234'), 1234);
  assert.equal(readAmount('12,5'), 12.5);
  assert.equal(readAmount('abc'), null);
  assert.equal(readAmount(''), null);
  assert.equal(readDate('03.11.2025'), '2025-11-03');
  assert.equal(readDate('3.1.25'), '2025-01-03');
  assert.equal(readDate('2025-11-03'), '2025-11-03');
  assert.equal(readDate('31.02.2025'), '');
  assert.equal(readDate('morgen'), '');
});

test('a Sparkasse CSV-CAMT export: booked rows only, the account read from the file', () => {
  assert.equal(detectFormat(SPARKASSE), 'csv');
  const p = parseCsvExport(SPARKASSE);
  assert.equal(p.account, 'DE02120300000000202051');
  assert.equal(p.txs.length, 2);
  assert.equal(p.skipped, 1, 'the vorgemerkte row');
  const [salary, club] = p.txs;
  assert.equal(salary.amount, 2650);
  assert.equal(salary.remoteName, 'ACME GmbH');
  assert.equal(bookingDay(salary), '2025-01-02');
  assert.equal(club.creditorId, 'DE98ZZZ09999999999');
  assert.equal(club.mandateReference, 'M-77');
  assert.equal(club.remoteIban, 'DE75512108001245126199');
});

test('an Atruvia export with quoted separators, and an ING export with its summary above the header', () => {
  const a = parseCsvExport(ATRUVIA);
  assert.equal(a.account, 'DE62570699990105593271');
  assert.equal(a.txs.length, 2);
  assert.equal(a.txs[1].remoteName, 'Müller; Anna');
  assert.equal(a.txs[1].purpose, 'Geschenk "Danke"');
  assert.equal(a.txs[0].amount, -1090);

  const i = parseCsvExport(ING);
  assert.equal(i.account, 'DE89500105170012345678');
  assert.deepEqual(i.txs.map((t) => t.amount), [-39.95, -148]);
  assert.equal(i.txs[0].remoteName, 'Telekom Deutschland GmbH');
});

test('a CSV vouches for its first booking to its last, never for today', () => {
  const p = parseCsvExport(SPARKASSE);
  assert.deepEqual(importSpan(p, '2026-10-19'), { from: '2024-12-30', to: '2025-01-02' });
  assert.deepEqual(importSpan(p, '2025-01-02'), { from: '2024-12-30', to: '2025-01-01' });
  const h = importHistory(p, '0000202051', '2026-10-19');
  assert.ok(h);
  assert.deepEqual(h.data.accounts['0000202051'].coverage, [{ from: '2024-12-30', to: '2025-01-02' }]);
  assert.equal(h.data.accounts['0000202051'].txs.length, 2);
  assert.deepEqual(h.data.accounts['0000202051'].balances, []);
});

test('the file is matched to the view’s account by IBAN or number; other formats are told apart', () => {
  const accounts = [{ accountNumber: '202051', iban: 'DE02 1203 0000 0000 2020 51' }, { accountNumber: '9999', iban: null }];
  assert.equal(matchAccount('DE02120300000000202051', accounts), '202051');
  assert.equal(matchAccount('9999', accounts), '9999');
  assert.equal(matchAccount('DE00', accounts), null);
  assert.equal(detectFormat(':20:STARTUMS\r\n:25:12030000/202051\r\n:61:2501020102C2650,00NMSCNONREF\r\n'), 'mt940');
  assert.equal(detectFormat('<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt>'), 'camt');
  assert.equal(detectFormat('just some text'), null);
});

// ---- a payer's and a payee's column (DKB, the older Postbank) --------------------

const DKB_ROWS = [
  '"03.11.25";"03.11.25";"Gebucht";"ACME GMBH";"Max Mustermann";"Gehalt 10/2025";"Eingang";"DE89370400440532013000";"2.500,00";"";"";""',
  '"04.11.25";"04.11.25";"Gebucht";"Max Mustermann";"REWE Markt GmbH";"Einkauf";"Ausgang";"DE75512108001245126199";"-23,45";"";"";""',
  '"05.11.25";"05.11.25";"Vorgemerkt";"Max Mustermann";"Tankstelle";"Tanken";"Ausgang";"";"-60,00";"";"";""',
];
const dkb = (payer: string, payee: string) => [
  '"Girokonto";"DE02120300000000202051"',
  '""',
  `"Buchungsdatum";"Wertstellung";"Status";"${payer}";"${payee}";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"`,
  ...DKB_ROWS,
].join('\n');

test('a payer’s and a payee’s column: the other side of each booking, not the account holder', () => {
  const p = parseCsvExport(dkb('Zahlungspflichtige*r', 'Zahlungsempfänger*in'));
  assert.equal(p.account, 'DE02120300000000202051');
  assert.equal(p.skipped, 1, 'the vorgemerkte row');
  const [shop, salary] = p.txs;
  assert.deepEqual([salary.amount, salary.remoteName, salary.purpose], [2500, 'ACME GMBH', 'Gehalt 10/2025']);
  assert.deepEqual([shop.amount, shop.remoteName], [-23.45, 'REWE Markt GmbH']);
  assert.equal(shop.remoteIban, 'DE75512108001245126199');
});

test('the two columns are found however the bank writes the gender form', () => {
  const variants: [string, string][] = [
    ['Zahlungspflichtige:r', 'Zahlungsempfänger:in'],
    ['Zahlungspflichtige/r', 'Zahlungsempfänger/in'],
    ['Zahlungspflichtige/-r', 'Zahlungsempfänger/-in'],
    ['Zahlungspflichtige_r', 'Zahlungsempfänger_in'],
    ['Zahlungspflichtige(r)', 'Zahlungsempfänger(in)'],
    ['ZahlungspflichtigeR', 'ZahlungsempfängerIn'],
    ['Zahlungspflichtiger', 'Zahlungsempfänger'],
    ['Zahlungspflichtige*r:', 'Zahlungsempfänger*in:'],
    ['Zahlungspflichtiger/Zahlungspflichtige', 'Zahlungsempfänger/Zahlungsempfängerin'],
    ['Auftraggeber', 'Empfänger'],
    ['Auftraggeber*in', 'Empfänger*in'],
    ['Auftraggeber', 'Begünstigter'],
  ];
  for (const [payer, payee] of variants) {
    const names = parseCsvExport(dkb(payer, payee)).txs.map((t) => t.remoteName);
    assert.deepEqual(names, ['REWE Markt GmbH', 'ACME GMBH'], `${payer} / ${payee}`);
    // The columns the other way round in the file.
    const swapped = parseCsvExport(dkb(payee, payer)).txs.map((t) => t.remoteName);
    assert.deepEqual(swapped, ['Max Mustermann', 'Max Mustermann'], `${payee} / ${payer}: the file says so`);
  }
});

test('one such column alone is the name, as before; an empty cell on the booking’s side is no name', () => {
  const only = [
    'Buchungstag;Valuta;Empfänger;Verwendungszweck;Betrag',
    '03.11.2025;03.11.2025;ACME GmbH;Gehalt;2500,00',
    '04.11.2025;04.11.2025;REWE;Einkauf;-23,45',
  ].join('\n');
  assert.deepEqual(parseCsvExport(only).txs.map((t) => t.remoteName), ['REWE', 'ACME GmbH']);
  assert.deepEqual(parseCsvExport(only.replace('Empfänger', 'Zahlungspflichtige*r')).txs.map((t) => t.remoteName), ['REWE', 'ACME GmbH']);
  // An empty cell on the booking's side: no name, never the account holder's.
  const fee = [
    'Buchungsdatum;Zahlungspflichtige*r;Zahlungsempfänger*in;Verwendungszweck;Betrag',
    '03.11.2025;;Max Mustermann;Zinsen;1,20',
  ].join('\n');
  assert.equal(parseCsvExport(fee).txs[0].remoteName, '');
});

// ---- Girovo's own export, read back ------------------------------------------------

const noon = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).toISOString();
const midnight = (y: number, m: number, d: number) => new Date(y, m - 1, d).toISOString();

const OWN_ACCOUNT: SerializedAccount = {
  accountNumber: '1234593271', iban: 'DE78 5001 0517 0012 3459 32', bic: 'INGDDEFFXXX', currency: 'EUR', accountType: 'CheckingAccount',
  holder: 'NINO MUSTER', product: 'Girokonto Komfort', limit: null, canStatements: true, canBalance: true, canTransfer: true,
  canInstant: true, canPending: true,
};

const own = (over: Partial<SerializedTransaction>): SerializedTransaction => ({
  valueDate: midnight(2025, 11, 3), entryDate: midnight(2025, 11, 3), amount: -12.9, currency: 'EUR', purpose: '', bookingText: '',
  remoteName: '', remoteIban: '', remoteBic: '', e2eReference: '', mandateReference: '', customerReference: '', bankReference: '',
  transactionCode: '', primeNotesNr: '', textKeyExtension: '', additionalInformation: '', statementNumber: '', ...over,
});

const OWN_TXS = [
  own({
    entryDate: midnight(2025, 11, 4), valueDate: midnight(2025, 11, 5), amount: -1090, purpose: 'Miete 11/2025', bookingText: 'Dauerauftrag',
    remoteName: 'Hausverwaltung Kraemer GmbH', remoteIban: 'DE75512108001245126199', remoteBic: 'SOLADES1XXX',
  }),
  own({
    // A direct debit: creditor ID, a mandate with leading zeros and an all-digit reference (written as text formulas for Excel).
    entryDate: noon(2025, 11, 3), valueDate: noon(2025, 11, 3), amount: -15, purpose: 'Beitrag 11/2025', bookingText: 'Lastschrift',
    remoteName: 'Sportverein Musterstadt e.V.', remoteIban: 'DE89370400440532013000', remoteBic: 'COBADEFFXXX',
    creditorId: 'DE98ZZZ09999999999', mandateReference: '000123456789', e2eReference: '20251103000000004711',
  }),
  own({
    // A card payment behind a processor: the shop in its own column.
    entryDate: midnight(2025, 11, 3), valueDate: midnight(2025, 11, 1), amount: -23.45, purpose: 'Einkauf; "Danke"', bookingText: 'Kartenzahlung',
    remoteName: 'Landesbank Hessen-Thüringen', remoteIban: 'DE02120300000000202051', ultimateName: 'REWE Markt GmbH', e2eReference: 'CARD-88123',
  }),
  own({ entryDate: midnight(2025, 11, 1), valueDate: midnight(2025, 11, 1), amount: 2500, purpose: 'Gehalt 10/2025', bookingText: 'Gutschrift', remoteName: 'ACME GmbH', currency: 'EUR' }),
];

for (const locale of ['de', 'en'] as const) {
  test(`Girovo’s own export reads back whole (${locale})`, () => {
    const csv = withLocale(locale, () => transactionsToCsv(OWN_TXS, { account: OWN_ACCOUNT, bankName: 'ING', today: new Date(2026, 9, 19) }));
    assert.equal(detectFormat(csv), 'csv');
    const p = parseCsvExport(csv);
    assert.equal(p.skipped, 0);
    assert.equal(p.account, 'DE78500105170012345932');
    const pick = (t: SerializedTransaction) => ({
      day: bookingDay(t), value: bookingDay({ entryDate: '', valueDate: t.valueDate }), amount: t.amount, currency: t.currency,
      name: t.remoteName, iban: t.remoteIban, bic: t.remoteBic, ultimate: t.ultimateName ?? '', text: t.bookingText, purpose: t.purpose,
      creditor: t.creditorId ?? '', mandate: t.mandateReference, e2e: t.e2eReference,
    });
    assert.deepEqual(p.txs.map(pick), OWN_TXS.map(pick));
  });
}

test('an own export’s row with a Buchungstag still ahead is no booking yet, in either language', () => {
  for (const locale of ['de', 'en'] as const) {
    const csv = withLocale(locale, () => transactionsToCsv(OWN_TXS, { account: OWN_ACCOUNT, bankName: 'ING', today: new Date(2025, 10, 3, 9) }));
    const p = parseCsvExport(csv);
    assert.deepEqual([p.txs.length, p.skipped], [3, 1], locale);
  }
});
