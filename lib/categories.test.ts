import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, categoryLabel, counterpartyKey, creditorId, isCategoryId, txKey } from './categories.ts';

test('every category id is unique and labelled', () => {
  const ids = CATEGORIES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of CATEGORIES) assert.ok(c.label.length > 0);
  assert.equal(categoryLabel('transfer'), 'Umbuchung');
  assert.ok(isCategoryId('media'));
  assert.ok(!isCategoryId('nope'));
});

test('creditor id is read from a tagged purpose', () => {
  assert.equal(creditorId('EREF+1MREF+ABCRED+DE98ZZZ09999999999SVWZ+Strom'), 'DE98ZZZ09999999999');
  assert.equal(creditorId('CRED+LU96ZZZ0000000000000000058 SVWZ+x'), 'LU96ZZZ0000000000000000058');
  assert.equal(creditorId('SVWZ+no creditor here'), null);
});

test('counterparty key prefers creditor id, then IBAN, then name', () => {
  assert.match(counterpartyKey({ purpose: 'CRED+DE98ZZZ09999999999 SVWZ+x', remoteIban: 'DE02120300000000202051', remoteName: 'X' }), /^cred:/);
  assert.equal(counterpartyKey({ purpose: '', remoteIban: 'DE02 1203 0000 0000 2020 51', remoteName: 'X' }), 'iban:DE02120300000000202051');
  assert.equal(counterpartyKey({ purpose: '', remoteIban: '', remoteName: 'REWE SAGT DANKE 123456' }), 'name:REWE SAGT DANKE');
});

test('txKey is stable and amount-formatted', () => {
  const k = txKey({ entryDate: '2026-10-02T22:00:00.000Z', valueDate: '', amount: -12.9, remoteIban: 'DE02120300000000202051', remoteName: '', e2eReference: 'E1', bankReference: 'B1' });
  assert.equal(k, '2026-10-02|-12.90|DE02120300000000202051|E1');
});

test('creditor ID: separate MT940 field, CAMT purpose, legacy remoteBic — one key', async () => {
  const { txCreditorId, txBic } = await import('./categories.ts');
  const mt940 = { purpose: 'Netflix Abo', remoteBic: 'INGBNL2AXXX', creditorId: 'NL57ZZZ342486780000', remoteIban: 'NL12INGB0001234567', remoteName: 'NETFLIX' };
  const camt = { purpose: 'CRED+NL57ZZZ342486780000 SVWZ+Netflix Abo', remoteBic: 'INGBNL2AXXX', remoteIban: 'NL12INGB0001234567', remoteName: 'Netflix' };
  const legacy = { purpose: 'Netflix Abo', remoteBic: 'NL57ZZZ342486780000', remoteIban: 'NL12INGB0001234567', remoteName: 'NETFLIX' };
  assert.equal(txCreditorId(mt940), 'NL57ZZZ342486780000');
  assert.equal(txCreditorId(camt), 'NL57ZZZ342486780000');
  assert.equal(txCreditorId(legacy), 'NL57ZZZ342486780000');
  assert.equal(counterpartyKey(mt940), counterpartyKey(camt));
  assert.equal(counterpartyKey(camt), counterpartyKey(legacy));
  assert.equal(txBic(mt940), 'INGBNL2AXXX');
  assert.equal(txBic(legacy), '', 'a creditor ID is never shown as a BIC');
  assert.equal(txCreditorId({ purpose: '', remoteBic: 'COBADEFFXXX' }), null, 'a BIC is not a creditor ID');
});
