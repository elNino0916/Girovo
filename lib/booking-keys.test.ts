import './__fixtures__/tz.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMPTY_VAULT, type VaultData } from './app-types.ts';
import {
  BOOKING_KEY_MAX, BOOKING_MAPS, dropKeys, isLegacyKey, keyMoves, legacyKeysOf, migrateBookingKeys, moveEntries, planMoves, receiptMoves,
  movesInVault, VAULT_MAX_BYTES, type EntryStamp,
} from './booking-keys.ts';
import { NOTE_LIMITS } from './notes.ts';
import { KEY_MARK, legacyTxKey, txKey } from './categories.ts';
import type { SerializedTransaction } from './fints-types';
import { addDaysKey } from './format.ts';

// What was filed under the key before — category, split, note, receipt — is
// found under the key a booking has now, and nothing lands on another booking.

const ZONES = ['Europe/Berlin', 'UTC', 'America/New_York', 'Asia/Tokyo'];

function inZone<T>(zone: string, fn: () => T): T {
  const was = process.env.TZ;
  process.env.TZ = zone;
  try {
    return fn();
  } finally {
    process.env.TZ = was;
  }
}

const parts = (day: string) => day.split('-').map(Number) as [number, number, number];
const midnight = (day: string) => { const [y, m, d] = parts(day); return new Date(y, m - 1, d).toISOString(); };
const noon = (day: string) => { const [y, m, d] = parts(day); return new Date(y, m - 1, d, 12).toISOString(); };

type Tx = SerializedTransaction;
const booking = (entryDate: string, over: Partial<Tx> = {}) => ({
  entryDate, valueDate: entryDate, amount: -12.9, currency: 'EUR', remoteIban: 'DE02120300000000202051', remoteName: 'REWE',
  e2eReference: 'E1', bankReference: 'B1', ...over,
}) as Tx;
/** A card payment without a reference: nothing but the day tells two of them apart. */
const card = (entryDate: string, over: Partial<Tx> = {}) => booking(entryDate, { remoteIban: '', remoteName: 'BAECKEREI KORN', e2eReference: '', bankReference: '', amount: -3.4, ...over });

const SPLIT = [{ id: 'groceries' as const, cents: 800 }, { id: 'leisure' as const, cents: 490 }];
/** A vault with a category, a split and a note under `key`. */
const filedUnder = (key: string, note = 'Geschenk für Mama'): VaultData => ({
  ...EMPTY_VAULT, txCategories: { [key]: 'leisure' }, splits: { [key]: SPLIT }, notes: { [key]: note },
});
const at = (v: VaultData, key: string) => ({ category: v.txCategories[key], split: v.splits[key], note: v.notes[key] });
const FILED = { category: 'leisure', split: SPLIT, note: 'Geschenk für Mama' };
const NOTHING = { category: undefined, split: undefined, note: undefined };

const DAYS = [
  '2026-01-01', '2025-12-31', '2026-03-28', '2026-03-29', '2026-03-30', '2026-07-15',
  '2026-10-24', '2026-10-25', '2026-10-26', '2026-11-01', '2024-02-29',
];

test('the maps moved are the vault’s maps by booking: every field its type says is keyed by txKey', () => {
  assert.deepEqual([...BOOKING_MAPS], ['txCategories', 'splits', 'notes']);
  // Read from the source, like lib/vault-fields.test.ts: a map added later and keyed by txKey must be moved too.
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'app-types.ts'), 'utf8').replace(/\r\n/g, '\n');
  const start = src.indexOf('export type VaultData = {');
  assert.ok(start >= 0, 'VaultData not found');
  const body = src.slice(start, src.indexOf('\n};', start));
  const keyed = [...body.matchAll(/((?:^ {2}(?:\/\*\*| \*).*\n)+)^ {2}([A-Za-z]+)\??:/gm)]
    .filter((m) => m[1].includes('txKey'))
    .map((m) => m[2]);
  assert.deepEqual(keyed.sort(), [...BOOKING_MAPS].sort());
});

test('MT940 on German time: what was filed under the day before is found under the bank’s day', () => {
  for (const d of DAYS) {
    const tx = booking(midnight(d));
    const old = legacyTxKey(tx);
    assert.equal(old, `${addDaysKey(d, -1)}|-12.90|DE02120300000000202051|E1`, d);
    const before = filedUnder(old);
    const after = migrateBookingKeys(before, [tx]);
    assert.deepEqual(at(after, txKey(tx)), FILED, d);
    assert.deepEqual(at(after, old), NOTHING, d);
    assert.equal(txKey(tx), `d2|${d}|-12.90|DE02120300000000202051|E1`, d);
    // Once more changes nothing — and says so by handing the same object back.
    assert.equal(migrateBookingKeys(after, [tx]), after, d);
    // The freshly fetched copy, with its day stated, is the same booking.
    assert.deepEqual(at(after, txKey({ ...tx, bankDay: d })), FILED, d);
    assert.equal(migrateBookingKeys(before, [{ ...tx, bankDay: d }]).notes[txKey(tx)], FILED.note, d);
  }
});

test('camt and a bare day: the same day, and the entry takes the mark', () => {
  for (const d of DAYS) {
    for (const tx of [booking(noon(d)), booking(d), booking(noon(d), { bankDay: d })]) {
      assert.equal(txKey(tx), KEY_MARK + legacyTxKey(tx), d);
      const after = migrateBookingKeys(filedUnder(legacyTxKey(tx)), [tx]);
      assert.deepEqual(at(after, txKey(tx)), FILED, d);
      assert.deepEqual(at(after, legacyTxKey(tx)), NOTHING, d);
      assert.equal(migrateBookingKeys(after, [tx]), after, d);
    }
  }
});

test('a key with the mark is never one from before, a key without it always is', () => {
  const tx = booking(midnight('2026-11-01'));
  assert.equal(isLegacyKey(legacyTxKey(tx)), true);
  assert.equal(isLegacyKey(legacyTxKey(booking(''))), true);
  assert.equal(isLegacyKey(txKey(tx)), false);
  assert.equal(isLegacyKey(txKey(booking(''))), false);
  // An entry already under a key with the mark is never moved, whatever bookings are known.
  const v = filedUnder(txKey(tx));
  assert.equal(migrateBookingKeys(v, [tx, booking(noon('2026-11-01')), booking(midnight('2026-11-02'))]), v);
});

test('one bank day, three shapes: after the move all three find the same entry', () => {
  for (const d of DAYS) {
    const [mt940, camt, bare] = [booking(midnight(d)), booking(noon(d)), booking(d)];
    assert.equal(txKey(mt940), txKey(camt), d);
    assert.equal(txKey(camt), txKey(bare), d);
    // Filed while the booking came as MT940; the two other shapes are no other booking.
    const after = migrateBookingKeys(filedUnder(legacyTxKey(mt940)), [mt940, camt, bare]);
    for (const tx of [mt940, camt, bare]) assert.deepEqual(at(after, txKey(tx)), FILED, d);
  }
});

test('kept on German time, read elsewhere: the same move on every time', () => {
  for (const d of DAYS) {
    const kept = inZone('Europe/Berlin', () => booking(midnight(d)));
    const before = inZone('Europe/Berlin', () => filedUnder(legacyTxKey(kept)));
    const home = inZone('Europe/Berlin', () => migrateBookingKeys(before, [kept]));
    for (const zone of ZONES) {
      inZone(zone, () => {
        const after = migrateBookingKeys(before, [kept]);
        assert.deepEqual(after, home, `${d} in ${zone}`);
        assert.deepEqual(at(after, txKey(kept)), FILED, `${d} in ${zone}`);
        // What this device fetches now carries the bank's day, and finds it too.
        assert.deepEqual(at(after, txKey(booking(midnight(d), { bankDay: d }))), FILED, `${d} fetched in ${zone}`);
        assert.deepEqual(at(after, txKey(booking(noon(d), { bankDay: d }))), FILED, `${d} fetched as camt in ${zone}`);
      });
    }
  }
});

test('nothing to move: the same object, so nothing is saved', () => {
  const tx = booking(midnight('2026-11-01'));
  assert.equal(migrateBookingKeys(EMPTY_VAULT, [tx]), EMPTY_VAULT);
  assert.equal(migrateBookingKeys(EMPTY_VAULT, []), EMPTY_VAULT);
  const other = filedUnder('2026-05-05|-1.00|X|');
  assert.equal(migrateBookingKeys(other, [tx]), other);
  // Already under the key it has now.
  const done = filedUnder(txKey(tx));
  assert.equal(migrateBookingKeys(done, [tx]), done);
});

test('an entry already under the key it has now stands; the one before goes', () => {
  const tx = booking(midnight('2026-11-01'));
  const [old, key] = [legacyTxKey(tx), txKey(tx)];
  const v: VaultData = {
    ...EMPTY_VAULT,
    txCategories: { [old]: 'leisure', [key]: 'groceries' },
    notes: { [key]: 'neu', [old]: 'alt' },
    splits: { [old]: SPLIT },
  };
  const after = migrateBookingKeys(v, [tx]);
  assert.deepEqual(after.txCategories, { [key]: 'groceries' });
  assert.deepEqual(after.notes, { [key]: 'neu' });
  // A category and a split are one choice: the booking has one under its key now, so the old split goes too.
  assert.deepEqual(after.splits, {});
  assert.equal(migrateBookingKeys(after, [tx]), after);
});

test('a split from before does not hide a category chosen under the key now, nor a category a split (p1 part 2)', () => {
  const tx = booking(midnight('2026-10-07'), { bankDay: '2026-10-07' });
  const [old, key] = [legacyTxKey(tx), txKey(tx)];
  const v: VaultData = { ...EMPTY_VAULT, splits: { [old]: SPLIT }, txCategories: { [key]: 'health' } };
  const after = migrateBookingKeys(v, [tx]);
  assert.deepEqual({ c: after.txCategories, s: after.splits }, { c: { [key]: 'health' }, s: {} });
  const w: VaultData = { ...EMPTY_VAULT, txCategories: { [old]: 'leisure' }, splits: { [key]: SPLIT } };
  assert.deepEqual(migrateBookingKeys(w, [tx]), { ...w, txCategories: {} });
  // With stamps the newer choice stands, whichever map it is in.
  const at = (t: number): EntryStamp => ({ h: 'x', t });
  const newer = moveEntries(v, keyMoves([{ txs: [tx] }]), { stamps: { [`splits/${old}`]: at(500), [`txCategories/${key}`]: at(200) } });
  assert.deepEqual({ c: newer.txCategories, s: newer.splits }, { c: {}, s: { [key]: SPLIT } });
  const older = moveEntries(v, keyMoves([{ txs: [tx] }]), { stamps: { [`splits/${old}`]: at(100), [`txCategories/${key}`]: at(200) } });
  assert.deepEqual({ c: older.txCategories, s: older.splits }, { c: { [key]: 'health' }, s: {} });
});

test('with stamps: an entry from before stamped later than the one under the key now replaces it (an old version\'s edit)', () => {
  const tx = booking(midnight('2026-10-07'));
  const [old, key] = [legacyTxKey(tx), txKey(tx)];
  const v: VaultData = { ...EMPTY_VAULT, txCategories: { [key]: 'groceries', [old]: 'leisure' }, notes: { [key]: 'Brot', [old]: 'Kuchen' } };
  const moves = keyMoves([{ txs: [tx] }]);
  const stamp = (t: number): EntryStamp => ({ h: 'x', t });
  const stamps = { [`txCategories/${key}`]: stamp(1000), [`txCategories/${old}`]: stamp(4000), [`notes/${key}`]: stamp(5000), [`notes/${old}`]: stamp(4000) };
  const { vault, plan } = planMoves(v, moves, { stamps });
  assert.deepEqual(vault.txCategories, { [key]: 'leisure' });
  assert.deepEqual(vault.notes, { [key]: 'Brot' });
  assert.deepEqual(plan.set, [{ field: 'txCategories', key, value: 'leisure', from: old }]);
  // A deletion under the key now that is newer than the entry from before: it stays deleted.
  const gone: VaultData = { ...EMPTY_VAULT, notes: { [old]: 'Kuchen' } };
  assert.deepEqual(moveEntries(gone, moves, { stamps: { [`notes/${key}`]: { h: '-', t: 6000 }, [`notes/${old}`]: stamp(4000) } }).notes, {});
  assert.deepEqual(moveEntries(gone, moves, { stamps: { [`notes/${key}`]: { h: '-', t: 3000 }, [`notes/${old}`]: stamp(4000) } }).notes, { [key]: 'Kuchen' });
  // An entry under the key now without a stamp stands.
  assert.deepEqual(moveEntries(v, moves, { stamps: { [`txCategories/${old}`]: stamp(4000) } }).txCategories, { [key]: 'groceries' });
});

test('a moved entry keeps its place: the newest notes are still the last', () => {
  const [a, b, c] = [booking(midnight('2026-09-01')), booking(midnight('2026-09-02'), { e2eReference: 'E2' }), booking(noon('2026-09-03'), { e2eReference: 'E3' })];
  const v: VaultData = { ...EMPTY_VAULT, notes: { [legacyTxKey(a)]: 'eins', [legacyTxKey(c)]: 'zwei', [legacyTxKey(b)]: 'drei' } };
  const after = migrateBookingKeys(v, [a, b, c]);
  assert.deepEqual(Object.entries(after.notes), [[txKey(a), 'eins'], [txKey(c), 'zwei'], [txKey(b), 'drei']]);
  // The rest of the vault is the very same.
  assert.equal(after.txCategories, v.txCategories);
  assert.equal(after.templates, v.templates);
  assert.equal(after.updatedAt, v.updatedAt);
});

// ---- two bookings, one key ---------------------------------------------------------

test('camt the day before and MT940 the day after share the key before: the entry is not moved', () => {
  const x = card(noon('2026-10-06'));       // key before and now: 2026-10-06
  const y = card(midnight('2026-10-07'));   // key before: 2026-10-06, now: 2026-10-07
  assert.equal(legacyTxKey(x), legacyTxKey(y));
  assert.equal(txKey(x), KEY_MARK + legacyTxKey(y), 'the same key but for the mark');
  assert.notEqual(txKey(x), txKey(y));
  const before = filedUnder(legacyTxKey(y));
  // Whose it was is not written anywhere: it stays where it is, in whatever order the two come.
  assert.equal(migrateBookingKeys(before, [x, y]), before);
  assert.equal(migrateBookingKeys(before, [y, x]), before);
  assert.equal(keyMoves([{ txs: [x, y] }]).size, 0);
  // Alone, the MT940 booking is the only one the entry can be: it moves.
  assert.deepEqual(at(migrateBookingKeys(before, [y]), txKey(y)), FILED);
});

test('the same payment on consecutive days (MT940): each entry moves to its own booking', () => {
  const [x, y, z] = [card(midnight('2026-10-06')), card(midnight('2026-10-07')), card(midnight('2026-10-08'))];
  // One key from before each, one booking each: nothing to guess.
  assert.deepEqual([legacyTxKey(x), legacyTxKey(y), legacyTxKey(z)].map((k) => k.slice(0, 10)), ['2026-10-05', '2026-10-06', '2026-10-07']);
  const v: VaultData = { ...EMPTY_VAULT, notes: { [legacyTxKey(x)]: 'x', [legacyTxKey(y)]: 'y', [legacyTxKey(z)]: 'z' } };
  const want = { [txKey(x)]: 'x', [txKey(y)]: 'y', [txKey(z)]: 'z' };
  for (const order of [[x, y, z], [z, y, x], [y, z, x]]) {
    const after = migrateBookingKeys(v, order);
    assert.deepEqual(after.notes, want);
    // Repeated with any part of the bookings, nothing more happens.
    assert.equal(migrateBookingKeys(after, order), after);
    assert.equal(migrateBookingKeys(after, [y]), after);
    assert.equal(migrateBookingKeys(after, [x, z]), after);
  }
  // With only some of them known, those move and the rest wait where they are.
  const part = migrateBookingKeys(v, [y]);
  assert.deepEqual(part.notes, { [legacyTxKey(x)]: 'x', [txKey(y)]: 'y', [legacyTxKey(z)]: 'z' });
  assert.deepEqual(migrateBookingKeys(part, [x, y, z]).notes, want);
});

test('two payments alike in everything on one day: one key before, one key now — their entry moves', () => {
  const [a, b] = [card(midnight('2026-10-07')), card(midnight('2026-10-07'))];
  assert.equal(legacyTxKey(a), legacyTxKey(b));
  assert.equal(txKey(a), txKey(b));
  // Both showed it before, both show it after.
  assert.deepEqual(at(migrateBookingKeys(filedUnder(legacyTxKey(a)), [a, b]), txKey(a)), FILED);
  // And kept and fetched anew, one booking twice, is the same case.
  const fresh = { ...a, bankDay: '2026-10-07' };
  assert.deepEqual(at(migrateBookingKeys(filedUnder(legacyTxKey(a)), [a, fresh]), txKey(a)), FILED);
});

test('the key now is taken: the entry there stands, the one from before goes', () => {
  const [x, y] = [card(midnight('2026-10-06')), card(midnight('2026-10-07'))];
  const v: VaultData = { ...EMPTY_VAULT, txCategories: { [legacyTxKey(x)]: 'leisure', [txKey(x)]: 'groceries', [legacyTxKey(y)]: 'media' } };
  const after = migrateBookingKeys(v, [x, y]);
  assert.deepEqual(after.txCategories, { [txKey(x)]: 'groceries', [txKey(y)]: 'media' });
  assert.equal(migrateBookingKeys(after, [x, y]), after);
});

test('one booking, kept as MT940 and fetched as camt: both keys from before lead to it, the newer entry stands (p1)', () => {
  const kept = card(midnight('2026-10-07'));
  const asCamt = card(noon('2026-10-07'), { bankDay: '2026-10-07' });
  assert.notEqual(legacyTxKey(kept), legacyTxKey(asCamt));
  assert.equal(txKey(kept), txKey(asCamt));
  const [k1, k2] = [legacyTxKey(kept), legacyTxKey(asCamt)];
  // Without stamps the later in the map: an edit is written at the end (lib/notes.ts withNote).
  const v: VaultData = { ...EMPTY_VAULT, notes: { [k1]: 'alt: Brot', [k2]: 'NEU: Kuchen' } };
  const after = migrateBookingKeys(v, [kept, asCamt]);
  assert.deepEqual(after.notes, { [txKey(kept)]: 'NEU: Kuchen' });
  assert.equal(migrateBookingKeys(after, [kept, asCamt]), after);
  // A split before a category, without stamps: the two are one choice.
  const both: VaultData = { ...EMPTY_VAULT, splits: { [k1]: SPLIT }, txCategories: { [k2]: 'leisure' } };
  const one = migrateBookingKeys(both, [kept, asCamt]);
  assert.deepEqual({ c: one.txCategories, s: one.splits }, { c: {}, s: { [txKey(kept)]: SPLIT } });
  // With stamps the newer, wherever it is in the map.
  const stamps = { [`notes/${k1}`]: { h: 'x', t: 900 }, [`notes/${k2}`]: { h: 'x', t: 100 } };
  assert.deepEqual(moveEntries(v, keyMoves([{ txs: [kept, asCamt] }]), { stamps }).notes, { [txKey(kept)]: 'alt: Brot' });
});

test('two bookings with one key before and different keys now: not moved', () => {
  // Cannot come from one device’s statements; a list must not be trusted to be that tidy.
  const a = card('2026-10-06T22:00:00.000Z', { bankDay: '2026-10-07' });
  const b = card('2026-10-06T22:00:00.000Z', { bankDay: '2026-10-08' });
  assert.equal(legacyTxKey(a), legacyTxKey(b));
  const before = filedUnder(legacyTxKey(a));
  assert.equal(migrateBookingKeys(before, [a, b]), before);
  // Two bookings that are alike in everything are one key before and one key now: that moves.
  assert.deepEqual(at(migrateBookingKeys(before, [a, { ...a }]), txKey(a)), FILED);
});

test('a key now longer than the vault keeps: the entry stays where it is rather than be dropped at the save', () => {
  const long = booking(midnight('2026-10-07'), { remoteIban: '', remoteName: 'A'.repeat(BOOKING_KEY_MAX - 22) });
  assert.ok(legacyTxKey(long).length <= BOOKING_KEY_MAX && txKey(long).length > BOOKING_KEY_MAX);
  const v = filedUnder(legacyTxKey(long));
  assert.equal(migrateBookingKeys(v, [long]), v);
});

// ---- the days known ----------------------------------------------------------------

test('MT940 on the first day known waits: a camt twin of the day before would not be seen', () => {
  const x = card(noon('2026-10-06'));       // camt: key before and now on the 6th
  const y = card(midnight('2026-10-07'));   // MT940: key before on the 6th, now on the 7th
  const ys: VaultData = { ...EMPTY_VAULT, notes: { [legacyTxKey(y)]: 'y' } };
  const from = (day: string) => (d: string) => d >= day;
  // The list begins on the 7th: x, if there is one, is not in it. Nothing moves.
  assert.equal(moveEntries(ys, keyMoves([{ txs: [y], covers: from('2026-10-07') }])), ys);
  // The 6th known, and no such booking on it: the entry can only be y's.
  assert.deepEqual(moveEntries(ys, keyMoves([{ txs: [y], covers: from('2026-10-06') }])).notes, { [txKey(y)]: 'y' });
  // The 6th known, with x on it: either one's — not moved.
  assert.equal(moveEntries(ys, keyMoves([{ txs: [x, y], covers: from('2026-10-06') }])), ys);
  // A booking whose key from before names its own day moves on the first day too.
  const xs: VaultData = { ...EMPTY_VAULT, notes: { [legacyTxKey(x)]: 'x' } };
  assert.deepEqual(moveEntries(xs, keyMoves([{ txs: [x], covers: from('2026-10-06') }])).notes, { [txKey(x)]: 'x' });
});

test('one list that knows the day before is enough; a list without days knows them all', () => {
  const y = card(midnight('2026-10-07'));
  const v: VaultData = { ...EMPTY_VAULT, notes: { [legacyTxKey(y)]: 'y' } };
  const fetched = { account: 'A', txs: [y], covers: (d: string) => d >= '2026-10-07' };
  const kept = { account: 'A', txs: [{ ...y }], covers: (d: string) => d >= '2026-01-01' && d <= '2026-10-07' };
  assert.equal(moveEntries(v, keyMoves([fetched])), v);
  assert.deepEqual(moveEntries(v, keyMoves([fetched, kept])).notes, { [txKey(y)]: 'y' });
  assert.deepEqual(moveEntries(v, keyMoves([kept, fetched])).notes, { [txKey(y)]: 'y' });
  assert.deepEqual(moveEntries(v, keyMoves([{ txs: [y] }])).notes, { [txKey(y)]: 'y' });
  // A twin in another list counts like one in the same.
  const x = card(noon('2026-10-06'));
  assert.equal(moveEntries(v, keyMoves([{ txs: [y] }, { txs: [x] }])), v);
});

test('the day before must be known at every bank: a key from before never named the account (p5)', () => {
  const base = { amount: -12.99, remoteIban: '', remoteName: 'NETFLIX.COM', e2eReference: '', bankReference: '' };
  const a = { ...base, entryDate: noon('2026-10-06'), valueDate: noon('2026-10-06'), bankDay: '2026-10-06' } as Tx; // bank X, camt
  const b = { ...base, entryDate: midnight('2026-10-07'), valueDate: midnight('2026-10-07'), bankDay: '2026-10-07' } as Tx; // bank Y, MT940
  assert.equal(legacyTxKey(a), legacyTxKey(b));
  const v: VaultData = { ...EMPTY_VAULT, notes: { [legacyTxKey(a)]: 'Familien-Abo, Konto 1' } };
  const accounts = ['X-1', 'Y-2'];
  // Only bank Y loaded: the camt booking at X is not there to be seen. Nothing moves.
  assert.equal(moveEntries(v, keyMoves([{ account: 'Y-2', txs: [b], covers: (d) => d >= '2026-08-01' }], { accounts })), v);
  // Both loaded: the two had one key before and have two now — whose it is is not written anywhere.
  assert.equal(moveEntries(v, keyMoves([
    { account: 'X-1', txs: [a], covers: (d) => d >= '2026-08-01' }, { account: 'Y-2', txs: [b], covers: (d) => d >= '2026-08-01' },
  ], { accounts })), v);
  // X loaded, but not as far back as the day before: still waiting.
  assert.equal(moveEntries(v, keyMoves([
    { account: 'X-1', txs: [], covers: (d) => d >= '2026-10-07' }, { account: 'Y-2', txs: [b], covers: (d) => d >= '2026-08-01' },
  ], { accounts })), v);
  // X loaded over the 6th without such a booking: the entry can only be Y's.
  assert.deepEqual(moveEntries(v, keyMoves([
    { account: 'X-1', txs: [], covers: (d) => d >= '2026-08-01' }, { account: 'Y-2', txs: [b], covers: (d) => d >= '2026-08-01' },
  ], { accounts })).notes, { [txKey(b)]: 'Familien-Abo, Konto 1' });
  // A key from before on its own day (camt) needs no other bank: the twin would be of the next day, and has another key from before.
  const w: VaultData = { ...EMPTY_VAULT, notes: { [legacyTxKey(a)]: 'x' } };
  assert.deepEqual(moveEntries(w, keyMoves([{ account: 'X-1', txs: [a] }], { accounts })).notes, { [txKey(a)]: 'x' });
});

// ---- the setters' side (components/FintsProvider.tsx) -------------------------------

test('a booking\'s keys from before: its own, and every other the moves lead to it', () => {
  const kept = card(midnight('2026-10-07'));
  const asCamt = card(noon('2026-10-07'), { bankDay: '2026-10-07' });
  const moves = keyMoves([{ txs: [kept, asCamt] }]);
  assert.deepEqual(legacyKeysOf(asCamt, moves).sort(), [legacyTxKey(kept), legacyTxKey(asCamt)].sort());
  assert.deepEqual(legacyKeysOf(kept, keyMoves([])), [legacyTxKey(kept)]);
  // A clear of the booking takes those along, so none comes back over it at the next move.
  const v: VaultData = { ...EMPTY_VAULT, txCategories: { [legacyTxKey(kept)]: 'leisure', [txKey(kept)]: 'groceries' } };
  const cleared = dropKeys(v.txCategories, [txKey(asCamt), ...legacyKeysOf(asCamt, moves)]);
  assert.deepEqual(cleared, {});
  assert.deepEqual(migrateBookingKeys({ ...v, txCategories: cleared }, [kept, asCamt]).txCategories, {});
  const same = { a: 1 };
  assert.equal(dropKeys(same, ['b']), same);
});

// ---- size caps ----------------------------------------------------------------------

test('a move that would push the notes past their cap waits; nothing is dropped', () => {
  // Notes filling the cap to within a few bytes: three more per key would make lib/notes.ts drop the oldest.
  const txs: Tx[] = [];
  const notes: Record<string, string> = {};
  const text = 'x'.repeat(240);
  let bytes = 0;
  for (let i = 0; bytes < NOTE_LIMITS.bytes - 400; i++) {
    const t = booking(midnight(addDaysKey('2020-01-01', i % 2000)), { e2eReference: `E${i}` });
    txs.push(t);
    notes[legacyTxKey(t)] = text;
    bytes += JSON.stringify(legacyTxKey(t)).length + JSON.stringify(text).length + 2;
  }
  const v: VaultData = { ...EMPTY_VAULT, notes, txCategories: { [legacyTxKey(txs[0])]: 'leisure' } };
  const after = migrateBookingKeys(v, txs);
  assert.equal(after.notes, notes, 'the notes stay under their keys from before');
  assert.deepEqual(after.txCategories, { [txKey(txs[0])]: 'leisure' }, 'the rest moves');
});

test('a move that would push the vault past its size waits, the notes first; nothing moves rather than a save failing', () => {
  const t1 = booking(midnight('2026-10-07'));
  const v: VaultData = { ...EMPTY_VAULT, notes: { [legacyTxKey(t1)]: 'n' }, txCategories: { [legacyTxKey(t1)]: 'leisure' } };
  const size = new TextEncoder().encode(JSON.stringify(v)).length;
  const moves = keyMoves([{ txs: [t1] }]);
  assert.equal(moveEntries(v, moves, { maxBytes: size }), v);
  const roomForOne = moveEntries(v, moves, { maxBytes: size + 3 });
  assert.deepEqual([roomForOne.txCategories, roomForOne.notes], [{ [txKey(t1)]: 'leisure' }, v.notes]);
  assert.deepEqual(moveEntries(v, moves, { maxBytes: size + 6 }).notes, { [txKey(t1)]: 'n' });
  assert.equal(VAULT_MAX_BYTES, 512 * 1024);
});

// ---- receipts ----------------------------------------------------------------------

test('a receipt tied to the key before is tied to the key the booking has now', () => {
  const tx = booking(midnight('2026-11-01'));
  const twinBefore = card(noon('2026-10-06'));
  const twin = card(midnight('2026-10-07'));
  const docs = [
    { id: 'a', kind: 'receipt' as const, tx: legacyTxKey(tx) },
    { id: 'b', kind: 'receipt' as const, tx: legacyTxKey(tx) },
    { id: 'c', kind: 'receipt' as const, tx: txKey(tx) },
    { id: 'd', kind: 'receipt' as const, tx: null },
    { id: 'e', kind: 'statement' as const, tx: legacyTxKey(tx) },
    { id: 'f', kind: 'receipt' as const, tx: legacyTxKey(twin) },
  ];
  const moves = keyMoves([{ txs: [tx, twinBefore, twin] }]);
  assert.deepEqual(receiptMoves(docs, moves).map((m) => [m.doc.id, m.tx]), [['a', txKey(tx)], ['b', txKey(tx)]]);
  assert.deepEqual(receiptMoves(docs, keyMoves([])), []);
  // Once tied anew there is nothing left to do.
  const after = docs.map((d) => (d.tx === legacyTxKey(tx) && d.kind === 'receipt' ? { ...d, tx: txKey(tx) } : d));
  assert.deepEqual(receiptMoves(after, moves), []);
});

// ---- size ------------------------------------------------------------------------

test('ten years of bookings: one pass, and every filed entry arrives', () => {
  const txs: Tx[] = [];
  let day = '2016-11-10';
  for (let i = 0; i < 20_000; i++) {
    if (i % 6 === 0) day = addDaysKey(day, 1);
    txs.push(booking(i % 2 ? midnight(day) : noon(day), { e2eReference: `E${i}`, amount: -(1 + (i % 500)) }));
  }
  // Within the vault's caps: notes for 4,000 of them, a category for 4,000 more.
  const notes: Record<string, string> = {};
  const txCategories: Record<string, 'leisure'> = {};
  for (let i = 0; i < txs.length; i += 5) notes[legacyTxKey(txs[i])] = `n${i}`;
  for (let i = 1; i < txs.length; i += 5) txCategories[legacyTxKey(txs[i])] = 'leisure';
  const v: VaultData = { ...EMPTY_VAULT, notes, txCategories };
  const started = Date.now();
  const after = migrateBookingKeys(v, txs);
  const again = migrateBookingKeys(after, txs);
  assert.ok(Date.now() - started < 5000, 'no quadratic work');
  assert.equal(again, after);
  assert.equal(Object.keys(after.notes).length, Object.keys(notes).length);
  for (let i = 0; i < txs.length; i += 5) assert.equal(after.notes[txKey(txs[i])], `n${i}`);
  for (let i = 1; i < txs.length; i += 5) assert.equal(after.txCategories[txKey(txs[i])], 'leisure');
});

test('a sync round takes along only the moves whose key from before is in the vault, within what one request carries', () => {
  const txs = Array.from({ length: 30 }, (_, i) => booking(midnight(addDaysKey('2026-01-01', i)), { e2eReference: `E${i}` }));
  const moves = keyMoves([{ txs }]);
  const v: VaultData = { ...EMPTY_VAULT, notes: { [legacyTxKey(txs[3])]: 'a', other: 'b' }, txCategories: { [legacyTxKey(txs[3])]: 'leisure', [legacyTxKey(txs[7])]: 'media' } };
  assert.deepEqual(movesInVault(v, moves).sort(), [[legacyTxKey(txs[3]), txKey(txs[3])], [legacyTxKey(txs[7]), txKey(txs[7])]].sort());
  assert.equal(movesInVault(v, moves, { pairs: 1, chars: 1e6 }).length, 1);
  assert.equal(movesInVault(v, moves, { pairs: 10, chars: 10 }).length, 0);
  assert.deepEqual(movesInVault(EMPTY_VAULT, moves), []);
});
