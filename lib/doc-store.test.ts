import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ElectronicStatement } from 'lib-fints';
import type { Session } from './session';

// STATE_DIR is read when state-store.ts loads: the scratch directory first.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fints-docs-'));
process.env.FINTS_STATE_DIR = dir;
const store = await import('./doc-store.ts');

after(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Just enough of a Session for the store: who, which bank, the PIN. */
const fakeSession = (pin: string, userId = 'kunde1', blz = '12345678') =>
  ({ meta: { blz }, client: { config: { userId, pin } } }) as unknown as Session;

const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

const statement = (number: number, year = 2026): ElectronicStatement => ({
  format: '3', number, year, date: new Date(2026, number - 1, 28), document: new Uint8Array(PDF),
});

test('a receipt goes in sealed and comes out whole', async () => {
  const s = fakeSession('1234');
  const doc = await store.addReceipt(s, { name: 'Rechnung.pdf', data: PNG, accountNumber: '42', tx: 'k1', awaiting: null });
  // The bytes decide: a PNG named .pdf is a PNG.
  assert.equal(doc.mime, 'image/png');
  assert.equal(doc.name, 'Rechnung.png');
  const back = await store.readDoc(fakeSession('1234'), doc.id);
  assert.deepEqual(back.bytes, PNG);
  // Nothing on disk says what it is: not the name, not the PNG's signature
  // ("PNG" alone turns up in the sealed files' base64 every few hundred runs).
  for (const name of fs.readdirSync(dir)) {
    const raw = fs.readFileSync(path.join(dir, name), 'utf8');
    assert.ok(!raw.includes('Rechnung') && !raw.includes('PNG\r\n'), name);
  }
});

test('the bank\'s statements are kept once each', async () => {
  const s = fakeSession('1234');
  const first = await store.keepStatements(s, '42', [statement(1), statement(2)]);
  assert.equal(first.added.length, 2);
  assert.equal(first.held, false);
  const again = await store.keepStatements(s, '42', [statement(2), statement(3)]);
  assert.deepEqual(again.added.map((d) => d.number), [3]);
  const { docs, locked } = await store.listDocs(s);
  assert.equal(locked, false);
  assert.equal(docs.filter((d) => d.kind === 'statement').length, 3);
  assert.equal(docs.find((d) => d.number === 3)?.name, 'Kontoauszug 2026-003.pdf');
});

test('another PIN opens nothing, and a statement it fetches is held, not lost', async () => {
  const other = fakeSession('9999');
  await assert.rejects(store.addReceipt(other, { name: 'x', data: PNG, accountNumber: null, tx: 'k', awaiting: null }), { status: 409 });
  const kept = await store.keepStatements(other, '42', [statement(4)]);
  assert.equal(kept.held, true);
  const { docs, locked } = await store.listDocs(other);
  assert.equal(locked, true);
  assert.deepEqual(docs.map((d) => d.number), [4]);
  const held = await store.readDoc(other, kept.added[0].id);
  assert.deepEqual(held.bytes, PDF);
});

test('a waiting receipt is linked to its booking; a removed one is gone from disk', async () => {
  const s = fakeSession('1234');
  const doc = await store.addReceipt(s, {
    name: 'Strom.pdf', data: PDF, accountNumber: '42', tx: null,
    awaiting: { iban: 'DE12500105170648489890', cents: 4200, sentAt: new Date().toISOString() },
  });
  assert.ok(doc.awaiting);
  const linked = await store.linkReceipt(s, doc.id, 'k2', '42');
  assert.equal(linked.tx, 'k2');
  assert.equal(linked.awaiting, null);
  const files = fs.readdirSync(dir).length;
  await store.removeDoc(s, doc.id);
  assert.equal(fs.readdirSync(dir).length, files - 1);
  await assert.rejects(store.readDoc(s, doc.id), { status: 404 });
});

test('too large is refused before anything is written', async () => {
  const s = fakeSession('1234');
  await assert.rejects(
    store.addReceipt(s, { name: 'big.pdf', data: Buffer.concat([PDF, Buffer.alloc(8 * 1024 * 1024)]), accountNumber: null, tx: 'k', awaiting: null }),
    { status: 413 },
  );
});

test('the wipe takes every document of the login, and nothing else', async () => {
  fs.writeFileSync(path.join(dir, 'unrelated.vault'), '{}');
  const removed = await store.wipeDocs(fakeSession('1234'));
  assert.ok(removed >= 5);
  assert.deepEqual(fs.readdirSync(dir), ['unrelated.vault']);
});

// After the PIN changed at the bank (another login, so the wipe above is not disturbed).

const changer = (pin: string) => fakeSession(pin, 'wechsler', '87654321');
/** The bank has taken the session's PIN (Session.pinAccepted). */
const accepted = (s: Session) => Object.assign(s, { pinAccepted: true as const });
const familyOf = (blz: string, userId: string) => fs.readdirSync(dir).filter((n) => n.startsWith(store.docsBaseName(blz, userId)));

test('a changed PIN: the store is reset only when asked, set aside rather than deleted', async () => {
  const before = changer('1111');
  const receipt = await store.addReceipt(before, { name: 'Alt.pdf', data: PDF, accountNumber: '7', tx: 'k7', awaiting: null });
  const oldFiles = familyOf('87654321', 'wechsler').sort();
  assert.equal(oldFiles.length, 2, 'the index and one document');

  // The new PIN: nothing opens, and a statement the bank hands over is held.
  const after = changer('2222');
  const kept = await store.keepStatements(after, '7', [statement(9)]);
  assert.equal(kept.held, true);
  assert.equal((await store.listDocs(after)).locked, true);
  await assert.rejects(store.addReceipt(after, { name: 'x', data: PNG, accountNumber: '7', tx: 'k8', awaiting: null }), { status: 409 });
  // Listing never touches the files: nothing is reset unasked.
  assert.deepEqual(familyOf('87654321', 'wechsler').sort(), oldFiles);

  // Not before the bank has taken the PIN: it may be a typo, and the real
  // store would end up in the backup only.
  assert.equal((await store.listDocs(after)).resettable, false);
  await assert.rejects(store.resetDocs(after), { status: 409 });
  assert.deepEqual(familyOf('87654321', 'wechsler').sort(), oldFiles);
  assert.equal((await store.listDocs(after)).locked, true);

  accepted(after);
  assert.equal((await store.listDocs(after)).resettable, true);
  const reset = await store.resetDocs(after);
  assert.equal(reset.reset, true);
  assert.equal(reset.locked, false);
  assert.deepEqual(reset.docs.map((d) => d.number), [9], 'the held statement went into the new store');
  // The old index set aside, its document where it was: nothing deleted.
  const index = store.docsBaseName('87654321', 'wechsler');
  const now = familyOf('87654321', 'wechsler');
  assert.ok(now.includes(`${index}.bak`));
  for (const name of oldFiles.filter((n) => n !== index)) assert.ok(now.includes(name), name);

  // A later session with the new PIN opens it, the statement and new receipts kept for good.
  const later = changer('2222');
  const listed = await store.listDocs(later);
  assert.equal(listed.locked, false);
  assert.deepEqual(listed.docs.map((d) => d.number), [9]);
  assert.deepEqual((await store.readDoc(later, kept.added[0].id)).bytes, PDF);
  await store.addReceipt(later, { name: 'Neu.png', data: PNG, accountNumber: '7', tx: 'k9', awaiting: null });
  assert.equal((await store.listDocs(changer('2222'))).docs.length, 2);

  // The old index, put back, still opens with the old PIN — and its document with it.
  const file = path.join(dir, index);
  fs.renameSync(file, `${file}.new`);
  fs.renameSync(`${file}.bak`, file);
  const old = changer('1111');
  assert.deepEqual((await store.listDocs(old)).docs.map((d) => d.id), [receipt.id]);
  assert.deepEqual((await store.readDoc(old, receipt.id)).bytes, PDF);
  fs.renameSync(file, `${file}.bak`);
  fs.renameSync(`${file}.new`, file);
});

test('a store that opens, or none at all, is left as it is', async () => {
  const s = changer('2222');
  const before = familyOf('87654321', 'wechsler').sort();
  const reset = await store.resetDocs(s);
  assert.equal(reset.reset, false);
  assert.equal(reset.docs.length, 2);
  assert.deepEqual(familyOf('87654321', 'wechsler').sort(), before);
  const none = await store.resetDocs(fakeSession('3333', 'niemand', '11111111'));
  assert.deepEqual(none, { docs: [], locked: false, resettable: false, reset: false });
  assert.deepEqual(familyOf('11111111', 'niemand'), []);
});

test('a second reset never overwrites the first backup', async () => {
  const s = accepted(changer('4444'));
  assert.equal((await store.listDocs(s)).locked, true);
  assert.equal((await store.resetDocs(s)).reset, true);
  const index = store.docsBaseName('87654321', 'wechsler');
  const baks = familyOf('87654321', 'wechsler').filter((n) => n.endsWith('.bak'));
  assert.equal(baks.length, 2);
  assert.ok(baks.includes(`${index}.bak`));
});

test('wipeDocsOf takes a login\'s documents by its name, backups included, and nothing else', async () => {
  const other = await store.addReceipt(fakeSession('5555', 'andere', '22222222'), { name: 'b.pdf', data: PDF, accountNumber: null, tx: 'k', awaiting: null });
  assert.ok(other.id);
  const removed = await store.wipeDocsOf({ blz: '87654321', userId: 'wechsler' });
  assert.ok(removed >= 6, String(removed));
  assert.deepEqual(familyOf('87654321', 'wechsler'), []);
  assert.equal(familyOf('22222222', 'andere').length, 2);
  await store.wipeDocsOf({ blz: '22222222', userId: 'andere' });
  // Nothing there: nothing to do, no error.
  assert.equal(await store.wipeDocsOf({ blz: '22222222', userId: 'andere' }), 0);
});

test('a wipe that fails leaves the session keeping documents', async () => {
  const s = fakeSession('7777', 'klemmt', '44444444');
  await store.addReceipt(s, { name: 'a.pdf', data: PDF, accountNumber: null, tx: 'k', awaiting: null });
  // One of the family that cannot go: a folder under its name.
  const stuck = path.join(dir, `${store.docsBaseName('44444444', 'klemmt')}.stuck`);
  fs.mkdirSync(stuck);
  fs.writeFileSync(path.join(stuck, 'x'), 'x');
  try {
    await assert.rejects(store.wipeDocs(s), { status: 500 });
    // Not "nothing more until the logout": the wipe did not happen.
    await store.addReceipt(s, { name: 'b.pdf', data: PDF, accountNumber: null, tx: 'k', awaiting: null });
    // A wipe that failed as a whole after this one went through: resumeDocs lets it keep documents again.
    fs.rmSync(stuck, { recursive: true, force: true });
    await store.wipeDocs(s);
    await assert.rejects(store.addReceipt(s, { name: 'c.pdf', data: PDF, accountNumber: null, tx: 'k', awaiting: null }), { status: 409 });
    store.resumeDocs(s);
    await store.addReceipt(s, { name: 'd.pdf', data: PDF, accountNumber: null, tx: 'k', awaiting: null });
  } finally {
    fs.rmSync(stuck, { recursive: true, force: true });
    await store.wipeDocsOf({ blz: '44444444', userId: 'klemmt' });
  }
});

test('after the wipe nothing more is written for the session: a receipt refused, a statement held', async () => {
  const s = fakeSession('6666', 'geloescht', '33333333');
  await store.addReceipt(s, { name: 'a.pdf', data: PDF, accountNumber: null, tx: 'k', awaiting: null });
  await store.wipeDocs(s);
  await assert.rejects(store.addReceipt(s, { name: 'b.pdf', data: PDF, accountNumber: null, tx: 'k', awaiting: null }), { status: 409 });
  const kept = await store.keepStatements(s, '9', [statement(1)]);
  assert.equal(kept.held, true);
  assert.deepEqual(familyOf('33333333', 'geloescht'), []);
  // Another session of the login (the next login) keeps documents again.
  await store.addReceipt(fakeSession('6666', 'geloescht', '33333333'), { name: 'c.pdf', data: PDF, accountNumber: null, tx: 'k', awaiting: null });
  assert.equal(familyOf('33333333', 'geloescht').length, 2);
  await store.wipeDocsOf({ blz: '33333333', userId: 'geloescht' });
});
