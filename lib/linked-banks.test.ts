import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LINKED_BANK_LIMITS, claimedBefore, combinedTotal, forgetLinkedBank, groupByLogin, joinAccounts, joinQualified, rememberLinkedBank, routeFor,
  sameLogin, sanitizeLinkedBanks,
} from './linked-banks.ts';
import type { SerializedAccount, SerializedBalance } from './fints-types';

const account = (accountNumber: string, over: Partial<SerializedAccount> = {}): SerializedAccount => ({
  accountNumber,
  iban: null,
  bic: null,
  currency: 'EUR',
  accountType: 'CheckingAccount',
  holder: 'Nino Becker',
  product: null,
  limit: null,
  canStatements: true,
  canBalance: true,
  canTransfer: true,
  canInstant: false,
  canPending: false,
  ...over,
});

const bal = (balance: number, over: Partial<SerializedBalance> = {}): SerializedBalance => ({
  balance, currency: 'EUR', date: '2026-10-06', availableAmount: null, ...over,
});

// ---------------------------------------------------------------------------
// Routing

test('an account a linked login brought goes through that login, every other through the primary', () => {
  const links = [
    { sessionId: 'spk', accountNumbers: ['111', '112'] },
    { sessionId: 'dkb', accountNumbers: ['900'] },
  ];
  assert.equal(routeFor('111', 'vb', links), 'spk');
  assert.equal(routeFor('900', 'vb', links), 'dkb');
  assert.equal(routeFor('0105593271', 'vb', links), 'vb');
});

test('an account of a linked login that has ended has no route — never the primary as a stand-in', () => {
  const links = [{ sessionId: null, accountNumbers: ['111'] }];
  assert.equal(routeFor('111', 'vb', links), null);
  assert.equal(routeFor('222', 'vb', links), 'vb');
});

test('without a primary session nothing has a route but a live linked login', () => {
  assert.equal(routeFor('222', null, [{ sessionId: 'spk', accountNumbers: ['111'] }]), null);
  assert.equal(routeFor('111', null, [{ sessionId: 'spk', accountNumbers: ['111'] }]), 'spk');
});

// ---------------------------------------------------------------------------
// Joining

test('new numbers join; the same number with the same IBAN is the same account, shown once', () => {
  const shown = [account('1', { iban: 'DE02 1203 0000 0000 2020 51' }), account('2')];
  const incoming = [account('1', { iban: 'de02120300000000202051' }), account('3'), account('4')];
  const j = joinAccounts(shown, incoming);
  assert.deepEqual(j.added.map((a) => a.accountNumber), ['3', '4']);
  assert.deepEqual(j.shared.map((a) => a.accountNumber), ['1']);
  assert.deepEqual(j.collisions, []);
});

test('the same number under another IBAN — or without one to compare — is a collision', () => {
  const shown = [account('1', { iban: 'DE02120300000000202051' }), account('4930XXXXXXXX1234')];
  const incoming = [account('1', { iban: 'DE89370400440532013000' }), account('4930XXXXXXXX1234'), account('5')];
  const j = joinAccounts(shown, incoming);
  assert.deepEqual(j.collisions.map((c) => [c.incoming.accountNumber, c.shown.iban]), [
    ['1', 'DE02120300000000202051'],
    ['4930XXXXXXXX1234', null],
  ]);
  assert.deepEqual(j.added.map((a) => a.accountNumber), ['5']);
});

test('joinQualified: another IBAN, or another bank, joins under "number@BLZ"; one card two logins at one bank see stays a collision', () => {
  const shown = [account('1', { iban: 'DE02120300000000202051' }), account('4930XXXXXXXX1234'), account('9')];
  const blzOf = (a: { accountNumber: string }) => (a.accountNumber === '9' ? '50010517' : '12030000');
  // Another bank: the IBAN differs, the card is another bank's card.
  const other = joinQualified(shown, [account('1', { iban: 'DE89370400440532013000' }), account('4930XXXXXXXX1234'), account('5')], '37040044', blzOf);
  assert.deepEqual(other.added.map((a) => a.accountNumber), ['1@37040044', '4930XXXXXXXX1234@37040044', '5']);
  assert.deepEqual(other.collisions, []);
  // The same bank, a second login: the card without an IBAN may be the same card.
  const same = joinQualified(shown, [account('4930XXXXXXXX1234'), account('6')], '12030000', blzOf);
  assert.deepEqual(same.collisions.map((c) => c.incoming.accountNumber), ['4930XXXXXXXX1234']);
  // The same number and IBAN is still the one account, shown once.
  const shared = joinQualified(shown, [account('1', { iban: 'DE02120300000000202051' })], '37040044', blzOf);
  assert.deepEqual(shared.shared.map((a) => a.accountNumber), ['1']);
});

test('a number the bank lists twice is taken once', () => {
  const j = joinAccounts([], [account('7'), account('7', { product: 'again' })]);
  assert.equal(j.added.length, 1);
  assert.equal(j.added[0].product, null);
});

// ---------------------------------------------------------------------------
// Grouping and the Gesamtsaldo

test('groups follow the logins: the primary first, then each linked bank in order', () => {
  const accounts = [account('1'), account('2'), account('s1'), account('d1'), account('s2')];
  const groups = groupByLogin(accounts, [
    { id: 'spk', accountNumbers: ['s1', 's2'] },
    { id: 'dkb', accountNumbers: ['d1'] },
    { id: 'empty', accountNumbers: [] },
  ]);
  assert.deepEqual(groups.map((g) => [g.id, g.accounts.map((a) => a.accountNumber)]), [
    [null, ['1', '2']],
    ['spk', ['s1', 's2']],
    ['dkb', ['d1']],
    ['empty', []],
  ]);
});

test('the Gesamtsaldo adds every bank\'s accounts once each is known', () => {
  const accounts = [account('1'), account('s1'), account('s2')];
  const t = combinedTotal(accounts, { 1: bal(1200), s1: bal(-50.5), s2: bal(3000) });
  assert.equal(t.cents, 414950);
  assert.deepEqual(t.absent, []);
});

test('one account of the second bank unknown: unvollständig, and that account is named', () => {
  const accounts = [account('1'), account('s1'), account('s2')];
  const t = combinedTotal(accounts, { 1: bal(1200), s1: bal(-50.5) });
  assert.equal(t.cents, null);
  assert.deepEqual(t.missing.map((a) => a.accountNumber), ['s2']);
});

test('a linked bank not logged in keeps the sum open, even with every listed balance known', () => {
  const t = combinedTotal([account('1'), account('2')], { 1: bal(10), 2: bal(20) }, ['Sparkasse KölnBonn']);
  assert.equal(t.cents, null);
  assert.deepEqual(t.missing, []);
  assert.deepEqual(t.absent, ['Sparkasse KölnBonn']);
});

test('currency rules hold across banks: another currency is excluded, never added', () => {
  const t = combinedTotal([account('1'), account('s1', { currency: 'USD' })], { 1: bal(10), s1: bal(99, { currency: 'USD' }) });
  assert.equal(t.cents, 1000);
  assert.deepEqual(t.excluded.map((e) => [e.account.accountNumber, e.reason]), [['s1', 'currency']]);
});

// ---------------------------------------------------------------------------
// What the vault keeps

test('a linked bank is kept as BLZ, name, login name and its account numbers — nothing else survives, a PIN least of all', () => {
  const out = sanitizeLinkedBanks([
    { blz: '37050198', name: '  Sparkasse\tKölnBonn ', userId: 'nino.becker', pin: '12345', accounts: ['1'], balance: 99 },
  ]);
  assert.deepEqual(out, [{ blz: '37050198', name: 'Sparkasse KölnBonn', userId: 'nino.becker', accounts: ['1'] }]);
  assert.equal(JSON.stringify(out).includes('12345'), false);
});

test('malformed entries are dropped, a login name is never clipped, each login is kept once', () => {
  const out = sanitizeLinkedBanks([
    { blz: '3705019', name: 'Kurz', userId: 'a' },
    { blz: '37050198x', name: 'Lang', userId: 'a' },
    { blz: '37050198', name: '', userId: 'a' },
    { blz: '37050198', name: 'Sparkasse', userId: '' },
    { blz: '37050198', name: 'Sparkasse', userId: 'x'.repeat(65) },
    { blz: '37050198', name: 'Sparkasse', userId: 'a\nb' },
    { blz: '37050198', name: 'Sparkasse', userId: 'nino' },
    { blz: '37050198', name: 'Sparkasse (again)', userId: 'nino' },
    { blz: '37050198', name: 'Sparkasse', userId: 'Nino' },
    'nonsense',
    null,
  ]);
  assert.deepEqual(out.map((r) => r.userId), ['nino', 'Nino']);
  assert.equal(out[0].name, 'Sparkasse');
  assert.deepEqual(sanitizeLinkedBanks('nope'), []);
  assert.deepEqual(sanitizeLinkedBanks(undefined), []);
});

test(`at most ${LINKED_BANK_LIMITS.count} linked banks, names clipped to one line`, () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ blz: String(10000000 + i), name: `Bank ${i} ${'x'.repeat(200)}`, userId: 'u' }));
  const out = sanitizeLinkedBanks(many);
  assert.equal(out.length, LINKED_BANK_LIMITS.count);
  assert.equal(Array.from(out[0].name).length, LINKED_BANK_LIMITS.name);
});

test('remembering adds a login once and keeps its name current; forgetting takes exactly that login', () => {
  const spk = { blz: '37050198', name: 'Sparkasse KölnBonn', userId: 'nino' };
  let list = rememberLinkedBank([], spk);
  list = rememberLinkedBank(list, { ...spk, name: 'Sparkasse KölnBonn (neu)' });
  list = rememberLinkedBank(list, { blz: '12030000', name: 'DKB', userId: 'nino' });
  assert.deepEqual(list.map((r) => [r.blz, r.name]), [['37050198', 'Sparkasse KölnBonn (neu)'], ['12030000', 'DKB']]);
  assert.ok(sameLogin(list[0], spk));
  assert.deepEqual(forgetLinkedBank(list, spk).map((r) => r.blz), ['12030000']);
  assert.deepEqual(forgetLinkedBank(list, { blz: '37050198', userId: 'other' }).length, 2);
});

test('the bank added first keeps a plain number, however the logins come in', () => {
  const list = sanitizeLinkedBanks([
    { blz: '37040044', name: 'Commerzbank', userId: 'a', accounts: ['123', '555'] },
    { blz: '50010517', name: 'ING', userId: 'b', accounts: ['123'] },
  ]);
  // ING logs in first, Commerzbank not on screen: ING's 123 is still ING's "123@BLZ".
  const ing = joinQualified([], [account('123', { iban: 'DE10500105170000000123' })], '50010517', () => null, claimedBefore(list, { blz: '50010517', userId: 'b' }));
  assert.deepEqual(ing.added.map((a) => a.accountNumber), ['123@50010517']);
  // Then Commerzbank: the plain 123 is its own.
  const cb = joinQualified(ing.added, [account('123', { iban: 'DE20370400440000000123' })], '37040044', () => '50010517', claimedBefore(list, { blz: '37040044', userId: 'a' }));
  assert.deepEqual(cb.added.map((a) => a.accountNumber), ['123']);
  assert.deepEqual(cb.collisions, []);
  // A bank not remembered yet comes after every remembered one.
  assert.deepEqual([...claimedBefore(list, { blz: '12030000', userId: 'c' })], [['123', '37040044'], ['555', '37040044']]);
});

test('remembering a bank keeps its place and brings its accounts up to date', () => {
  const list = sanitizeLinkedBanks([
    { blz: '37040044', name: 'Commerzbank', userId: 'a', accounts: ['1'] },
    { blz: '50010517', name: 'ING', userId: 'b' },
  ]);
  const next = rememberLinkedBank(list, { blz: '37040044', name: 'Commerzbank', userId: 'a', accounts: ['1', '2'] });
  assert.deepEqual(next.map((r) => [r.userId, r.accounts]), [['a', ['1', '2']], ['b', undefined]]);
  assert.deepEqual(rememberLinkedBank(next, { blz: '37040044', name: 'Commerzbank', userId: 'a' })[0].accounts, ['1', '2'], 'no accounts given: kept');
  assert.deepEqual(sanitizeLinkedBanks([{ blz: '37040044', name: 'X', userId: 'a', accounts: ['1', 1, '', '1', 'x\u0007'] }])[0].accounts, ['1']);
});
