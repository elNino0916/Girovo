import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_VAULT, type VaultData } from './app-types.ts';
import type { KeptDoc } from './docs';
import {
  blobFile, devicesFile, groupOf, loginTag, makeCode, newDeviceId, newGroupKey, readCode, readPlace, runSync,
  seal, stateFile, unseal, type ReceiptsSide, type SyncLocal, type SyncStore,
} from './sync.ts';

/** A place in memory that every device reaches. */
function memoryPlace(): SyncStore & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return { files, get: async (n) => files.get(n) ?? null, put: async (n, b) => { files.set(n, b); } };
}

/** One device's receipts. */
function receiptsOf(): ReceiptsSide & { docs: Map<string, { doc: KeptDoc; bytes: Uint8Array }> } {
  const docs = new Map<string, { doc: KeptDoc; bytes: Uint8Array }>();
  return {
    docs,
    list: async () => [...docs.values()].map((d) => d.doc),
    read: async (id) => docs.get(id)!.bytes,
    add: async (doc, bytes) => { docs.set(doc.id, { doc, bytes }); return doc.id; },
    remove: async (id) => { docs.delete(id); },
    link: async (id, tx, accountNumber) => { const d = docs.get(id)!; d.doc = { ...d.doc, tx, accountNumber }; },
  };
}

const fresh = (): SyncLocal => ({ stamps: {}, uploaded: [], hashes: {} });

function device(name: string, vault: Partial<VaultData> = {}) {
  return { id: newDeviceId(), name, vault: { ...EMPTY_VAULT, ...vault } as VaultData, local: fresh(), receipts: receiptsOf() };
}

async function round(place: SyncStore, key: Buffer, d: ReturnType<typeof device>, now: number) {
  const r = await runSync({ store: place, key, device: { id: d.id, name: d.name }, vault: d.vault, local: d.local, receipts: d.receipts, now });
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
  assert.ok(groupOf(key).length === 24 && !blobFile(key, 'abc').includes('abc'));
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
