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
  // Nothing on disk says what it is.
  for (const name of fs.readdirSync(dir)) {
    const raw = fs.readFileSync(path.join(dir, name), 'utf8');
    assert.ok(!raw.includes('Rechnung') && !raw.includes('PNG'), name);
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
