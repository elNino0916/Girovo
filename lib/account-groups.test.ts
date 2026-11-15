import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OWN_GROUP_LIMITS, REST_GROUP, addGroup, cleanGroupName, deleteGroup, frameOrder, groupsFromKinds, moveGroup, moveIntoGroup,
  keyOrder, nextGroupId, ownGroupFigure, ownGroupsOf, renameGroup, reorderGroup, sanitizeFolded, sanitizeOwnGroups, toggleFolded,
  type OwnGroup,
} from './account-groups.ts';
import { MAX_ORDER, type AccountGroupKind, type AccountValue } from './account-overview.ts';

const g = (id: string, name: string, accounts: string[]): OwnGroup => ({ id, name, accounts });

test('sanitizeOwnGroups: well-formed groups kept, each account in one group, the caps held', () => {
  assert.equal(sanitizeOwnGroups(undefined), null, 'no list: Eigene never chosen');
  assert.deepEqual(sanitizeOwnGroups([]), [], 'every group deleted stays an empty list');
  const out = sanitizeOwnGroups([
    { id: 'g1', name: '  Alltag\u2028 und\tmehr ', accounts: ['1', '2', '2', 3, ''] },
    { id: 'g1', name: 'Doppelt', accounts: [] },
    { id: 'rest', name: 'Weitere', accounts: [] },
    { id: 'Bad Id', name: 'X', accounts: [] },
    { id: 'g2', name: '   ', accounts: [] },
    { id: 'g3', name: 'Rücklagen', accounts: ['2', '4@12345678', 'x'.repeat(65)] },
    null,
  ]);
  assert.deepEqual(out, [g('g1', 'Alltag und mehr', ['1', '2']), g('g3', 'Rücklagen', ['4@12345678'])]);
  const many = sanitizeOwnGroups(Array.from({ length: 30 }, (_, i) => ({ id: `g${i}`, name: `G${i}`, accounts: [] })));
  assert.equal(many?.length, OWN_GROUP_LIMITS.groups);
  const keys = sanitizeOwnGroups([{ id: 'g1', name: 'A', accounts: Array.from({ length: 60 }, (_, i) => `k${i}`) }]);
  assert.equal(keys?.[0].accounts.length, MAX_ORDER);
});

test('cleanGroupName: one line within the cap', () => {
  assert.equal(cleanGroupName('a'.repeat(60)).length, OWN_GROUP_LIMITS.name);
  assert.equal(cleanGroupName('Reise\nkasse'), 'Reise kasse');
  assert.equal(cleanGroupName(42), '');
});

test('sanitizeFolded: only groups that are there, and Weitere Konten', () => {
  const groups = [g('g1', 'A', [])];
  assert.deepEqual(sanitizeFolded(['g1', 'g9', REST_GROUP, 'g1', 3], groups), ['g1', REST_GROUP]);
  assert.deepEqual(sanitizeFolded('g1', groups), []);
  assert.deepEqual(sanitizeFolded(['g1', REST_GROUP], null), [REST_GROUP]);
});

test('groupsFromKinds: Nach Art copied, its Weitere Konten left to the rest', () => {
  const names: Record<AccountGroupKind, string> = { giro: 'Girokonten', saving: 'Sparen & Anlegen', credit: 'Karten & Kredite', other: 'Weitere Konten' };
  const kinds: Record<string, AccountGroupKind> = { a: 'giro', b: 'saving', c: 'giro', d: 'other' };
  const out = groupsFromKinds(['c', 'b', 'a', 'd'], { kindOf: (k) => kinds[k], keyOf: (k) => k, names });
  assert.deepEqual(out, [g('giro', 'Girokonten', ['c', 'a']), g('saving', 'Sparen & Anlegen', ['b'])]);
  const shown = ownGroupsOf(['c', 'b', 'a', 'd'], out, (k) => k);
  assert.deepEqual(shown.map((x) => [x.id, x.accounts]), [['giro', ['c', 'a']], ['saving', ['b']], [REST_GROUP, ['d']]]);
});

test('add, rename, delete and move groups', () => {
  const start = [g('giro', 'Girokonten', ['a']), g('g1', 'Reise', ['b'])];
  assert.equal(nextGroupId(start), 'g2');
  const added = addGroup(start, '  Kinder ');
  assert.deepEqual(added, { groups: [...start, g('g2', 'Kinder', [])], id: 'g2' });
  assert.equal(addGroup(start, '   '), null);
  const full = Array.from({ length: OWN_GROUP_LIMITS.groups }, (_, i) => g(`g${i + 1}`, `G${i}`, []));
  assert.equal(addGroup(full, 'Eine mehr'), null);
  assert.equal(renameGroup(start, 'g1', 'Urlaub')[1].name, 'Urlaub');
  assert.equal(renameGroup(start, 'g1', ' ')[1].name, 'Reise', 'an empty name changes nothing');
  assert.deepEqual(moveGroup(start, 'g1', 0).map((x) => x.id), ['g1', 'giro']);
  assert.deepEqual(moveGroup(start, 'g1', 5), start);
  // A deleted group's accounts are in no group: Weitere Konten shows them.
  const after = deleteGroup(start, 'g1');
  assert.deepEqual(ownGroupsOf(['a', 'b'], after, (k) => k).map((x) => [x.id, x.accounts]), [['giro', ['a']], [REST_GROUP, ['b']]]);
});

test('moveIntoGroup: out of its group, into another before an account or at its end, or out of every group', () => {
  const start = [g('g1', 'A', ['a', 'b']), g('g2', 'B', ['c'])];
  assert.deepEqual(moveIntoGroup(start, 'a', 'g2'), [g('g1', 'A', ['b']), g('g2', 'B', ['c', 'a'])]);
  assert.deepEqual(moveIntoGroup(start, 'a', 'g2', 'c'), [g('g1', 'A', ['b']), g('g2', 'B', ['a', 'c'])]);
  assert.deepEqual(moveIntoGroup(start, 'b', 'g1', 'a'), [g('g1', 'A', ['b', 'a']), g('g2', 'B', ['c'])], 'within its group: another place');
  assert.deepEqual(moveIntoGroup(start, 'c', REST_GROUP), [g('g1', 'A', ['a', 'b']), g('g2', 'B', [])]);
  assert.deepEqual(moveIntoGroup(start, 'z', 'g2'), [g('g1', 'A', ['a', 'b']), g('g2', 'B', ['c', 'z'])], 'an account in no group joins one');
  assert.deepEqual(moveIntoGroup(start, 'a', 'g9'), start, 'an unknown group changes nothing');
  const full = [g('g1', 'A', Array.from({ length: MAX_ORDER }, (_, i) => `k${i}`)), g('g2', 'B', [])];
  assert.deepEqual(moveIntoGroup(full, 'new', 'g2'), full, 'one key more than the cap is refused');
  assert.equal(moveIntoGroup(full, 'k1', 'g2')[1].accounts[0], 'k1', 'a member moves at the cap');
});

test('an account not on screen keeps its group and its place, and is back there when it returns', () => {
  const groups = [g('g1', 'Alltag', ['a', 'gone@38069999', 'b'])];
  // The further bank is not logged in: its account is not shown, and in no other group.
  const away = ownGroupsOf(['b', 'a'], groups, (k) => k);
  assert.deepEqual(away.map((x) => [x.id, x.accounts]), [['g1', ['a', 'b']]]);
  // The two shown swap places; the absent one keeps its slot.
  const swapped = reorderGroup(groups, 'g1', ['b', 'a']);
  assert.deepEqual(swapped[0].accounts, ['b', 'gone@38069999', 'a']);
  const back = ownGroupsOf(['a', 'b', 'gone@38069999'], swapped, (k) => k);
  assert.deepEqual(back.map((x) => [x.id, x.accounts]), [['g1', ['b', 'gone@38069999', 'a']]]);
});

test('ownGroupsOf: an empty group is shown, Weitere Konten only with accounts, in the order given', () => {
  const groups = [g('g1', 'Leer', []), g('g2', 'B', ['c'])];
  const shown = ownGroupsOf(['a', 'b', 'c'], groups, (k) => k);
  assert.deepEqual(shown.map((x) => [x.id, x.name, x.accounts]), [['g1', 'Leer', []], ['g2', 'B', ['c']], [REST_GROUP, null, ['a', 'b']]]);
  assert.deepEqual(ownGroupsOf(['c'], groups, (k) => k).map((x) => x.id), ['g1', 'g2']);
});

test('frameOrder: group by group with Eigene, the user\'s order without', () => {
  const accounts = ['1', '2', '3', '4'].map((accountNumber) => ({ accountNumber }));
  const v = { accountOrder: ['4', '3', '2', '1'], accountGroups: [g('g1', 'A', ['2', '4'])] };
  assert.deepEqual(frameOrder(accounts, v).map((a) => a.accountNumber), ['4', '3', '2', '1']);
  assert.deepEqual(frameOrder(accounts, { ...v, accountGroupsOn: true }).map((a) => a.accountNumber), ['2', '4', '3', '1']);
});

test('toggleFolded: folds and unfolds', () => {
  assert.deepEqual(toggleFolded([], 'g1'), ['g1']);
  assert.deepEqual(toggleFolded(['g1', REST_GROUP], 'g1'), [REST_GROUP]);
});

test('keyOrder: the keys 1 to 9 count the accounts on screen, a folded group\'s left out', () => {
  const accounts = [{ accountNumber: 'a' }, { accountNumber: 'b' }, { accountNumber: 'c' }, { accountNumber: 'd' }];
  const v = {
    accountGroupsOn: true as const,
    accountGroups: [{ id: 'g1', name: 'Alltag', accounts: ['b', 'a'] }, { id: 'g2', name: 'Sparen', accounts: ['c'] }],
    accountGroupsFolded: ['g1'],
  };
  assert.deepEqual(keyOrder(accounts, v).map((x) => x.accountNumber), ['c', 'd']);
  assert.deepEqual(frameOrder(accounts, v).map((x) => x.accountNumber), ['b', 'a', 'c', 'd']);
  assert.deepEqual(keyOrder(accounts, { ...v, accountGroupsFolded: [] }).map((x) => x.accountNumber), ['b', 'a', 'c', 'd']);
  // "Weitere Konten" folded too: nothing left for the keys.
  assert.deepEqual(keyOrder(accounts, { ...v, accountGroupsFolded: ['g1', 'g2', REST_GROUP] }).map((x) => x.accountNumber), []);
  // Without "Eigene" the folds say nothing.
  assert.deepEqual(keyOrder(accounts, { accountGroupsFolded: ['g1'] }).map((x) => x.accountNumber), ['a', 'b', 'c', 'd']);
});

test('ownGroupFigure: the Gesamtsaldo\'s rules for a group head', () => {
  const values: Record<string, AccountValue> = {
    giro: { state: 'known', cents: 120_000, currency: 'EUR' },
    tg: { state: 'known', cents: 500_000, currency: 'EUR', kept: true },
    usd: { state: 'known', cents: 184_025, currency: 'USD' },
    bauspar: { state: 'never' },
    open: { state: 'missing', currency: 'EUR' },
  };
  const valueOf = (k: string) => values[k];
  const none = () => false;
  // Another currency and an account without a figure are left out and named.
  const f = ownGroupFigure(['giro', 'tg', 'usd', 'bauspar'], valueOf, none);
  assert.equal(f.sum, 620_000);
  assert.equal(f.open, false);
  assert.deepEqual(f.excluded.map((e) => [e.account, e.reason, e.currency]), [['usd', 'currency', 'USD'], ['bauspar', 'unsupported', '']]);
  // A missing figure keeps the sum open: no part sum.
  const open = ownGroupFigure(['giro', 'open'], valueOf, none);
  assert.deepEqual([open.sum, open.open], [null, true]);
  // A hidden account does not count, missing or not.
  assert.equal(ownGroupFigure(['giro', 'open'], valueOf, (k) => k === 'open').sum, 120_000);
  // Nothing in euros to add: no sum, only what it leaves out.
  const usd = ownGroupFigure(['usd'], valueOf, none);
  assert.deepEqual([usd.sum, usd.excluded.length], [null, 1]);
  assert.equal(ownGroupFigure([], valueOf, none).sum, null);
  // A bank not logged in: its kept balances count, as in the Gesamtsaldo, even with nothing else on screen.
  assert.equal(ownGroupFigure(['giro'], valueOf, none, [{ cents: 30_000 }]).sum, 150_000);
  assert.equal(ownGroupFigure([], valueOf, none, [{ cents: -5_000 }]).sum, -5_000);
});
