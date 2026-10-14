import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LINKED_BANK_LIMITS, combinedTotal, forgetLinkedBank, groupByLogin, joinAccounts, rememberLinkedBank, routeFor,
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

test('a linked bank is kept as BLZ, name and login name — nothing else survives, a PIN least of all', () => {
  const out = sanitizeLinkedBanks([
    { blz: '37050198', name: '  Sparkasse\tKölnBonn ', userId: 'nino.becker', pin: '12345', accounts: ['1'] },
  ]);
  assert.deepEqual(out, [{ blz: '37050198', name: 'Sparkasse KölnBonn', userId: 'nino.becker' }]);
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
