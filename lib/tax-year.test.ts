import './__fixtures__/tz.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SerializedTransaction } from './fints-types';
import type { CustomCategory } from './categories.ts';
import { setCustomCategories, txKey } from './categories.ts';
import { categorize } from './categorize.ts';
import { defaultTaxYear, taxBookings, taxFileName, taxYear, taxYearCsv, taxYears, yearCoverage } from './tax-year.ts';
import { crc32, uniqueNames, zipStore } from './zip.ts';
import { OWN_IBANS, mt940 } from './__fixtures__/transactions.ts';

const TODAY = new Date(2026, 9, 19);
const DONATIONS: CustomCategory = { id: 'c_spenden1234', name: 'Spenden', direction: 'out' };

test('crc32 has the standard check value, and a stored zip reads back', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const a = new TextEncoder().encode('%PDF-1.7 fake');
  const b = new Uint8Array([1, 2, 3, 4, 5]);
  const zip = zipStore([{ name: 'Beleg Bäckerei.pdf', data: a }, { name: 'Beleg Bäckerei.pdf', data: b }], new Date(2026, 0, 2, 3, 4, 6));
  const view = new DataView(zip.buffer);
  // End of central directory: the last 22 bytes.
  const end = zip.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 2);
  let at = view.getUint32(end + 16, true);
  const names: string[] = [];
  for (let i = 0; i < 2; i++) {
    assert.equal(view.getUint32(at, true), 0x02014b50);
    assert.equal(view.getUint16(at + 8, true), 0x0800, 'UTF-8 names');
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    names.push(new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLen)));
    const localNameLen = view.getUint16(local + 26, true);
    const data = zip.subarray(local + 30 + localNameLen, local + 30 + localNameLen + size);
    assert.equal(crc32(data), crc);
    at += 46 + nameLen;
  }
  assert.deepEqual(names, ['Beleg Bäckerei.pdf', 'Beleg Bäckerei (2).pdf']);
  assert.deepEqual(uniqueNames(['a/b.pdf', '..x', 'CON?.txt']), ['a_b.pdf', 'x', 'CON_.txt']);
});

test('a year is complete only when its loaded days cover it', () => {
  assert.deepEqual(yearCoverage({ from: '2024-11-01', to: '2026-10-19' }, 2025, TODAY), { coverage: 'complete', from: '2025-01-01', to: '2025-12-31' });
  assert.deepEqual(yearCoverage({ from: '2025-07-21', to: '2026-10-19' }, 2025, TODAY), { coverage: 'partial', from: '2025-07-21', to: '2025-12-31' });
  assert.deepEqual(yearCoverage({ from: '2025-12-01', to: '2026-10-19' }, 2026, TODAY), { coverage: 'running', from: '2026-01-01', to: '2026-10-19' });
  assert.deepEqual(yearCoverage({ from: '2026-07-21', to: '2026-10-19' }, 2025, TODAY), { coverage: 'none' });
  assert.deepEqual(yearCoverage(null, 2025, TODAY), { coverage: 'none' });
  assert.deepEqual(taxYears({ a: [mt940({ day: '2024-03-01', amount: -1 })] }, TODAY), [2026, 2024]);
  assert.equal(defaultTaxYear([2026, 2025, 2024], TODAY), 2025);
  assert.equal(defaultTaxYear([2026], TODAY), 2026);
});

test('the summary groups the year by the picked categories, a split booking with its share', () => {
  setCustomCategories([DONATIONS]);
  try {
    const unicef = mt940({ day: '2025-12-12', amount: -50, gvc: '116', text: 'UEBERWEISUNG', name: 'UNICEF Deutschland', iban: 'DE57370205000000300000', purpose: 'Spende' });
    const market = mt940({ day: '2025-11-03', amount: -80, gvc: '106', text: 'KARTENZAHLUNG', name: 'REWE SAGT DANKE 4711//BERLIN/DE' });
    const lastYear = mt940({ day: '2024-12-30', amount: -20, gvc: '116', text: 'UEBERWEISUNG', name: 'UNICEF Deutschland', iban: 'DE57370205000000300000' });
    const insurance = mt940({ day: '2025-03-01', amount: -120.5, gvc: '105', text: 'BASISLASTSCHRIFT', name: 'HUK-COBURG Versicherung', purpose: 'Haftpflicht' });
    const txs: SerializedTransaction[] = [unicef, market, lastYear, insurance];
    const overrides = { [txKey(unicef)]: DONATIONS.id, [txKey(lastYear)]: DONATIONS.id };
    const splits = { [txKey(market)]: [{ id: 'groceries' as const, cents: 6500 }, { id: DONATIONS.id, cents: 1500 }] };
    const categoryOf = (tx: SerializedTransaction) => categorize(tx, { ownIbans: OWN_IBANS, overrides, splits });

    const summary = taxYear({
      year: 2025,
      accounts: [{ accountNumber: '1' }],
      txsByAccount: { 1: txs },
      spans: { 1: { from: '2025-01-01', to: '2026-10-19' } },
      categoryOf,
      include: new Set([DONATIONS.id, 'insurance']),
      today: TODAY,
    });
    assert.equal(summary.complete, true);
    assert.deepEqual(summary.groups.map((g) => [g.id, g.total, g.lines.length]), [
      ['insurance', -120.5, 1],
      [DONATIONS.id, -65, 2],
    ]);
    const donations = summary.groups[1];
    assert.deepEqual(donations.lines.map((l) => [l.tx, l.amount, l.share]), [[market, -15, true], [unicef, -50, false]]);
    assert.equal(taxBookings(summary).length, 3);

    const csv = taxYearCsv(summary, { accountOf: () => ({ iban: 'DE02 1203 0000 0000 2020 51', accountNumber: '1' }), receiptsOf: (tx) => (tx === unicef ? ['Spende UNICEF.pdf'] : []) });
    const rows = csv.replace(/^﻿/, '').trim().split('\r\n');
    assert.equal(rows.length, 4);
    assert.match(rows[0], /^Kategorie;Buchungstag/);
    assert.match(rows[2], /^Spenden;03\.11\.2025;.*;-15,00;-80,00;;$/);
    assert.match(rows[3], /;-50,00;;;Spende UNICEF\.pdf$/);

    // Half a year loaded: incomplete, and said per account.
    const partial = taxYear({
      year: 2025, accounts: [{ accountNumber: '1' }], txsByAccount: { 1: txs }, spans: { 1: { from: '2025-07-21', to: '2026-10-19' } },
      categoryOf, include: new Set([DONATIONS.id]), today: TODAY,
    });
    assert.equal(partial.complete, false);
    assert.equal(partial.accounts[0].coverage, 'partial');
  } finally {
    setCustomCategories([]);
  }
  assert.equal(taxFileName(2025, 'zip'), 'Steuerjahr_2025_Belege.zip');
  assert.equal(taxFileName(2025, 'pdf'), 'Steuerjahr_2025.pdf');
});
