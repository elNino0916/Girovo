import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  groupAccounts, groupKindOf, groupSum, hasOverview, moveAccount, orderAccounts, overviewFigures, sanitizeAccountOrder,
  type AccountValue,
} from './account-overview.ts';

test('hasOverview: more than one account, or more than one bank', () => {
  assert.equal(hasOverview([1], [1]), false);
  assert.equal(hasOverview([], [1]), false);
  assert.equal(hasOverview([1, 2], [1]), true);
  // One account, a second bank not logged in: its row needs the overview.
  assert.equal(hasOverview([1], [1, 2]), true);
});

const acct = (accountType: string, over: { canStatements?: boolean; canPortfolio?: boolean } = {}) => ({
  accountType,
  canStatements: over.canStatements ?? true,
  canPortfolio: over.canPortfolio ?? false,
});

test('groupKindOf: by the Kontoart, names and numbers alike', () => {
  assert.equal(groupKindOf(acct('CheckingAccount')), 'giro');
  assert.equal(groupKindOf(acct('1')), 'giro');
  assert.equal(groupKindOf(acct('SavingsAccount')), 'saving');
  assert.equal(groupKindOf(acct('20')), 'saving');
  assert.equal(groupKindOf(acct('SecuritiesAccount')), 'saving');
  assert.equal(groupKindOf(acct('70')), 'saving');
  assert.equal(groupKindOf(acct('CreditCardAccount')), 'credit');
  assert.equal(groupKindOf(acct('55')), 'credit');
  assert.equal(groupKindOf(acct('LoanMortgageAccount')), 'credit');
  assert.equal(groupKindOf(acct('42')), 'credit');
  assert.equal(groupKindOf(acct('InsurancePolicy')), 'other');
  assert.equal(groupKindOf(acct('90')), 'other');
  assert.equal(groupKindOf(acct('')), 'other');
});

test('groupKindOf: a Depot read by its holdings is Sparen & Anlegen whatever its Kontoart says', () => {
  assert.equal(groupKindOf(acct('1', { canStatements: false, canPortfolio: true })), 'saving');
});

test('sanitizeAccountOrder: strings only, each once, within the caps', () => {
  assert.deepEqual(sanitizeAccountOrder(['a', 'b', 'a', 7, '', 'x'.repeat(65), 'c']), ['a', 'b', 'c']);
  assert.deepEqual(sanitizeAccountOrder('a,b'), []);
  assert.equal(sanitizeAccountOrder(Array.from({ length: 80 }, (_, i) => `n${i}`)).length, 50);
});

const n = (accountNumber: string) => ({ accountNumber });

test('orderAccounts: the kept order first, every other account after it as the banks listed them', () => {
  const list = [n('a'), n('b'), n('c'), n('d')];
  assert.deepEqual(orderAccounts(list, ['c', 'a']).map((a) => a.accountNumber), ['c', 'a', 'b', 'd']);
  assert.deepEqual(orderAccounts(list, ['gone', 'd']).map((a) => a.accountNumber), ['d', 'a', 'b', 'c']);
  assert.deepEqual(orderAccounts(list, null).map((a) => a.accountNumber), ['a', 'b', 'c', 'd']);
});

test('moveAccount: inside its group, the other groups stay where they are', () => {
  const order = ['g1', 's1', 'g2', 's2', 'g3'];
  // Girokonten g1, g2, g3: g3 to the top.
  assert.deepEqual(moveAccount(order, ['g1', 'g2', 'g3'], 2, 0), ['g3', 's1', 'g1', 's2', 'g2']);
  // Sparen s1, s2: swapped.
  assert.deepEqual(moveAccount(order, ['s1', 's2'], 0, 1), ['g1', 's2', 'g2', 's1', 'g3']);
  // Nothing to do, or out of range.
  assert.deepEqual(moveAccount(order, ['g1', 'g2'], 1, 1), order);
  assert.deepEqual(moveAccount(order, ['g1', 'g2'], 0, 5), order);
});

test('groupAccounts: by kind in the fixed sequence, by bank in the banks’ order, or one group', () => {
  const list = [
    { id: 'karte', kind: 'credit', bank: 'vb' },
    { id: 'giro', kind: 'giro', bank: 'vb' },
    { id: 'spk', kind: 'giro', bank: 'spk' },
    { id: 'tg', kind: 'saving', bank: 'vb' },
  ] as const;
  const how = { kindOf: (a: (typeof list)[number]) => a.kind, bankOf: (a: (typeof list)[number]) => a.bank, banks: ['spk', 'vb'] };
  const byType = groupAccounts(list, 'type', how);
  assert.deepEqual(byType.map((g) => [g.key, g.accounts.map((a) => a.id)]), [
    ['giro', ['giro', 'spk']],
    ['saving', ['tg']],
    ['credit', ['karte']],
  ]);
  const byBank = groupAccounts(list, 'bank', how);
  assert.deepEqual(byBank.map((g) => [g.key, g.accounts.map((a) => a.id)]), [
    ['spk', ['spk']],
    ['vb', ['karte', 'giro', 'tg']],
  ]);
  assert.deepEqual(groupAccounts(list, 'none', how).map((g) => g.accounts.length), [4]);
  assert.deepEqual(groupAccounts([], 'none', how), []);
});

const values: Record<string, AccountValue> = {
  giro: { state: 'known', cents: 78011, currency: 'EUR' },
  spk: { state: 'known', cents: 121436, currency: 'EUR' },
  tg: { state: 'known', cents: 835000, currency: 'EUR' },
  depot: { state: 'known', cents: 2528158, currency: 'EUR' },
  karte: { state: 'known', cents: -31247, currency: 'EUR' },
  kredit: { state: 'known', cents: -842000, currency: 'EUR' },
};
const of = (v: Record<string, AccountValue>) => (a: string) => v[a];

test('overviewFigures: the mock’s figures, by each account’s own sign', () => {
  const f = overviewFigures(Object.keys(values), of(values));
  assert.equal(f.total, 2689358);
  assert.equal(f.assets, 3562605);
  assert.equal(f.liabilities, -873247);
  assert.deepEqual(f.missing, []);
});

test('overviewFigures: an overdrawn Girokonto is owed, not owned', () => {
  const f = overviewFigures(['giro', 'tg'], of({ ...values, giro: { state: 'known', cents: -5000, currency: 'EUR' } }));
  assert.equal(f.assets, 835000);
  assert.equal(f.liabilities, -5000);
});

test('overviewFigures: a missing balance or a bank not logged in keeps every figure open', () => {
  const f = overviewFigures(['giro', 'tg'], of({ ...values, tg: { state: 'missing', currency: 'EUR' } }));
  assert.deepEqual([f.total, f.assets, f.liabilities], [null, null, null]);
  assert.deepEqual(f.missing, ['tg']);
  assert.equal(overviewFigures(['giro'], of(values), 1).total, null);
});

test('overviewFigures: what never counts is named, not summed', () => {
  const f = overviewFigures(['giro', 'usd', 'depot', 'bauspar', 'usdLater'], of({
    ...values,
    usd: { state: 'known', cents: 10000, currency: 'USD' },
    usdLater: { state: 'missing', currency: 'usd' },
    depot: { state: 'unread' },
    bauspar: { state: 'never' },
  }));
  assert.equal(f.total, 78011);
  assert.deepEqual(f.excluded.map((e) => [e.account, e.reason]), [
    ['usd', 'currency'], ['depot', 'unread'], ['bauspar', 'unsupported'], ['usdLater', 'currency'],
  ]);
});

test('groupSum: complete groups only; other currencies and unreported accounts are left out', () => {
  assert.equal(groupSum(['tg', 'depot'], of(values)), 3363158);
  assert.equal(groupSum(['tg', 'depot'], of({ ...values, depot: { state: 'unread' } })), null);
  assert.equal(groupSum(['tg', 'giro'], of({ ...values, giro: { state: 'missing', currency: 'EUR' } })), null);
  assert.equal(groupSum(['tg', 'usd'], of({ ...values, usd: { state: 'missing', currency: 'USD' } })), 835000);
  assert.equal(groupSum(['bauspar'], of({ bauspar: { state: 'never' } })), null);
});
