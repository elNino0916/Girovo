// Runs against the real banks-data.json (read from the working directory, as
// `npm test` runs from the project root).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POPULAR_BANKS, lookupBlz, searchBanks } from './banks.ts';

const blzs = (q: string) => searchBanks(q).map((b) => b.blz);

test('the DKB tile picks Deutsche Kreditbank Berlin itself', () => {
  const dkb = POPULAR_BANKS.find((p) => p.key === 'dkb');
  assert.ok(dkb, 'DKB is a quick pick');
  assert.equal(dkb.blz, '12030000');
  assert.equal(dkb.search, undefined);
  assert.equal(dkb.fullName, 'Deutsche Kreditbank Berlin');
});

test('"DKB" finds DKB, not the Sparkasse whose BIC ends in DKB', () => {
  assert.deepEqual(blzs('DKB'), ['12030000']);
  assert.deepEqual(blzs('dkb berlin'), ['12030000']);
  // BYLADEM1DKB belongs to the Kreis- und Stadtsparkasse Dinkelsbühl.
  assert.ok(!blzs('DKB').includes('76551020'));
});

test('the short names people use find their bank first', () => {
  const olb = searchBanks('OLB');
  assert.ok(olb.length >= 1);
  assert.ok(olb.slice(0, 3).every((b) => b.brand === 'oldenburgische'), 'OLB rows lead');
  // GENODEM1OLB is a Volksbank's BIC, not a reason to show it for "OLB".
  assert.ok(!olb.some((b) => b.bic === 'GENODEM1OLB'));
  assert.equal(searchBanks('apoBank')[0]?.blz, '30060601');
  const hvb = searchBanks('HVB');
  assert.ok(hvb.length > 0 && hvb.every((b) => b.brand === 'hypovereinsbank'));
  // The institute's own name already carries ING-DiBa.
  assert.equal(searchBanks('ING-DiBa')[0]?.blz, '50010517');
});

test('a BIC is matched from its start only', () => {
  assert.equal(searchBanks('BYLADEM1DKB')[0]?.blz, '76551020');
  assert.ok(searchBanks('COBADEHD').every((b) => b.bic.startsWith('COBADEHD')));
  // BIC hits first, then names: "Deut" starts Deutsche Bank's BIC and names alike.
  assert.ok(searchBanks('Deut').length > 0);
});

test('a BLZ is found with the spaces the app prints it with', () => {
  assert.deepEqual(blzs('370 400 44'), ['37040044']);
  assert.equal(blzs('37040044')[0], '37040044');
  assert.ok(blzs('370').every((b) => b.startsWith('370')));
  // Too short or too long for a BLZ: nothing, rather than a name search.
  assert.deepEqual(blzs('37'), []);
  assert.deepEqual(blzs('370400440'), []);
});

test('an IBAN is never searched on the server — the browser sends its BLZ', () => {
  assert.deepEqual(searchBanks('DE89 3704 0044 0532 0130 00'), []);
});

test('rows of one name keep the order of their BLZ', () => {
  const rows = searchBanks('comdirect');
  assert.ok(rows.length > 1 && rows.every((b) => b.name === rows[0].name));
  const order = rows.map((b) => b.blz);
  assert.deepEqual(order, [...order].sort());
});

test('banks without FinTS are simply not in the list', () => {
  for (const q of ['N26', 'Revolut', 'Trade Republic', 'bunq']) assert.deepEqual(searchBanks(q), [], q);
});

test('lookupBlz answers for a listed BLZ and nothing else', () => {
  assert.equal(lookupBlz('12030000')?.brand, 'dkb');
  assert.equal(lookupBlz(' 12030000 ')?.blz, '12030000');
  assert.equal(lookupBlz('00000000'), null);
  assert.equal(lookupBlz(undefined), null);
});
