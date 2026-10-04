import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CSV_COLUMNS, csvAmountCell, csvDateCell, csvFileName, csvIdCell, csvScope, csvStatus, csvTextCell, transactionsToCsv } from './csv.ts';
import { textBlob } from './download.ts';
import type { SerializedAccount, SerializedTransaction } from './fints-types';

/** JSON of a local calendar day — what the wire carries for a booking date. */
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d).toISOString();

/** The day the Status column is measured against in these tests. */
const TODAY = new Date(2026, 9, 4, 13, 8);

const tx = (over: Partial<SerializedTransaction> = {}): SerializedTransaction => ({
  valueDate: day(2026, 10, 2),
  entryDate: day(2026, 10, 2),
  amount: -12.9,
  currency: 'EUR',
  purpose: '',
  bookingText: 'KARTENZAHLUNG',
  remoteName: 'REWE Markt GmbH',
  remoteIban: 'DE02120300000000202051',
  remoteBic: 'BYLADEM1001',
  e2eReference: '',
  mandateReference: '',
  customerReference: '',
  bankReference: '',
  transactionCode: '005',
  primeNotesNr: '',
  textKeyExtension: '',
  additionalInformation: '',
  statementNumber: '',
  ...over,
});

const ACCOUNT: SerializedAccount = {
  accountNumber: '1234593271',
  iban: 'DE78 5001 0517 0012 3459 32',
  bic: 'INGDDEFFXXX',
  currency: 'EUR',
  accountType: 'CheckingAccount',
  holder: 'NINO MUSTER',
  product: 'Girokonto Komfort',
  limit: null,
  canStatements: true,
  canBalance: true,
  canTransfer: true,
  canInstant: true,
  canPending: true,
};

/** A strict RFC 4180 reader for `;`-separated text — the test's stand-in for Excel. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === '"') throw new Error(`stray quote at ${i}`);
    else if (c === ';') { row.push(cell); cell = ''; }
    else if (c === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else if (c === '\n' || c === '\r') throw new Error(`bare line break outside quotes at ${i}`);
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const exportRows = (txs: SerializedTransaction[], extra: Partial<Parameters<typeof transactionsToCsv>[1]> = {}) => {
  const csv = transactionsToCsv(txs, { account: ACCOUNT, bankName: 'Musterbank eG', today: TODAY, ...extra });
  assert.ok(csv.startsWith('﻿'), 'BOM');
  assert.ok(csv.endsWith('\r\n'), 'ends with CRLF');
  const rows = parseCsv(csv.slice(1));
  for (const r of rows) assert.equal(r.length, CSV_COLUMNS.length, JSON.stringify(r));
  return rows.map((r) => Object.fromEntries(CSV_COLUMNS.map((c, i) => [c, r[i]])) as Record<(typeof CSV_COLUMNS)[number], string>);
};

test('header row is the documented column list', () => {
  const csv = transactionsToCsv([], { account: ACCOUNT, bankName: 'X' });
  assert.equal(
    csv,
    '﻿Bezeichnung Auftragskonto;IBAN Auftragskonto;BIC Auftragskonto;Bankname Auftragskonto;Buchungstag;Valutadatum;' +
      'Name Zahlungsbeteiligter;IBAN Zahlungsbeteiligter;BIC Zahlungsbeteiligter;Abweichender Empfänger/Auftraggeber;Buchungstext;Verwendungszweck;Betrag;' +
      'Waehrung;Kategorie;Glaeubiger ID;Mandatsreferenz;Kundenreferenz (End-to-End);Status\r\n',
  );
});

test('the file starts with the UTF-8 byte order mark once saved', async () => {
  const csv = transactionsToCsv([tx({ remoteName: 'Müller' })], { account: ACCOUNT, bankName: 'X' });
  const bytes = new Uint8Array(await textBlob(csv, 'text/csv;charset=utf-8').arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(new TextDecoder().decode(bytes), csv.slice(1)); // TextDecoder drops the BOM; the rest is UTF-8
  assert.ok(new TextDecoder().decode(bytes).includes('Müller'));
});

test('one row per booking with the account in every row', () => {
  const [header, row] = exportRows([tx()]);
  assert.equal(header['Betrag'], 'Betrag');
  assert.equal(row['Bezeichnung Auftragskonto'], 'Girokonto Komfort');
  assert.equal(row['IBAN Auftragskonto'], 'DE78500105170012345932');
  assert.equal(row['BIC Auftragskonto'], 'INGDDEFFXXX');
  assert.equal(row['Bankname Auftragskonto'], 'Musterbank eG');
  assert.equal(row['Buchungstag'], '02.10.2026');
  assert.equal(row['Valutadatum'], '02.10.2026');
  assert.equal(row['Name Zahlungsbeteiligter'], 'REWE Markt GmbH');
  assert.equal(row['IBAN Zahlungsbeteiligter'], 'DE02120300000000202051');
  assert.equal(row['BIC Zahlungsbeteiligter'], 'BYLADEM1001');
  assert.equal(row['Buchungstext'], 'Kartenzahlung');
  assert.equal(row['Betrag'], '-12,90');
  assert.equal(row['Waehrung'], 'EUR');
  assert.equal(row['Kategorie'], '');
  assert.equal(row['Status'], 'Gebucht');
});

test('amounts: decimal comma, ASCII minus, no grouping, exact cents', () => {
  assert.equal(csvAmountCell(-1234.5), '-1234,50');
  assert.equal(csvAmountCell(2630.5), '2630,50');
  assert.equal(csvAmountCell(1234567.89), '1234567,89');
  assert.equal(csvAmountCell(0.1 + 0.2), '0,30');
  assert.equal(csvAmountCell(-0.001), '0,00');
  assert.equal(csvAmountCell(0), '0,00');
  assert.equal(csvAmountCell(-0.5), '-0,50');
  assert.equal(csvAmountCell(Number.NaN), '');
  assert.equal(csvAmountCell(null), '');
  // Negative amounts are never mistaken for formulas.
  const [, row] = exportRows([tx({ amount: -1726.58 })]);
  assert.equal(row['Betrag'], '-1726,58');
});

test('dates are the local calendar day, dd.mm.yyyy', () => {
  assert.equal(csvDateCell(day(2026, 1, 5)), '05.01.2026');
  assert.equal(csvDateCell(new Date(2026, 11, 31, 23, 59)), '31.12.2026');
  assert.equal(csvDateCell(''), '');
  assert.equal(csvDateCell('nonsense'), '');
  assert.equal(csvDateCell(null), '');
});

test('quotes separators, quotes and line breaks (RFC 4180)', () => {
  assert.equal(csvTextCell('a;b'), '"a;b"');
  assert.equal(csvTextCell('Sag "Hallo"'), '"Sag ""Hallo"""');
  assert.equal(csvTextCell('Zeile 1\r\nZeile 2'), '"Zeile 1\nZeile 2"');
  assert.equal(csvTextCell('plain, with comma'), 'plain, with comma');
  assert.equal(csvTextCell(null), '');

  const [, row] = exportRows([
    tx({ remoteName: 'Müller; Söhne "Gebr."\nGmbH', purpose: 'SVWZ+Rechnung 17; Teil "A"' }),
  ]);
  assert.equal(row['Name Zahlungsbeteiligter'], 'Müller; Söhne "Gebr."\nGmbH');
  assert.equal(row['Verwendungszweck'], 'Rechnung 17; Teil "A"');
});

test('formula injection is neutralised in text cells', () => {
  for (const evil of ['=HYPERLINK("http://x","y")', '+49 30 123', '-Rabatt', '@SUM(A1)', '\tTab', '\rCR']) {
    assert.ok(csvTextCell(evil).replace(/^"/, '').startsWith("'"), evil);
  }
  assert.equal(csvTextCell('=1+1'), "'=1+1");
  assert.equal(csvTextCell('Max = Moritz'), 'Max = Moritz'); // only a leading trigger matters

  const [, row] = exportRows([tx({ remoteName: '=cmd|" /C calc"!A0', purpose: 'SVWZ+@evil', bookingText: '-' })]);
  assert.equal(row['Name Zahlungsbeteiligter'], `'=cmd|" /C calc"!A0`);
  assert.equal(row['Verwendungszweck'], "'@evil");
  assert.equal(row['Buchungstext'], "'-");
});

test('umlauts survive, including bank text that arrived mis-decoded', () => {
  const [, row] = exportRows([tx({ remoteName: 'Jürgen Größe', purpose: 'SVWZ+RÃ¼ckzahlung' })]);
  assert.equal(row['Name Zahlungsbeteiligter'], 'Jürgen Größe');
  assert.equal(row['Verwendungszweck'], 'Rückzahlung');
});

test('structured purpose: prose in Verwendungszweck, identifiers in their columns', () => {
  const [, row] = exportRows([
    tx({
      purpose: 'EREF+1051808585130MREF+5RRJ2259NXZLLCRED+LU96ZZZ0000000000000000058SVWZ+G2A.COM Limited   Bestellung 4711ABWA+Max Muster',
      bookingText: 'FOLGELASTSCHRIFT',
    }),
  ]);
  assert.equal(row['Verwendungszweck'], 'G2A.COM Limited Bestellung 4711 · Abweichender Auftraggeber: Max Muster');
  assert.equal(row['Glaeubiger ID'], 'LU96ZZZ0000000000000000058');
  assert.equal(row['Mandatsreferenz'], '5RRJ2259NXZLL');
  // Digits only, so it is kept as text for Excel (see below).
  assert.equal(row['Kundenreferenz (End-to-End)'], '="1051808585130"');
});

test('identifiers Excel would turn into numbers stay text', () => {
  // The cell as the file carries it, before RFC 4180 unquoting.
  assert.equal(csvIdCell('000123456789'), '"=""000123456789"""');
  assert.equal(csvIdCell('20261003123456789012'), '"=""20261003123456789012"""');
  assert.equal(csvIdCell('2026-10-03'), '"=""2026-10-03"""', 'Excel would make it a date');
  assert.equal(csvIdCell('1.2'), '"=""1.2"""');
  // Anything with a letter is text to Excel already and stays as it is.
  assert.equal(csvIdCell('ABC-123'), 'ABC-123');
  assert.equal(csvIdCell('DE02120300000000202051'), 'DE02120300000000202051');
  assert.equal(csvIdCell('1E2E-REF'), '1E2E-REF');
  assert.equal(csvIdCell(''), '');
  assert.equal(csvIdCell(null), '');
  // The formula guard still comes first, and nothing that is not number-shaped is wrapped.
  assert.equal(csvIdCell('=1+1'), "'=1+1");
  assert.equal(csvIdCell('-123'), "'-123");
  assert.equal(csvIdCell('1"+HYPERLINK("x")+"'), '"1""+HYPERLINK(""x"")+"""');

  const [, row] = exportRows([
    tx({
      remoteIban: '0532013000', // a legacy Kontonummer instead of an IBAN
      remoteBic: '37040044', // and its BLZ
      mandateReference: '000123456789',
      e2eReference: '20261003123456789012',
      amount: -49.9,
    }),
  ]);
  assert.equal(row['IBAN Zahlungsbeteiligter'], '="0532013000"');
  assert.equal(row['BIC Zahlungsbeteiligter'], '="37040044"');
  assert.equal(row['Mandatsreferenz'], '="000123456789"');
  assert.equal(row['Kundenreferenz (End-to-End)'], '="20261003123456789012"');
  assert.equal(row['Betrag'], '-49,90', 'the amount stays a number');
  assert.equal(row['IBAN Auftragskonto'], 'DE78500105170012345932');
  // Text columns are not identifiers: a name of digits stays a plain cell.
  const [, named] = exportRows([tx({ remoteName: '4711' })]);
  assert.equal(named['Name Zahlungsbeteiligter'], '4711');
});

test('separately parsed references win, and SEPA placeholders are dropped', () => {
  const [, a] = exportRows([tx({ e2eReference: 'E2E-1', mandateReference: 'M-1', purpose: 'EREF+other SVWZ+x' })]);
  assert.equal(a['Kundenreferenz (End-to-End)'], 'E2E-1');
  assert.equal(a['Mandatsreferenz'], 'M-1');
  const [, b] = exportRows([tx({ e2eReference: 'NOTPROVIDED', purpose: 'EREF+NOTPROVIDED SVWZ+x' })]);
  assert.equal(b['Kundenreferenz (End-to-End)'], '');
});

test('category from the callback, as a result or a bare id', () => {
  const t1 = tx({ remoteName: 'Netflix' });
  const t2 = tx({ remoteName: 'Arbeitgeber', amount: 2630.5 });
  const [, r1, r2] = exportRows([t1, t2], {
    categoryOf: (t) => (t === t1 ? { id: 'media', source: 'auto' } : 'income'),
  });
  assert.equal(r1['Kategorie'], 'Abos & Medien');
  assert.equal(r2['Kategorie'], 'Einkommen');
  const [, r3] = exportRows([t1], { categoryOf: () => null });
  assert.equal(r3['Kategorie'], '');
});

test('status: what the list says of the day — a Buchungstag still ahead is not booked yet', () => {
  // The bank sends a weekend transfer with Monday as its Buchungstag; the list
  // files it under "noch nicht gebucht", and so does the file.
  const ahead = tx({ remoteName: 'Stadtwerke', entryDate: day(2026, 10, 5), valueDate: day(2026, 10, 3) });
  const today = tx({ remoteName: 'REWE', entryDate: day(2026, 10, 4) });
  const past = tx();
  const rows = exportRows([ahead, today, past]);
  assert.deepEqual(rows.slice(1).map((r) => r['Status']), ['Noch nicht gebucht', 'Gebucht', 'Gebucht']);
});

test('status: by the Buchungstag, else the Valuta; an unreadable date counts as booked', () => {
  assert.equal(csvStatus({ entryDate: day(2026, 10, 5), valueDate: day(2026, 10, 1) }, TODAY), 'Noch nicht gebucht');
  assert.equal(csvStatus({ entryDate: '', valueDate: day(2026, 10, 6) }, TODAY), 'Noch nicht gebucht');
  assert.equal(csvStatus({ entryDate: day(2026, 10, 4), valueDate: day(2026, 10, 9) }, TODAY), 'Gebucht');
  assert.equal(csvStatus({ entryDate: 'nonsense', valueDate: '' }, TODAY), 'Gebucht');
  // Late in the evening is still the same day.
  assert.equal(csvStatus({ entryDate: new Date(2026, 9, 4, 23, 59).toISOString(), valueDate: '' }, TODAY), 'Gebucht');
});

test('account label: alias, then product, then account type', () => {
  assert.equal(exportRows([tx()], { accountLabel: 'Haushaltskonto' })[1]['Bezeichnung Auftragskonto'], 'Haushaltskonto');
  const noProduct = { ...ACCOUNT, product: null };
  const csv = transactionsToCsv([tx()], { account: noProduct, bankName: 'X' });
  assert.ok(parseCsv(csv.slice(1))[1][0] === 'Girokonto');
});

test('keeps the order it is given', () => {
  const rows = exportRows([tx({ remoteName: 'B' }), tx({ remoteName: 'A' }), tx({ remoteName: 'C' })]);
  assert.deepEqual(rows.slice(1).map((r) => r['Name Zahlungsbeteiligter']), ['B', 'A', 'C']);
});

test('file name: last six of the IBAN and the range', () => {
  assert.equal(csvFileName(ACCOUNT, { from: '2026-07-05', to: '2026-10-03' }), 'Umsaetze_345932_2026-07-05_2026-10-03.csv');
  assert.equal(csvFileName({ accountNumber: '0012345678', iban: null }, { from: '2026-01-01', to: '2026-01-31' }), 'Umsaetze_345678_2026-01-01_2026-01-31.csv');
  assert.equal(csvFileName({ accountNumber: '', iban: null }, { from: '', to: '' }), 'Umsaetze_Konto.csv');
  assert.equal(csvFileName(ACCOUNT, { from: '../../x', to: '2026-10-03' }), 'Umsaetze_345932_2026-10-03.csv');
});

test('file name: a filtered file says so, a month alone is said by its dates', () => {
  assert.equal(
    csvFileName(ACCOUNT, { from: '2026-09-01', to: '2026-09-30' }),
    'Umsaetze_345932_2026-09-01_2026-09-30.csv',
  );
  assert.equal(
    csvFileName(ACCOUNT, { from: '2026-07-05', to: '2026-10-03' }, { filtered: true }),
    'Umsaetze_345932_2026-07-05_2026-10-03_gefiltert.csv',
  );
});

test('scope: the filter\'s month narrows the days, open ends take the loaded period', () => {
  const loaded = { from: '2026-07-06', to: '2026-10-04' };
  const none = { dir: 'all', category: null, query: '' };
  assert.deepEqual(csvScope(none, loaded), { span: loaded, filtered: false });
  assert.deepEqual(
    csvScope({ ...none, from: '2026-09-01', to: '2026-09-30' }, loaded),
    { span: { from: '2026-09-01', to: '2026-09-30' }, filtered: false },
  );
  assert.deepEqual(csvScope({ ...none, from: '2026-09-01' }, loaded).span, { from: '2026-09-01', to: '2026-10-04' });
  assert.deepEqual(csvScope({ ...none, to: '2026-08-31' }, loaded).span, { from: '2026-07-06', to: '2026-08-31' });
});

test('scope: a search, a category or a direction makes the file "gefiltert"', () => {
  const loaded = { from: '2026-07-06', to: '2026-10-04' };
  const none = { dir: 'all', category: null, query: '' };
  assert.equal(csvScope({ ...none, query: 'rewe' }, loaded).filtered, true);
  assert.equal(csvScope({ ...none, query: '   ' }, loaded).filtered, false);
  assert.equal(csvScope({ ...none, category: 'groceries' }, loaded).filtered, true);
  assert.equal(csvScope({ ...none, dir: 'out' }, loaded).filtered, true);
});
