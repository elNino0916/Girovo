import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, categoryLabel, counterpartyKey, counterpartyRule, counterpartyRuleKey, creditorId, isCategoryId, txKey } from './categories.ts';
import { categorize } from './categorize.ts';
import type { SerializedTransaction } from './fints-types';

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

// ---- one payee, its umlauts written two ways ---------------------------------------

const baker = (remoteName: string, over: Partial<SerializedTransaction> = {}) => ({
  entryDate: '2026-10-02T22:00:00.000Z', valueDate: '2026-10-02T22:00:00.000Z', amount: -4.2, currency: 'EUR', purpose: '', bookingText: 'KARTENZAHLUNG',
  remoteName, remoteIban: '', remoteBic: '', e2eReference: '', mandateReference: '', customerReference: '', bankReference: '', ...over,
}) as SerializedTransaction;

test('the stored keys stay as they are: dots dropped, a spelled-out umlaut kept', () => {
  assert.equal(counterpartyKey(baker('Bäckerei Müller')), 'name:BACKEREI MULLER');
  assert.equal(counterpartyKey(baker('BAECKEREI MUELLER')), 'name:BAECKEREI MUELLER');
  assert.equal(txKey(baker('Bäckerei Müller')), '2026-10-02|-4.20|BACKEREI MULLER|');
  assert.equal(txKey(baker('BAECKEREI MUELLER')), '2026-10-02|-4.20|BAECKEREI MUELLER|');
});

test('a rule for a payee is found under either spelling of its umlauts', () => {
  const dotted = baker('Bäckerei Müller');
  const spelled = baker('BAECKEREI MUELLER');
  for (const stored of [dotted, spelled]) {
    const rules = { [counterpartyKey(stored)]: 'dining' as const };
    for (const tx of [dotted, spelled, baker('bäckerei müller 0815'), baker('Baeckerei Müller'), baker('BÄCKEREI MÜLLER')]) {
      assert.equal(counterpartyRule(rules, tx), 'dining', `${stored.remoteName} → ${tx.remoteName}`);
      assert.equal(counterpartyRuleKey(rules, tx), counterpartyKey(stored));
      // The reviewer's case: two bookings of the same baker, one category.
      assert.deepEqual(categorize(tx, { ownIbans: [], rules }), { id: 'dining', source: 'rule' }, `${stored.remoteName} → ${tx.remoteName}`);
    }
  }
});

test('the booking’s own spelling wins; another payee is not taken for it', () => {
  const dotted = baker('Bäckerei Müller');
  const spelled = baker('BAECKEREI MUELLER');
  const both = { [counterpartyKey(dotted)]: 'dining' as const, [counterpartyKey(spelled)]: 'groceries' as const };
  assert.equal(counterpartyRule(both, dotted), 'dining');
  assert.equal(counterpartyRule(both, spelled), 'groceries');
  // No rule in any spelling: none, and the key a new one goes under is the booking's own.
  assert.equal(counterpartyRule({}, dotted), undefined);
  assert.equal(counterpartyRuleKey({}, dotted), null);
  // Letters that only look like a spelled-out umlaut: "Bauer" is not "Baur", "Quelle" not "Qülle".
  const rules = { 'name:BAUR': 'shopping' as const, 'name:QULLE': 'shopping' as const, 'name:NEU': 'shopping' as const };
  assert.equal(counterpartyRule(rules, baker('Bauer')), undefined);
  assert.equal(counterpartyRule(rules, baker('QUELLE')), undefined);
  assert.equal(counterpartyRule(rules, baker('Neue')), undefined);
  // A genuine "ue" beside a real umlaut: only the umlaut is read both ways.
  assert.equal(counterpartyRule({ [counterpartyKey(baker('Quelle Bäckerei'))]: 'dining' as const }, baker('QUELLE BAECKEREI')), 'dining');
  assert.equal(counterpartyRule({ [counterpartyKey(baker('QUELLE BAECKEREI'))]: 'dining' as const }, baker('Quelle Bäckerei')), 'dining');
  // A different name is a different payee, whatever its dots.
  assert.equal(counterpartyRule({ [counterpartyKey(dotted)]: 'dining' as const }, baker('Bäckerei Möller')), undefined);
});

test('behind an intermediary the shop’s name is read both ways too; an IBAN or creditor ID needs no second reading', () => {
  const card = (shop: string) => baker('Landesbank Hessen-Thüringen', { ultimateName: shop, remoteIban: 'DE02120300000000202051' });
  const rules = { [counterpartyKey(card('Bäckerei Müller'))]: 'dining' as const };
  assert.equal(counterpartyKey(card('Bäckerei Müller')), 'name:BACKEREI MULLER');
  assert.equal(counterpartyRule(rules, card('BAECKEREI MUELLER')), 'dining');
  const byIban = baker('Bäckerei Müller', { remoteIban: 'DE89370400440532013000' });
  assert.equal(counterpartyRule({ 'iban:DE89370400440532013000': 'dining' as const }, byIban), 'dining');
  assert.equal(counterpartyRule({ 'name:BACKEREI MULLER': 'dining' as const, 'name:BAECKEREI MUELLER': 'dining' as const }, byIban), undefined, 'the IBAN is the key');
  // Nobody named: nothing to read a second way.
  assert.equal(counterpartyRuleKey({ 'name:BACKEREI MULLER': 'dining' as const }, baker('')), null);
});
