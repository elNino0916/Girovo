import './__fixtures__/tz.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectFormat, importHistory, importSpan, matchAccount, parseCsvExport, readAmount, readDate } from './bank-import.ts';
import { bookingDay } from './history.ts';

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
