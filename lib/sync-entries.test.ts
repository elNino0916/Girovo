import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_VAULT, type VaultData } from './app-types.ts';
import { hashOf, mergeEntries, restamp, stableJson, TOMBSTONE_MS, vaultEntries, vaultFromEntries } from './sync-entries.ts';

const vault = (extra: Partial<VaultData> = {}): VaultData => ({ ...EMPTY_VAULT, ...extra });

test('stableJson and hashOf ignore key order', () => {
  assert.equal(stableJson({ b: 1, a: [2, { d: 3, c: 4 }] }), '{"a":[2,{"c":4,"d":3}],"b":1}');
  assert.equal(hashOf({ a: 1, b: 2 }), hashOf({ b: 2, a: 1 }));
});

test('a vault round-trips through its entries, with what a device keeps for itself from the base', () => {
  const v = vault({
    notes: { 'k1': 'Geschenk' },
    aliases: { DE01: 'Haushalt' },
    templates: [{ id: 't1', label: 'Miete', name: 'Vermieter', iban: 'DE02', createdAt: '2026-01-01T00:00:00Z' }],
    dismissedRecurring: ['r1'],
    goals: [{ accountNumber: 'DE03', name: 'Urlaub', target: 100000 }],
    accountGrouping: 'bank',
    accountOrder: ['DE03', 'DE01'],
    keepBookings: true,
  });
  const entries = vaultEntries(v);
  assert.equal(entries.get('notes/k1'), 'Geschenk');
  assert.equal(entries.get('dismissedRecurring/r1'), true);
  assert.ok(!entries.has('keepBookings'));
  const back = vaultFromEntries(entries, v);
  assert.deepEqual(back, v);
  // The other device keeps its own choice about keeping Umsätze.
  assert.equal(vaultFromEntries(entries, vault()).keepBookings, undefined);
});

test('restamp: a changed entry is now, an unchanged one keeps its time, a gone one is a tombstone', () => {
  const stamps = restamp(new Map([['notes/a', 'x'], ['notes/b', 'y']]), {}, 100);
  const next = restamp(new Map([['notes/a', 'x'], ['notes/c', 'z']]), { ...stamps }, 200);
  assert.deepEqual(next['notes/a'], { h: hashOf('x'), t: 100 });
  assert.deepEqual(next['notes/b'], { h: '-', t: 200 });
  assert.deepEqual(next['notes/c'], { h: hashOf('z'), t: 200 });
  // An old tombstone is forgotten.
  assert.equal(restamp(new Map(), next, 200 + TOMBSTONE_MS)['notes/b'], undefined);
});

test('merge: the newest change wins per entry, deletions included', () => {
  const local = new Map<string, unknown>([['notes/a', 'mine, older'], ['notes/b', 'mine, newer']]);
  const stamps = { 'notes/a': { h: hashOf('mine, older'), t: 100 }, 'notes/b': { h: hashOf('mine, newer'), t: 300 }, 'notes/c': { h: '-', t: 400 } };
  const remote = {
    device: 'phone',
    entries: {
      'notes/a': { t: 200, v: 'theirs, newer' },
      'notes/b': { t: 250, v: 'theirs, older' },
      'notes/c': { t: 350, v: 'deleted here later' },
      'notes/d': { t: 50, v: 'only theirs' },
      'notes/e': { t: 60, d: 1 as const },
    },
  };
  const m = mergeEntries(local, stamps, 'desk', [remote], 1000);
  assert.equal(m.entries.get('notes/a'), 'theirs, newer');
  assert.equal(m.entries.get('notes/b'), 'mine, newer');
  assert.equal(m.entries.has('notes/c'), false);
  assert.equal(m.entries.get('notes/d'), 'only theirs');
  assert.equal(m.entries.has('notes/e'), false);
  assert.deepEqual(m.state['notes/c'], { t: 400, d: 1 });
  assert.deepEqual(m.stamps['notes/a'], { h: hashOf('theirs, newer'), t: 200 });
});

test('merge: a tie goes to the larger device id, the same on both sides', () => {
  const mine = mergeEntries(new Map([['avatar', 'leaf']]), { avatar: { h: hashOf('leaf'), t: 5 } }, 'aaa', [{ device: 'bbb', entries: { avatar: { t: 5, v: 'sun' } } }], 10);
  const theirs = mergeEntries(new Map([['avatar', 'sun']]), { avatar: { h: hashOf('sun'), t: 5 } }, 'bbb', [{ device: 'aaa', entries: { avatar: { t: 5, v: 'leaf' } } }], 10);
  assert.equal(mine.entries.get('avatar'), 'sun');
  assert.equal(theirs.entries.get('avatar'), 'sun');
});

test('merge then round-trip: two devices end with the same vault', () => {
  const a = vault({ notes: { k1: 'A' }, budgets: { groceries: 30000 } });
  const b = vault({ notes: { k2: 'B' }, aliases: { DE01: 'Konto' } });
  const sa = restamp(vaultEntries(a), {}, 100);
  const sb = restamp(vaultEntries(b), {}, 200);
  const ma = mergeEntries(vaultEntries(a), sa, 'a', [], 300);
  const mb = mergeEntries(vaultEntries(b), sb, 'b', [{ device: 'a', entries: ma.state }], 300);
  const ma2 = mergeEntries(vaultEntries(a), sa, 'a', [{ device: 'b', entries: mb.state }], 400);
  const va = vaultFromEntries(ma2.entries, a);
  const vb = vaultFromEntries(mb.entries, b);
  assert.deepEqual(va.notes, { k1: 'A', k2: 'B' });
  assert.deepEqual(stableJson({ ...va, updatedAt: '' }), stableJson({ ...vb, updatedAt: '' }));
});

test('restamp and merge: a copy kept changed (k) keeps its stamp and loses a tie to the original, on every device', () => {
  const given = { h: hashOf('Notiz [neu]'), t: 5, k: hashOf('Notiz') };
  // Held as kept: unchanged. Held as given again: unchanged, without k. Anything else: changed now.
  assert.equal(restamp(new Map([['notes/a', 'Notiz']]), { 'notes/a': given }, 100)['notes/a'], given);
  assert.deepEqual(restamp(new Map([['notes/a', 'Notiz [neu]']]), { 'notes/a': given }, 100)['notes/a'], { h: hashOf('Notiz [neu]'), t: 5 });
  assert.deepEqual(restamp(new Map([['notes/a', 'anders']]), { 'notes/a': given }, 100)['notes/a'], { h: hashOf('anders'), t: 100 });
  // The original wins the tie whichever id is larger; the copy's own stamp stays as it was.
  for (const [mine, theirs] of [['aaa', 'zzz'], ['zzz', 'aaa']]) {
    const m = mergeEntries(new Map([['notes/a', 'Notiz']]), { 'notes/a': given }, mine, [{ device: theirs, entries: { 'notes/a': { t: 5, v: 'Notiz [neu]' } } }], 10);
    assert.equal(m.entries.get('notes/a'), 'Notiz [neu]');
    assert.deepEqual(m.state['notes/a'], { t: 5, v: 'Notiz [neu]' });
    const o = mergeEntries(new Map([['notes/a', 'Notiz [neu]']]), { 'notes/a': { h: hashOf('Notiz [neu]'), t: 5 } }, theirs, [{ device: mine, entries: { 'notes/a': { t: 5, v: 'Notiz', k: 1 } } }], 10);
    assert.equal(o.entries.get('notes/a'), 'Notiz [neu]');
  }
  // With no original left, the copy stands — marked as one in the state.
  const alone = mergeEntries(new Map([['notes/a', 'Notiz']]), { 'notes/a': given }, 'aaa', [], 10);
  assert.deepEqual(alone.state['notes/a'], { t: 5, v: 'Notiz', k: 1 });
  assert.equal(alone.stamps['notes/a'], given);
});
