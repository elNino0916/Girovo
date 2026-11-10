import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_VAULT, type VaultData } from './app-types.ts';
import { migrateBookingKeys } from './booking-keys.ts';
import { legacyTxKey, txKey } from './categories.ts';
import type { SerializedTransaction } from './fints-types';
import { hashOf, mergeEntries, restamp, stableJson, TOMBSTONE_MS, vaultEntries, vaultFromEntries } from './sync-entries.ts';
import type { RemoteState, Stamps } from './sync-entries.ts';

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

// ---- a booking's entries moved to its new key (lib/booking-keys.ts) ----------------

/** One device of a group: its vault, its stamps, and the state file it last wrote. */
type Device = { id: string; vault: VaultData; stamps: Stamps; state: RemoteState['entries'] };
const device = (id: string, v: VaultData): Device => ({ id, vault: v, stamps: {}, state: {} });
/** One round as lib/sync.ts runs it: restamp, merge with the others' state files, keep the result. */
function round(d: Device, others: readonly Device[], now: number): void {
  const entries = vaultEntries(d.vault);
  const m = mergeEntries(entries, restamp(entries, d.stamps, now), d.id, others.map((o) => ({ device: o.id, entries: o.state })), now);
  d.vault = vaultFromEntries(m.entries, d.vault);
  d.stamps = m.stamps;
  d.state = m.state;
}
const perBooking = (v: VaultData) => ({ txCategories: v.txCategories, splits: v.splits, notes: v.notes });

// MT940, fetched on German time: midnight of 1 November. Its key before named 31 October.
const moved = {
  entryDate: '2026-10-31T23:00:00.000Z', valueDate: '2026-10-31T23:00:00.000Z', amount: -12.9,
  remoteIban: 'DE02120300000000202051', remoteName: 'REWE', e2eReference: 'E1', bankReference: '',
} as SerializedTransaction;
const OLD = legacyTxKey(moved);
const NEW = txKey(moved);
const SPLIT = [{ id: 'groceries' as const, cents: 800 }, { id: 'leisure' as const, cents: 490 }];
const filed = (): VaultData => vault({ txCategories: { [OLD]: 'leisure' }, splits: { [OLD]: SPLIT }, notes: { [OLD]: 'Geschenk', other: 'bleibt' } });
const AFTER = { txCategories: { [NEW]: 'leisure' }, splits: { [NEW]: SPLIT }, notes: { [NEW]: 'Geschenk', other: 'bleibt' } };

test('the keys of the moved booking: the old one without the mark, the new one with it and the bank’s day', () => {
  assert.equal(OLD, '2026-10-31|-12.90|DE02120300000000202051|E1');
  assert.equal(NEW, 'd2|2026-11-01|-12.90|DE02120300000000202051|E1');
});

test('a moved entry: the device that moved it hands the others the new key and a deletion of the old', () => {
  const [a, b] = [device('aaa', filed()), device('bbb', filed())];
  round(a, [], 100);
  round(b, [a], 110);
  round(a, [b], 120);

  a.vault = migrateBookingKeys(a.vault, [moved]);
  round(a, [b], 200);
  assert.deepEqual(perBooking(a.vault), AFTER);
  assert.deepEqual(a.state[`notes/${OLD}`], { t: 200, d: 1 });
  assert.deepEqual(a.state[`notes/${NEW}`], { t: 200, v: 'Geschenk' });

  // A device that has not moved anything (its bookings not loaded, or an
  // older version): the round brings the move. Nothing is left under the old key.
  round(b, [a], 300);
  assert.deepEqual(perBooking(b.vault), AFTER);
  assert.equal(migrateBookingKeys(b.vault, [moved]), b.vault, 'nothing left to move');
});

test('two devices move the same entry, one after the other: one entry, the same on both, and it stays', () => {
  const [a, b] = [device('aaa', filed()), device('bbb', filed())];
  round(a, [], 100);
  round(b, [a], 110);
  round(a, [b], 120);

  // A moves and syncs; B, not having met A since, moves on its own and syncs later.
  a.vault = migrateBookingKeys(a.vault, [moved]);
  round(a, [b], 200);
  b.vault = migrateBookingKeys(b.vault, [moved]);
  assert.deepEqual(perBooking(b.vault), AFTER, 'both make the same key and value of it');
  round(b, [a], 300);
  round(a, [b], 400);
  round(b, [a], 500);

  for (const d of [a, b]) {
    assert.deepEqual(perBooking(d.vault), AFTER, d.id);
    // The new entry stands above the deletion of the old one: live, with a time of its own.
    for (const field of ['txCategories', 'splits', 'notes']) {
      assert.equal(d.state[`${field}/${OLD}`]?.d, 1, `${d.id} ${field}`);
      assert.equal(d.state[`${field}/${NEW}`]?.d, undefined, `${d.id} ${field}`);
      assert.ok(d.state[`${field}/${NEW}`].t >= 200, `${d.id} ${field}`);
    }
  }
  assert.equal(stableJson({ ...a.vault, updatedAt: '' }), stableJson({ ...b.vault, updatedAt: '' }));
  assert.deepEqual(a.state, b.state);

  // A third device that comes back after all that, still with the old key, and moves too.
  const c = device('ccc', filed());
  c.stamps = restamp(vaultEntries(c.vault), {}, 100);
  c.vault = migrateBookingKeys(c.vault, [moved]);
  round(c, [a, b], 600);
  round(a, [b, c], 700);
  assert.deepEqual(perBooking(c.vault), AFTER);
  assert.deepEqual(perBooking(a.vault), AFTER);
});

test('a moved entry is not lost to a deletion its new key once had', () => {
  // Another device moved this entry and then took it off again (the user
  // unfiled the booking there): a deletion of the very path the move makes.
  // A move made later stands; one made by a clock behind it still comes after.
  const b = device('bbb', filed());
  round(b, [], 100);
  const other: Device = { id: 'aaa', vault: vault(), stamps: {}, state: { [`notes/${NEW}`]: { t: 150, d: 1 } } };
  b.vault = migrateBookingKeys(b.vault, [moved]);
  round(b, [other], 300);
  assert.equal(b.vault.notes[NEW], 'Geschenk');
  // And once this device knows that deletion, a move made by a clock that runs behind still comes after it.
  const late = device('ddd', filed());
  late.stamps = { ...restamp(vaultEntries(late.vault), {}, 100), [`notes/${NEW}`]: { h: '-', t: 5000 } };
  late.vault = migrateBookingKeys(late.vault, [moved]);
  round(late, [], 300);
  assert.equal(late.vault.notes[NEW], 'Geschenk');
  assert.equal(late.state[`notes/${NEW}`].t, 5001);
});

test('the round first, then the move: what another device changed since its own move stands', () => {
  const [a, b] = [device('aaa', filed()), device('bbb', filed())];
  round(a, [], 100);
  round(b, [a], 110);
  round(a, [b], 120);
  a.vault = migrateBookingKeys(a.vault, [moved]);
  round(a, [b], 200);
  // On A the note is rewritten and the category taken back, under the new key.
  a.vault = { ...a.vault, notes: { ...a.vault.notes, [NEW]: 'Geschenk für Mama' }, txCategories: {} };
  round(a, [b], 250);
  // B, as the provider does it: a round before anything is moved.
  round(b, [a], 300);
  b.vault = migrateBookingKeys(b.vault, [moved]);
  round(b, [a], 310);
  round(a, [b], 400);
  for (const d of [a, b]) {
    assert.equal(d.vault.notes[NEW], 'Geschenk für Mama', d.id);
    assert.deepEqual(d.vault.txCategories, {}, d.id);
    assert.equal(d.vault.notes[OLD], undefined, d.id);
  }
});
