import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_VAULT, type VaultData } from './app-types.ts';
import type { KeptDoc } from './docs';
import {
  blobFile, devicesFile, FILL_MAX, groupOf, loginTag, makeCode, newDeviceId, newGroupKey, readCode, readPlace, runSync,
  seal, stateFile, unseal, type ReceiptsSide, type SyncLocal, type SyncStore,
} from './sync.ts';
import { SyncPlaceError } from './sync-stores.ts';

/** A place in memory that every device reaches. */
function memoryPlace(): SyncStore & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return { files, get: async (n) => files.get(n) ?? null, put: async (n, b) => { files.set(n, b); }, remove: async (n) => { files.delete(n); } };
}

const blobs = (place: { files: Map<string, Uint8Array> }) => [...place.files.keys()].filter((n) => n.endsWith('.doc')).length;
const DAY = 86_400_000;

/** One device's receipts. */
function receiptsOf(): ReceiptsSide & { docs: Map<string, { doc: KeptDoc; bytes: Uint8Array }> } {
  const docs = new Map<string, { doc: KeptDoc; bytes: Uint8Array }>();
  return {
    docs,
    list: async () => [...docs.values()].map((d) => d.doc),
    read: async (id) => docs.get(id)!.bytes,
    add: async (doc, bytes) => { docs.set(doc.id, { doc, bytes }); return doc.id; },
    remove: async (id) => { docs.delete(id); },
    // As the route's (lib/doc-store.ts linkReceipt): there is no unlinking.
    link: async (id, tx, accountNumber) => { if (!tx) return; const d = docs.get(id)!; d.doc = { ...d.doc, tx, accountNumber: accountNumber ?? d.doc.accountNumber }; },
  };
}

const fresh = (): SyncLocal => ({ stamps: {}, uploaded: [], hashes: {} });

function device(name: string, vault: Partial<VaultData> = {}) {
  return { id: newDeviceId(), name, vault: { ...EMPTY_VAULT, ...vault } as VaultData, local: fresh(), receipts: receiptsOf() };
}

type Extra = Pick<Parameters<typeof runSync>[0], 'keep' | 'maxBytes' | 'checkpoint' | 'moves'>;

async function round(place: SyncStore, key: Buffer, d: ReturnType<typeof device>, now: number, extra: Extra = {}) {
  const r = await runSync({ store: place, key, device: { id: d.id, name: d.name }, vault: d.vault, local: d.local, receipts: d.receipts, now, ...extra });
  d.vault = r.vault;
  d.local = r.local;
  return r;
}

const receipt = (id: string, name: string): KeptDoc => ({
  id, kind: 'receipt', mime: 'application/pdf', name, size: 3, addedAt: '2026-11-01T10:00:00Z', accountNumber: null, tx: null,
});

test('files are sealed under the key and bound to their names', () => {
  const key = newGroupKey();
  const sealed = seal(key, 'a.state', Buffer.from('hello'));
  assert.equal(unseal(key, 'a.state', sealed)?.toString(), 'hello');
  assert.equal(unseal(key, 'b.state', sealed), null);
  assert.equal(unseal(newGroupKey(), 'a.state', sealed), null);
  assert.equal(unseal(key, 'a.state', null), null);
  assert.match(devicesFile(key), /^[0-9a-f]{24}\.devices$/);
});

test('two devices end with the same notes, rules and receipts — and the place learns none of it', async () => {
  const place = memoryPlace();
  const key = newGroupKey();
  const desk = device('Computer', { notes: { k1: 'Geschenk für Oma' }, budgets: { groceries: 40000 } });
  const phone = device('Telefon', { aliases: { DE01: 'Haushalt' } });
  desk.receipts.docs.set('r1', { doc: receipt('r1', 'Rechnung.pdf'), bytes: Buffer.from('pdf') });

  await round(place, key, desk, 1000);
  const r = await round(place, key, phone, 2000);
  assert.equal(r.changed, true);
  assert.deepEqual(phone.vault.notes, { k1: 'Geschenk für Oma' });
  assert.deepEqual(phone.vault.aliases, { DE01: 'Haushalt' });
  assert.equal(r.receipts.added, 1);
  assert.equal([...phone.receipts.docs.values()][0].doc.name, 'Rechnung.pdf');
  assert.equal(r.devices.length, 2);

  const back = await round(place, key, desk, 3000);
  assert.deepEqual(desk.vault.aliases, { DE01: 'Haushalt' });
  assert.equal(back.changed, true);
  // Nothing readable in the place.
  for (const bytes of place.files.values()) {
    const text = Buffer.from(bytes).toString('latin1');
    assert.ok(!text.includes('Oma') && !text.includes('Haushalt') && !text.includes('Rechnung'));
  }
});

test('a deletion on one device reaches the other; the newest edit of one note wins', async () => {
  const place = memoryPlace();
  const key = newGroupKey();
  const desk = device('Computer', { notes: { a: 'eins', b: 'zwei' } });
  const phone = device('Telefon');
  await round(place, key, desk, 1000);
  await round(place, key, phone, 1100);
  // The phone deletes b; the computer changes a, later.
  phone.vault = { ...phone.vault, notes: { a: 'eins' } };
  await round(place, key, phone, 2000);
  desk.vault = { ...desk.vault, notes: { a: 'EINS', b: 'zwei' } };
  await round(place, key, desk, 3000);
  await round(place, key, phone, 4000);
  assert.deepEqual(desk.vault.notes, { a: 'EINS' });
  assert.deepEqual(phone.vault.notes, { a: 'EINS' });
});

test('a receipt deleted on one device is deleted on the other; a new match follows', async () => {
  const place = memoryPlace();
  const key = newGroupKey();
  const desk = device('Computer');
  const phone = device('Telefon');
  desk.receipts.docs.set('r1', { doc: receipt('r1', 'Bon.pdf'), bytes: Buffer.from('bon') });
  await round(place, key, desk, 1000);
  await round(place, key, phone, 1100);
  const phoneId = [...phone.receipts.docs.keys()][0];
  // Matched to a booking on the phone…
  await phone.receipts.link(phoneId, '2026-11-01|-3.00|REWE|', 'DE01');
  await round(place, key, phone, 2000);
  await round(place, key, desk, 2100);
  assert.equal(desk.receipts.docs.get('r1')?.doc.tx, '2026-11-01|-3.00|REWE|');
  // …then deleted there.
  phone.receipts.docs.delete(phoneId);
  await round(place, key, phone, 3000);
  const r = await round(place, key, desk, 3100);
  assert.equal(r.receipts.removed, 1);
  assert.equal(desk.receipts.docs.size, 0);
});

test('a receipt whose bytes did not arrive is never deleted on the device that has it', async () => {
  const place = memoryPlace();
  const key = newGroupKey();
  const desk = device('Computer');
  const phone = device('Telefon');
  desk.receipts.docs.set('r1', { doc: receipt('r1', 'Bon.pdf'), bytes: Buffer.from('bon') });
  await round(place, key, desk, 1000);
  // The blob is lost on its way (a folder tool brought the state first, say).
  for (const name of [...place.files.keys()]) if (name.endsWith('.doc')) place.files.delete(name);
  await round(place, key, phone, 2000);
  await round(place, key, phone, 3000);
  await round(place, key, desk, 4000);
  assert.equal(desk.receipts.docs.size, 1);
});

test('a round with unreadable receipts deletes none and crashes no other device', async () => {
  const place = memoryPlace();
  const key = newGroupKey();
  const desk = device('Computer');
  const phone = device('Telefon');
  desk.receipts.docs.set('r1', { doc: receipt('r1', 'Bon.pdf'), bytes: Buffer.from('bon') });
  await round(place, key, desk, 1000);
  await round(place, key, phone, 1100);
  // The phone's receipts cannot be read for a round.
  const r = await runSync({ store: place, key, device: { id: phone.id, name: phone.name }, vault: phone.vault, local: phone.local, receipts: null, now: 2000 });
  phone.local = r.local;
  await round(place, key, desk, 3000);
  await round(place, key, phone, 4000);
  assert.equal(desk.receipts.docs.size, 1);
  assert.equal(phone.receipts.docs.size, 1);
});

test('what one device does not keep (balances switched off) is not deleted on the others', async () => {
  const place = memoryPlace();
  const key = newGroupKey();
  const kept = { DE01: { cents: 12345, currency: 'EUR', readAt: '2026-11-01T18:02:00Z' } };
  const desk = device('Computer', { keptBalances: kept });
  const phone = device('Telefon', { keepBalances: false });
  await round(place, key, desk, 1000);
  await round(place, key, phone, 2000);
  assert.equal(phone.vault.keptBalances, undefined);
  await round(place, key, phone, 3000);
  await round(place, key, desk, 4000);
  assert.deepEqual(desk.vault.keptBalances, kept);
});

test('switching balances off on one device later does not delete them on the others', async () => {
  const place = memoryPlace();
  const key = newGroupKey();
  const kept = { DE01: { cents: 12345, currency: 'EUR', readAt: '2026-11-01T18:02:00Z' } };
  const curve = [{ day: '2026-11-01', total: 12345, assets: 12345, liabilities: 0 }];
  const desk = device('Computer', { keptBalances: kept, netWorth: curve });
  const phone = device('Telefon');
  await round(place, key, desk, 1000);
  await round(place, key, phone, 2000);
  assert.deepEqual(phone.vault.keptBalances, kept, 'the phone held them, stamped');
  // Switched off on the phone: its vault drops them (FintsProvider), the next rounds follow.
  const { keptBalances: _k, netWorth: _n, ...rest } = phone.vault;
  phone.vault = { ...rest, keepBalances: false } as VaultData;
  await round(place, key, phone, 3000);
  await round(place, key, desk, 4000);
  assert.deepEqual(desk.vault.keptBalances, kept);
  assert.deepEqual(desk.vault.netWorth, curve);
  assert.equal(phone.vault.keptBalances, undefined);
});

test('a device that joins never overwrites the group\'s newer data with what it brought', async () => {
  const place = memoryPlace();
  const key = newGroupKey();
  const desk = device('Computer', { notes: { a: 'neu' }, accountGrouping: 'bank' });
  await round(place, key, desk, 5000);
  const phone = device('Telefon', { notes: { a: 'alt', b: 'nur hier' }, accountGrouping: 'none' });
  phone.local = { ...phone.local, joining: true };
  await round(place, key, phone, 6000);
  assert.deepEqual(phone.vault.notes, { a: 'neu', b: 'nur hier' });
  assert.equal(phone.vault.accountGrouping, 'bank');
  await round(place, key, desk, 7000);
  assert.deepEqual(desk.vault.notes, { a: 'neu', b: 'nur hier' });
});

test('a device silent for months is left out and cannot bring a deleted note back', async () => {
  const place = memoryPlace();
  const key = newGroupKey();
  const desk = device('Computer', { notes: { a: 'x' } });
  const old = device('Altes Telefon');
  await round(place, key, desk, 1000);
  await round(place, key, old, 1100);
  desk.vault = { ...desk.vault, notes: {} };
  await round(place, key, desk, 2000);
  // Half a year later the tombstone is gone; the old phone's state still has the note.
  const later = 2000 + 200 * 86_400_000;
  const r = await round(place, key, desk, later);
  assert.deepEqual(desk.vault.notes, {});
  assert.equal(r.devices.length, 1);
});

test('a device renamed since it joined goes by its new name, on one line of the list', async () => {
  const place = memoryPlace();
  const key = newGroupKey();
  const computer = device('Computer');
  const phone = device('Android');
  await round(place, key, computer, 1000);
  await round(place, key, phone, 2000);
  phone.name = 'S26 Ultra';
  await round(place, key, phone, 3000);
  const { devices } = await round(place, key, computer, 4000);
  assert.deepEqual(devices.map((d) => d.name).sort(), ['Computer', 'S26 Ultra']);
});

test('a state file of another group, or a damaged one, is skipped', async () => {
  const place = memoryPlace();
  const key = newGroupKey();
  const desk = device('Computer', { notes: { a: 'x' } });
  await round(place, key, desk, 1000);
  const phone = device('Telefon');
  // The devices list names the phone, but its state is garbage.
  place.files.set(stateFile(key, phone.id), Buffer.from('garbage garbage garbage'));
  const r = await round(place, key, desk, 2000);
  assert.equal(r.changed, false);
  assert.deepEqual(desk.vault.notes, { a: 'x' });
  // Not "abc": the name is hex, and hex holds "abc" in about one name of eighty.
  assert.ok(groupOf(key).length === 24 && !blobFile(key, 'beleg').includes('beleg'));
});

const bytesOf = (v: VaultData) => Buffer.byteLength(JSON.stringify(v), 'utf8');
const longNotes = (prefix: string, n: number) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`${prefix}${i}`, `Notiz ${prefix}${i} `.padEnd(200, 'x')]));

test('a merged vault too large to keep leaves out what is new from the others, instead of failing every round', async () => {
  const place = memoryPlace();
  const key = newGroupKey();
  const desk = device('Computer', { notes: longNotes('d', 30) });
  const phoneNotes = longNotes('p', 30);
  const phone = device('Telefon', { notes: phoneNotes });
  // Room on the phone for a few of the desk's notes, not for all 30.
  const maxBytes = Math.ceil((bytesOf(phone.vault) + 2000) / FILL_MAX);
  await round(place, key, desk, 1000);
  const r = await round(place, key, phone, 2000, { maxBytes });
  assert.ok(bytesOf(phone.vault) <= Math.floor(maxBytes * FILL_MAX), 'filled only so far');
  assert.ok(r.full > 0 && r.full < 30, `full: ${r.full}`);
  // Room is left for the phone's own next note, at its longest.
  const edited = { ...phone.vault, notes: { ...phone.vault.notes, neu: 'z'.repeat(280) } };
  assert.ok(bytesOf(edited) <= maxBytes, 'the next edit can still be saved');
  for (const [k, v] of Object.entries(phoneNotes)) assert.equal(phone.vault.notes[k], v, 'its own notes all stay');
  assert.equal(Object.keys(phone.vault.notes).filter((k) => k.startsWith('d')).length, 30 - r.full);
  // The next round goes through the same way: nothing fails, nothing is stamped as deleted.
  const again = await round(place, key, phone, 3000, { maxBytes });
  assert.equal(again.full, r.full);
  assert.equal(again.changed, false);
  assert.ok(Object.values(phone.local.stamps).every((st) => st.h !== '-'));
  // The desk (room enough) keeps all of its own and takes all of the phone's.
  await round(place, key, desk, 4000);
  assert.equal(Object.keys(desk.vault.notes).length, 60);
});

test('a vault the others\' changes would make too large stays as it is, and never overwrites theirs', async () => {
  const place = memoryPlace();
  const key = newGroupKey();
  const desk = device('Computer', { notes: { a: 'kurz' } });
  const phone = device('Telefon', { notes: longNotes('p', 20) });
  await round(place, key, desk, 1000);
  await round(place, key, phone, 2000);
  assert.equal(phone.vault.notes.a, 'kurz');
  const maxBytes = bytesOf(phone.vault) + 20;
  // Fuller than a round fills it, with its own notes: kept as it is, nothing said.
  const quiet = await round(place, key, phone, 2500, { maxBytes });
  assert.equal(quiet.full, 0);
  // The desk makes the note long; the phone has no room for that.
  desk.vault = { ...desk.vault, notes: { ...desk.vault.notes, a: 'lang '.repeat(50) } };
  await round(place, key, desk, 3000);
  const r = await round(place, key, phone, 4000, { maxBytes });
  assert.equal(r.changed, false);
  assert.ok(r.full >= 1);
  assert.equal(phone.vault.notes.a, 'kurz');
  await round(place, key, phone, 5000, { maxBytes });
  await round(place, key, desk, 6000);
  assert.equal(desk.vault.notes.a, 'lang '.repeat(50), 'the phone\'s older note never wins over the desk\'s change');
});

test('a device back after more than a year loses what the group deleted meanwhile, and brings what the group never had', async () => {
  const place = memoryPlace();
  const key = newGroupKey();
  const desk = device('Computer', { notes: { a: 'gelöscht', b: 'bleibt' } });
  const phone = device('Altes Telefon');
  await round(place, key, desk, 1000);
  await round(place, key, phone, 1100);
  await round(place, key, desk, 1200);
  // The phone's last round brings a note the desk never reads: the phone falls silent.
  phone.vault = { ...phone.vault, notes: { ...phone.vault.notes, c: 'nur am Telefon' } };
  await round(place, key, phone, 1500);
  // Months later the desk deletes a, and keeps syncing alone for over a year.
  const deleted = 1500 + 100 * DAY;
  desk.vault = { ...desk.vault, notes: { b: 'bleibt' } };
  await round(place, key, desk, deleted);
  for (let d = 30; d <= 400; d += 30) await round(place, key, desk, deleted + d * DAY);
  assert.equal(desk.local.stamps['notes/a']?.h, '-', 'the tombstone outlives the absence');
  // The phone comes back.
  await round(place, key, phone, deleted + 420 * DAY);
  assert.deepEqual(phone.vault.notes, { b: 'bleibt', c: 'nur am Telefon' });
  await round(place, key, desk, deleted + 421 * DAY);
  assert.deepEqual(desk.vault.notes, { b: 'bleibt', c: 'nur am Telefon' });
});

/** One device syncing alone every 10 days from `from` for `days`, while the other is away. */
async function away(place: SyncStore, key: Buffer, d: ReturnType<typeof device>, from: number, days: number, extra: Extra = {}) {
  for (let t = 10; t < days; t += 10) await round(place, key, d, from + t * DAY, extra);
}

test('back after months, a device keeps the balances a device with them switched off never held', async () => {
  const place = memoryPlace();
  const key = newGroupKey();
  const curve = [{ day: '2026-01-01', total: 1, assets: 1, liabilities: 0 }, { day: '2026-02-01', total: 2, assets: 2, liabilities: 0 }];
  const kept = { DE01: { cents: 12345, currency: 'EUR', readAt: '2026-11-01T18:02:00Z' } };
  const desk = device('Computer', { keptBalances: kept, netWorth: curve, notes: { n: 'x' } });
  const phone = device('Telefon', { keepBalances: false });
  await round(place, key, desk, 1000);
  await round(place, key, phone, 2000);
  await round(place, key, desk, 3000);
  await round(place, key, phone, 4000);
  await away(place, key, phone, 4000, 200);
  await round(place, key, desk, 4000 + 200 * DAY);
  assert.deepEqual(desk.vault.keptBalances, kept);
  assert.deepEqual(desk.vault.netWorth, curve);
  assert.deepEqual(desk.vault.notes, { n: 'x' });
});

test('back after months, a device keeps a receipt the other device could not take', async () => {
  const place = memoryPlace();
  const key = newGroupKey();
  const desk = device('Computer');
  const phone = device('Telefon');
  // The phone's doc store is full: it never holds the receipt.
  phone.receipts.add = async () => null;
  desk.receipts.docs.set('r1', { doc: receipt('r1', 'Bon.pdf'), bytes: Buffer.from('bon') });
  await round(place, key, desk, 1000);
  await round(place, key, phone, 2000);
  await round(place, key, desk, 3000);
  await round(place, key, phone, 4000);
  await away(place, key, phone, 4000, 200);
  const r = await round(place, key, desk, 4000 + 200 * DAY);
  assert.equal(r.receipts.removed, 0);
  assert.equal(desk.receipts.docs.size, 1);
  assert.equal(blobs(place), 1);
});

test('back after months, a device keeps the notes the other device had no room for', async () => {
  const place = memoryPlace();
  const key = newGroupKey();
  const big = 'x'.repeat(250);
  const desk = device('Computer', { notes: { a: big, b: big, c: big } });
  const phone = device('Telefon', { notes: { p: 'y' } });
  await round(place, key, desk, 1000);
  const maxBytes = Math.ceil((bytesOf(phone.vault) + 400) / FILL_MAX);
  const first = await round(place, key, phone, 2000, { maxBytes });
  assert.ok(first.full > 0);
  await round(place, key, desk, 3000);
  await away(place, key, phone, 4000, 200, { maxBytes });
  await round(place, key, desk, 4000 + 200 * DAY);
  assert.deepEqual(Object.keys(desk.vault.notes).sort(), ['a', 'b', 'c', 'p']);
});

test('back after months with its receipts unreadable for a round, a device still loses the receipt the group deleted', async () => {
  const place = memoryPlace();
  const key = newGroupKey();
  const desk = device('Computer');
  const phone = device('Telefon');
  desk.receipts.docs.set('r1', { doc: receipt('r1', 'Bon.pdf'), bytes: Buffer.from('bon') });
  await round(place, key, desk, 1000);
  await round(place, key, phone, 1100);
  desk.receipts.docs.clear();
  await round(place, key, desk, 2000);
  await away(place, key, desk, 2000, 200);
  // The phone comes back with its receipts locked for one round, then readable.
  const locked = await runSync({ store: place, key, device: { id: phone.id, name: phone.name }, vault: phone.vault, local: phone.local, receipts: null, now: 2000 + 210 * DAY });
  phone.local = locked.local;
  assert.equal(phone.receipts.docs.size, 1);
  await round(place, key, phone, 2000 + 211 * DAY);
  assert.equal(phone.receipts.docs.size, 0);
  await round(place, key, desk, 2000 + 212 * DAY);
  assert.equal(desk.receipts.docs.size, 0);
});

test('a state that cannot be read this round deletes nothing', async () => {
  const memory = memoryPlace();
  const key = newGroupKey();
  const desk = device('Computer', { notes: { a: 'x' } });
  const phone = device('Telefon');
  const tablet = device('Tablet');
  desk.receipts.docs.set('r1', { doc: receipt('r1', 'Bon.pdf'), bytes: Buffer.from('bon') });
  await round(memory, key, desk, 1000);
  await round(memory, key, phone, 1100);
  await round(memory, key, tablet, 1200);
  // The desk's and the phone's states do not come through for the tablet a month later.
  const flaky: SyncStore = { ...memory, get: async (n) => (n.endsWith('.state') && !n.includes(tablet.id) ? Promise.reject(new Error('flaky')) : memory.get(n)) };
  await round(flaky, key, tablet, 1200 + 30 * DAY);
  assert.deepEqual(tablet.vault.notes, { a: 'x' });
  assert.equal(tablet.receipts.docs.size, 1);
  await round(memory, key, desk, 1300 + 30 * DAY);
  assert.deepEqual(desk.vault.notes, { a: 'x' });
  assert.equal(desk.receipts.docs.size, 1);
});

test('a deleted receipt\'s bytes leave the place once every device has taken in the deletion', async () => {
  const place = memoryPlace();
  const key = newGroupKey();
  const desk = device('Computer');
  const phone = device('Telefon');
  desk.receipts.docs.set('r1', { doc: receipt('r1', 'Bon.pdf'), bytes: Buffer.from('bon') });
  await round(place, key, desk, 1000);
  await round(place, key, phone, 1100);
  assert.equal(blobs(place), 1);
  // The receiving side never takes them out while it holds the receipt.
  await round(place, key, desk, 1200);
  assert.equal(blobs(place), 1);
  phone.receipts.docs.clear();
  await round(place, key, phone, 2000);
  assert.equal(blobs(place), 1, 'the desk has not taken in the deletion yet');
  assert.equal(phone.local.removing?.length, 1);
  const r = await round(place, key, desk, 2100);
  assert.equal(r.receipts.removed, 1);
  assert.equal(desk.local.uploaded.length, 0);
  await round(place, key, phone, 2200);
  assert.equal(blobs(place), 0);
  assert.equal(phone.local.removing, undefined);
  // The same receipt added again later: its bytes go to the place again, and reach the phone.
  desk.receipts.docs.set('r2', { doc: receipt('r2', 'Bon.pdf'), bytes: Buffer.from('bon') });
  await round(place, key, desk, 3000);
  assert.equal(blobs(place), 1);
  await round(place, key, phone, 3100);
  assert.equal(phone.receipts.docs.size, 1);
});

test('a receipt matched again on one device while another deletes it keeps its bytes, and reaches every device', async () => {
  const place = memoryPlace();
  const key = newGroupKey();
  const desk = device('Computer');
  const phone = device('Telefon');
  desk.receipts.docs.set('r1', { doc: receipt('r1', 'Bon.pdf'), bytes: Buffer.from('bon') });
  await round(place, key, desk, 1000);
  await round(place, key, phone, 1100);
  await round(place, key, desk, 1200);
  // Matched on the phone, deleted on the desk — the desk syncs first, the phone's later stamp wins.
  await phone.receipts.link([...phone.receipts.docs.keys()][0], '2026-11-01|-3.00|REWE|', 'DE01');
  desk.receipts.docs.clear();
  await round(place, key, desk, 2000);
  assert.equal(blobs(place), 1);
  await round(place, key, phone, 2100);
  assert.equal(phone.receipts.docs.size, 1);
  for (let t = 3000; t < 6000; t += 1000) {
    await round(place, key, desk, t);
    await round(place, key, phone, t + 100);
  }
  assert.equal(blobs(place), 1);
  assert.equal(desk.receipts.docs.size, 1, 'the desk takes it back');
  const tablet = device('Tablet');
  await round(place, key, tablet, 7000);
  assert.equal(tablet.receipts.docs.size, 1);
});

test('a receipt kept alive against a deletion goes up again when its bytes left the place', async () => {
  const place = memoryPlace();
  const key = newGroupKey();
  const desk = device('Computer');
  const phone = device('Telefon');
  desk.receipts.docs.set('r1', { doc: receipt('r1', 'Bon.pdf'), bytes: Buffer.from('bon') });
  await round(place, key, desk, 1000);
  await round(place, key, phone, 1100);
  await phone.receipts.link([...phone.receipts.docs.keys()][0], '2026-11-01|-3.00|REWE|', 'DE01');
  desk.receipts.docs.clear();
  await round(place, key, desk, 2000);
  // The bytes are gone anyway (an older version took them out, a round cut off): the phone puts them back.
  for (const name of [...place.files.keys()]) if (name.endsWith('.doc')) place.files.delete(name);
  await round(place, key, phone, 2100);
  assert.equal(blobs(place), 1);
  await round(place, key, desk, 3000);
  assert.equal(desk.receipts.docs.size, 1);
  assert.equal(desk.receipts.docs.values().next().value?.doc.tx, '2026-11-01|-3.00|REWE|');
});

test('a place with no room for a receipt\'s file skips it, and everything else still syncs', async () => {
  const memory = memoryPlace();
  const key = newGroupKey();
  const desk = device('Computer', { notes: { a: 'Notiz' } });
  const phone = device('Telefon');
  let room = false;
  const place: SyncStore = {
    ...memory,
    put: async (n, b) => {
      if (n.endsWith('.doc') && !room) throw new SyncPlaceError('full', 'computer 507');
      await memory.put(n, b);
    },
  };
  desk.receipts.docs.set('r1', { doc: receipt('r1', 'Bon.pdf'), bytes: Buffer.from('bon') });
  await round(place, key, desk, 1000);
  assert.deepEqual(desk.local.uploaded, []);
  await round(place, key, phone, 1100);
  assert.deepEqual(phone.vault.notes, { a: 'Notiz' });
  assert.equal(phone.receipts.docs.size, 0);
  // Room again: the receipt follows.
  room = true;
  await round(place, key, desk, 2000);
  await round(place, key, phone, 2100);
  assert.equal(phone.receipts.docs.size, 1);
  assert.equal(desk.receipts.docs.size, 1);
});

test('a place that cannot remove files still syncs a deleted receipt', async () => {
  const memory = memoryPlace();
  const place: SyncStore = { get: memory.get, put: memory.put };
  const key = newGroupKey();
  const desk = device('Computer');
  const phone = device('Telefon');
  desk.receipts.docs.set('r1', { doc: receipt('r1', 'Bon.pdf'), bytes: Buffer.from('bon') });
  await round(place, key, desk, 1000);
  await round(place, key, phone, 1100);
  phone.receipts.docs.clear();
  await round(place, key, phone, 2000);
  await round(place, key, desk, 2100);
  assert.equal(desk.receipts.docs.size, 0);
  assert.equal(blobs(memory), 1);
});

test('a round the place cuts off adds no receipt; one cut off after they arrived never stamps them anew', async () => {
  const place = memoryPlace();
  const key = newGroupKey();
  const desk = device('Computer');
  const phone = device('Telefon');
  desk.receipts.docs.set('r1', { doc: receipt('r1', 'Bon.pdf'), bytes: Buffer.from('bon') });
  await round(place, key, desk, 1000);
  // The place goes away mid-round (the phone leaves the Wi-Fi): nothing comes here unstamped.
  const failing: SyncStore = { ...place, put: async (n, b) => { if (n.endsWith('.state')) throw new Error('gone'); await place.put(n, b); } };
  await assert.rejects(round(failing, key, phone, 1100));
  assert.equal(phone.receipts.docs.size, 0);
  // A round that gets through, but its result is never kept (the app closed): what the checkpoint kept is all.
  let kept = phone.local;
  await runSync({
    store: place, key, device: { id: phone.id, name: phone.name }, vault: phone.vault, local: phone.local, receipts: phone.receipts, now: 1200,
    checkpoint: async (l) => { kept = l; },
  });
  phone.local = kept;
  assert.equal(phone.receipts.docs.size, 1);
  // Deleted on the desk meanwhile: the deletion wins on the phone, and it never comes back to the desk.
  desk.receipts.docs.clear();
  await round(place, key, desk, 2000);
  await round(place, key, phone, 3000);
  assert.equal(phone.receipts.docs.size, 0);
  await round(place, key, desk, 4000);
  assert.equal(desk.receipts.docs.size, 0);
});

test('what a device holds is stamped and kept before anything of its round reaches the place', async () => {
  const place = memoryPlace();
  const key = newGroupKey();
  const desk = device('Computer', { notes: { a: 'x' } });
  const events: string[] = [];
  const watched: SyncStore = { ...place, put: async (n, b) => { events.push(`put ${n.split('.').pop()}`); await place.put(n, b); } };
  desk.receipts.docs.set('r1', { doc: receipt('r1', 'Bon.pdf'), bytes: Buffer.from('bon') });
  await round(watched, key, desk, 1000, { checkpoint: async (l) => { events.push(`checkpoint ${Object.keys(l.stamps).length}`); } });
  assert.deepEqual(events, ['checkpoint 2', 'put doc', 'put state', 'put devices']);
  // Nothing new: no extra write.
  events.length = 0;
  await round(watched, key, desk, 2000, { checkpoint: async () => { events.push('checkpoint'); } });
  assert.deepEqual(events, ['put state', 'put devices']);
});

test('what the keeping changes keeps its time: devices that keep it differently do not send it back and forth', async () => {
  const place = memoryPlace();
  const key = newGroupKey();
  const desk = device('Computer', { notes: { a: 'Notiz' } });
  const phone = device('Telefon');
  // Two versions: the newer adds something, the older takes it off again.
  const notesBy = (f: (s: string) => string) => (v: VaultData) =>
    ({ ...v, notes: Object.fromEntries(Object.entries(v.notes).map(([k, s]) => [k, f(s)])) });
  const newer = notesBy((s) => (s.endsWith('!') ? s : `${s}!`));
  const older = notesBy((s) => s.replace(/!$/, ''));
  await round(place, key, desk, 1000, { keep: older });
  for (let t = 2000; t < 8000; t += 1000) {
    await round(place, key, phone, t, { keep: newer });
    await round(place, key, desk, t + 500, { keep: older });
  }
  assert.equal(phone.local.stamps['notes/a'].t, 1000);
  assert.equal(desk.local.stamps['notes/a'].t, 1000);
  assert.equal(phone.vault.notes.a, 'Notiz!');
  assert.equal(desk.vault.notes.a, 'Notiz');
  const r = await round(place, key, phone, 9000, { keep: newer });
  assert.equal(r.changed, false);
});

test('a copy a device keeps changed never wins over the original, whichever device id is larger', async () => {
  // The newer version's device wrote it; the older one strips what it does not know.
  const strip = (v: VaultData) => ({ ...v, notes: Object.fromEntries(Object.entries(v.notes).map(([k, s]) => [k, s.replace(/ \[neu\]$/, '')])) });
  for (const [newerId, olderId] of [['f'.repeat(16), '0'.repeat(16)], ['0'.repeat(16), 'f'.repeat(16)]]) {
    const place = memoryPlace();
    const key = newGroupKey();
    const newer = { ...device('Telefon', { notes: { a: 'Notiz [neu]' } }), id: newerId };
    const older = { ...device('Computer'), id: olderId };
    await round(place, key, newer, 1000);
    for (let t = 2000; t < 6000; t += 1000) {
      await round(place, key, older, t, { keep: strip });
      await round(place, key, newer, t + 500);
    }
    assert.equal(newer.vault.notes.a, 'Notiz [neu]', `newer ${newerId.slice(0, 1)}`);
    assert.equal(older.vault.notes.a, 'Notiz');
    assert.equal(older.local.stamps['notes/a'].t, 1000);
  }
});

test('a match a device could not follow still reaches the others', async () => {
  const place = memoryPlace();
  const key = newGroupKey();
  const desk = device('Computer');
  const phone = device('Telefon');
  desk.receipts.docs.set('r1', { doc: receipt('r1', 'Bon.pdf'), bytes: Buffer.from('bon') });
  await round(place, key, desk, 1000);
  await round(place, key, phone, 1100);
  // Matched on the phone; the desk, not knowing yet, renames it later.
  await phone.receipts.link([...phone.receipts.docs.keys()][0], '2026-11-01|-3.00|REWE|', 'DE01');
  await round(place, key, phone, 2000);
  desk.receipts.docs.get('r1')!.doc.name = 'Kassenbon.pdf';
  await round(place, key, desk, 2500);
  // The desk's newer entry has no match, which the phone cannot undo: its match goes on to the desk.
  await round(place, key, phone, 3000);
  await round(place, key, phone, 4000);
  await round(place, key, desk, 5000);
  assert.equal(desk.receipts.docs.get('r1')?.doc.tx, '2026-11-01|-3.00|REWE|');
});

test('a receipt the doc store keeps a little differently keeps its time too', async () => {
  const place = memoryPlace();
  const key = newGroupKey();
  const desk = device('Computer');
  const phone = device('Telefon');
  // This phone's doc store files it under a name of its own (lib/docs.ts sanitizeDoc).
  const add = phone.receipts.add;
  phone.receipts.add = (doc, bytes) => add({ ...doc, name: doc.name.toLowerCase() }, bytes);
  desk.receipts.docs.set('r1', { doc: receipt('r1', 'Bon.PDF'), bytes: Buffer.from('bon') });
  await round(place, key, desk, 1000);
  await round(place, key, phone, 2000);
  const path = Object.keys(phone.local.stamps).find((p) => p.startsWith('docs/'))!;
  assert.equal(phone.local.stamps[path].t, 1000);
  await round(place, key, phone, 3000);
  assert.equal(phone.local.stamps[path].t, 1000);
  // The desk keeps its own name: the phone's copy never wins over it.
  await round(place, key, desk, 4000);
  assert.equal(desk.receipts.docs.get('r1')?.doc.name, 'Bon.PDF');
  assert.equal(desk.local.stamps[path].t, 1000);
});

test('the code carries the key and the place, and only for the same login', () => {
  const key = newGroupKey();
  const code = makeCode(key, { blz: '50050201', userId: 'max' }, { kind: 'lan', addresses: ['192.168.1.20'], port: 45123 });
  const read = readCode(code);
  assert.ok(read);
  assert.deepEqual(read.key, key);
  assert.equal(read.tag, loginTag('50050201', 'max'));
  assert.notEqual(read.tag, loginTag('50050201', 'moritz'));
  assert.deepEqual(read.place, { kind: 'lan', addresses: ['192.168.1.20'], port: 45123 });
  // A folder's path stays on the device that chose it.
  const folder = readCode(makeCode(key, { blz: '1', userId: 'u' }, { kind: 'folder', path: 'C:\\Users\\me\\OneDrive\\Girovo' }));
  assert.deepEqual(folder?.place, { kind: 'folder' });
  assert.equal(readCode('girovo-sync:1:not-base64-json'), null);
  assert.equal(readCode('something else'), null);
});

test('readPlace: only private addresses, only https for WebDAV', () => {
  assert.equal(readPlace({ kind: 'lan', addresses: ['8.8.8.8'], port: 45000 }), null);
  assert.deepEqual(readPlace({ kind: 'lan', addresses: ['10.0.0.5', '8.8.8.8'], port: 45000 }), { kind: 'lan', addresses: ['10.0.0.5'], port: 45000 });
  assert.equal(readPlace({ kind: 'webdav', url: 'http://cloud.example', user: 'a', password: 'b' }), null);
  assert.deepEqual(readPlace({ kind: 'webdav', url: 'https://cloud.example/remote.php/dav/files/me/Girovo/', user: 'me', password: 'pw' }),
    { kind: 'webdav', url: 'https://cloud.example/remote.php/dav/files/me/Girovo', user: 'me', password: 'pw' });
});

// ---- booking keys moved inside a round (lib/booking-keys.ts) -----------------------

test('a round with booking key moves: moved after the merge, at the old entry’s time, and the same on the other device', async () => {
  const { keyMoves } = await import('./booking-keys.ts');
  const { legacyTxKey, txKey } = await import('./categories.ts');
  const tx = { entryDate: '2026-10-31T23:00:00.000Z', valueDate: '2026-10-31T23:00:00.000Z', amount: -12.9, remoteIban: 'DE02120300000000202051', remoteName: '', e2eReference: 'E1', bankReference: '' };
  const [OLD, NEW] = [legacyTxKey(tx), txKey(tx)];
  const moves = keyMoves([{ txs: [tx as never] }]);
  const place = memoryPlace();
  const key = newGroupKey();
  const desk = device('Computer', { notes: { [OLD]: 'Geschenk' } });
  const phone = device('Telefon');
  await round(place, key, desk, 1000);
  await round(place, key, phone, 1100);
  // The phone (the version before) changes the note under the old key; the desk moves in its next round.
  phone.vault = { ...phone.vault, notes: { [OLD]: 'Geschenk für Mama' } };
  await round(place, key, phone, 2000);
  const r = await round(place, key, desk, 3000, { moves });
  assert.equal(r.changed, true);
  assert.deepEqual(desk.vault.notes, { [NEW]: 'Geschenk für Mama' }, 'the phone’s edit came in before the move');
  assert.equal(desk.local.stamps[`notes/${NEW}`].t, 2000, 'at the time of that edit, not of the move');
  assert.equal(desk.local.stamps[`notes/${OLD}`].h, '-');
  await round(place, key, phone, 4000);
  assert.deepEqual(phone.vault.notes, { [NEW]: 'Geschenk für Mama' });
  // Nothing left to move: the next round changes nothing.
  assert.equal((await round(place, key, desk, 5000, { moves })).changed, false);
});

test('a round too full for what is new still moves: measured without what it leaves out, and what the move wrote stays', async () => {
  const { keyMoves } = await import('./booking-keys.ts');
  const { legacyTxKey, txKey } = await import('./categories.ts');
  const tx = { entryDate: '2026-10-31T23:00:00.000Z', valueDate: '2026-10-31T23:00:00.000Z', amount: -12.9, remoteIban: 'DE02120300000000202051', remoteName: '', e2eReference: 'E1', bankReference: '' };
  const [OLD, NEW] = [legacyTxKey(tx), txKey(tx)];
  const place = memoryPlace();
  const key = newGroupKey();
  const desk = device('Computer', { notes: longNotes('d', 30) });
  const phone = device('Telefon', { notes: { ...longNotes('p', 30), [OLD]: 'Geschenk' } });
  const maxBytes = Math.ceil((bytesOf(phone.vault) + 2000) / FILL_MAX);
  await round(place, key, desk, 1000);
  const r = await round(place, key, phone, 2000, { maxBytes, moves: keyMoves([{ txs: [tx as never] }]) });
  assert.ok(r.full > 0, 'some of the desk’s notes had no room');
  assert.equal(phone.vault.notes[NEW], 'Geschenk');
  assert.equal(phone.vault.notes[OLD], undefined);
  assert.ok(bytesOf(phone.vault) <= Math.floor(maxBytes * FILL_MAX));
  // A vault that is too full even without anything new: nothing moves, nothing is stamped as deleted.
  const full = device('Tablet', { notes: { ...longNotes('t', 30), [OLD]: 'Geschenk' } });
  const tight = Math.ceil(bytesOf(full.vault) / FILL_MAX);
  await round(memoryPlace(), newGroupKey(), full, 4000, { maxBytes: tight, moves: keyMoves([{ txs: [tx as never] }]) });
  assert.equal(full.vault.notes[OLD], 'Geschenk');
  assert.equal(full.vault.notes[NEW], undefined);
  assert.ok(full.local.stamps[`notes/${OLD}`]?.h !== '-', 'not stamped as deleted');
});

test('a receipt re-tied on the version before after this device last met it keeps that choice when this device moves keys (q3)', async () => {
  const { keyMoves } = await import('./booking-keys.ts');
  const { legacyTxKey } = await import('./categories.ts');
  const tx = { entryDate: '2026-10-31T23:00:00.000Z', valueDate: '2026-10-31T23:00:00.000Z', amount: -12.9, remoteIban: 'DE02120300000000202051', remoteName: '', e2eReference: 'E1', bankReference: '' };
  const OLD = legacyTxKey(tx);
  const M = '2026-11-03|-12.90|DE02120300000000202051|E2';
  const place = memoryPlace();
  const key = newGroupKey();
  const desk = device('Computer');
  const phone = device('Telefon');
  desk.receipts.docs.set('r1', { doc: { ...receipt('r1', 'Beleg.pdf'), accountNumber: '1', tx: OLD }, bytes: new Uint8Array([1, 2, 3]) });
  await round(place, key, desk, 1000);
  await round(place, key, phone, 1100);
  // On the phone (the version before) the user ties the receipt to the booking they meant.
  const [pid] = phone.receipts.docs.keys();
  await phone.receipts.link(pid, M, '1');
  await round(place, key, phone, 2000);
  // The desk moves keys in its round: the page ties nothing itself while sync is on.
  const r = await round(place, key, desk, 3000, { moves: keyMoves([{ txs: [tx as never] }]) });
  await round(place, key, phone, 4000);
  assert.equal([...desk.receipts.docs.values()][0].doc.tx, M);
  assert.equal([...phone.receipts.docs.values()][0].doc.tx, M);
  assert.equal(r.receipts.relinked, 1, 'the page is told to list its receipts again');
});

test('a receipt still tied to a key from before is tied to the key now by the round, on every device', async () => {
  const { keyMoves } = await import('./booking-keys.ts');
  const { legacyTxKey, txKey } = await import('./categories.ts');
  const tx = { entryDate: '2026-10-31T23:00:00.000Z', valueDate: '2026-10-31T23:00:00.000Z', amount: -12.9, remoteIban: 'DE02120300000000202051', remoteName: '', e2eReference: 'E1', bankReference: '' };
  const [OLD, NEW] = [legacyTxKey(tx), txKey(tx)];
  const place = memoryPlace();
  const key = newGroupKey();
  const desk = device('Computer');
  const phone = device('Telefon');
  desk.receipts.docs.set('r1', { doc: { ...receipt('r1', 'Beleg.pdf'), accountNumber: '1', tx: OLD }, bytes: new Uint8Array([1, 2, 3]) });
  await round(place, key, desk, 1000);
  await round(place, key, phone, 1100);
  const r = await round(place, key, desk, 2000, { moves: keyMoves([{ txs: [tx as never] }]) });
  assert.equal(r.receipts.relinked, 1);
  await round(place, key, phone, 3000);
  assert.equal([...desk.receipts.docs.values()][0].doc.tx, NEW);
  assert.equal([...phone.receipts.docs.values()][0].doc.tx, NEW);
  // Nothing more the next time.
  assert.equal((await round(place, key, desk, 4000, { moves: keyMoves([{ txs: [tx as never] }]) })).receipts.relinked, 0);
});

test('pairs that are no booking’s key from before and key now are not moved, whoever asks the round (q1 Q2)', async () => {
  const { legacyTxKey } = await import('./categories.ts');
  const tx = { entryDate: '2026-10-31T23:00:00.000Z', valueDate: '2026-10-31T23:00:00.000Z', amount: -12.9, remoteIban: 'DE02120300000000202051', remoteName: '', e2eReference: 'E1', bankReference: '' };
  const OLD = legacyTxKey(tx);
  const OTHER = 'd2|2026-11-05|-99.00|DE00OTHER|X';
  for (const to of [OTHER, 'd2|1999-01-01|0.00||']) {
    const place = memoryPlace();
    const key = newGroupKey();
    const desk = device('Computer', { notes: { [OLD]: 'Geschenk für Mama', [OTHER]: 'Miete' } });
    await round(place, key, desk, 1000);
    await round(place, key, desk, 2000, { moves: new Map([[OLD, { to }]]) });
    assert.deepEqual(desk.vault.notes, { [OLD]: 'Geschenk für Mama', [OTHER]: 'Miete' }, to);
  }
});
