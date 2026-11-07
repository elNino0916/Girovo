import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Session } from './session';

// STATE_DIR is read when state-store.ts loads: the scratch directory first.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fints-wipe-'));
process.env.FINTS_STATE_DIR = dir;
const wipe = await import('./wipe-saved.ts');
const docs = await import('./doc-store.ts');
const history = await import('./history-store.ts');
const vault = await import('./vault.ts');
const { EMPTY_VAULT } = await import('./app-types.ts');
const { groupOf } = await import('./sync.ts');
const { lanHostDir } = await import('./sync-stores.ts');

after(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Just enough of a Session for the stores: who, which bank, the PIN — taken by the bank (resetHistory asks). */
const fakeSession = (pin: string, userId: string, blz: string) =>
  ({ meta: { blz }, client: { config: { userId, pin } }, pinAccepted: true }) as unknown as Session;

const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n');

const primary = fakeSession('11111', 'erste', '10010010');
const loggedIn = fakeSession('22222', 'zweite', '20020020');
const notLoggedIn = { blz: '30030030', userId: 'dritte' };
const stranger = fakeSession('44444', 'fremde', '40040040');

/** A login's files in the state directory: its documents and its kept Umsätze. */
const filesOf = (login: { blz: string; userId: string }) => fs.readdirSync(dir).filter((n) =>
  n.startsWith(docs.docsBaseName(login.blz, login.userId)) || n.startsWith(history.historyBaseName(login.blz, login.userId)));

const loginOf = (s: Session) => ({ blz: String(s.meta!.blz), userId: String(s.client!.config.userId) });

/** One receipt and a kept Umsätze file (a reset writes an empty one) for the login of `s`. */
async function keepSomething(s: Session) {
  await docs.addReceipt(s, { name: 'Beleg.pdf', data: PDF, accountNumber: null, tx: 'k', awaiting: null });
  await history.resetHistory(s);
}

test('sessionsNamed: the browser\'s own session ids only, at most a view\'s further banks', () => {
  const known = new Map([['a', loggedIn], ['b', stranger]]);
  const lookup = (id: string) => known.get(id) ?? null;
  assert.deepEqual(wipe.sessionsNamed(['a', 'nope', 42, null, 'b'], lookup), [loggedIn, stranger]);
  assert.deepEqual(wipe.sessionsNamed('a', lookup), []);
  assert.deepEqual(wipe.sessionsNamed(undefined, lookup), []);
  assert.equal(wipe.sessionsNamed(Array(20).fill('a'), lookup).length, 8);
});

test('every further bank\'s Umsätze and documents go — logged in now or named by the vault', async () => {
  await vault.saveVault(primary, {
    ...EMPTY_VAULT,
    linkedBanks: [
      { blz: loginOf(loggedIn).blz, userId: loginOf(loggedIn).userId, name: 'Zweite Bank' },
      { ...notLoggedIn, name: 'Dritte Bank' },
    ],
  });
  for (const s of [primary, loggedIn, fakeSession('33333', notLoggedIn.userId, notLoggedIn.blz), stranger]) await keepSomething(s);
  assert.equal(filesOf(notLoggedIn).length, 3, 'index, document, Umsätze');

  const removed = await wipe.wipeFurtherBanks(primary, [loggedIn, primary, null]);
  assert.equal(removed, 6);
  assert.deepEqual(filesOf(loginOf(loggedIn)), []);
  assert.deepEqual(filesOf(notLoggedIn), []);
  // The primary login's own files are the routes' to delete (wipeHistory, wipeDocs); a stranger's nobody's.
  assert.equal(filesOf(loginOf(primary)).length, 3);
  assert.equal(filesOf(loginOf(stranger)).length, 3);
  // Nothing more is kept for the session that is logged in: its documents list is empty.
  assert.deepEqual((await docs.listDocs(loggedIn)).docs, []);
});

test('a vault this PIN does not open names nobody: only the sessions go', async () => {
  const third = fakeSession('33333', notLoggedIn.userId, notLoggedIn.blz);
  await keepSomething(third);
  // A new login of the second bank: the session wiped before keeps nothing more.
  const second = fakeSession('22222', 'zweite', '20020020');
  await assert.rejects(docs.addReceipt(loggedIn, { name: 'x.pdf', data: PDF, accountNumber: null, tx: 'k', awaiting: null }), { status: 409 });
  await keepSomething(second);
  const changedPin = fakeSession('99999', 'erste', '10010010');
  assert.equal((await vault.loadVault(changedPin)).status, 'error');
  await wipe.wipeFurtherBanks(changedPin, [second]);
  assert.deepEqual(filesOf(loginOf(second)), []);
  assert.equal(filesOf(notLoggedIn).length, 3);
  await docs.wipeDocsOf(notLoggedIn);
  await history.wipeHistoryOf(notLoggedIn);
  assert.deepEqual(filesOf(notLoggedIn), []);
});

test('a wipe that fails part way lets the sessions it went through keep documents again', async () => {
  const fourth = fakeSession('55555', 'vierte', '50050050');
  const fifth = fakeSession('66666', 'fuenfte', '60060060');
  await keepSomething(fourth);
  await keepSomething(fifth);
  // The fifth bank's documents cannot go: a folder under their name.
  const stuck = path.join(dir, `${docs.docsBaseName('60060060', 'fuenfte')}.stuck`);
  fs.mkdirSync(stuck);
  fs.writeFileSync(path.join(stuck, 'x'), 'x');
  try {
    await assert.rejects(wipe.wipeFurtherBanks(primary, [fourth, fifth]), { status: 500 });
    // The fourth's files went, but the wipe as a whole did not: it keeps documents again.
    assert.equal(filesOf(loginOf(fourth)).length, 0);
    await docs.addReceipt(fourth, { name: 'neu.pdf', data: PDF, accountNumber: null, tx: 'k', awaiting: null });
    await docs.addReceipt(fifth, { name: 'neu.pdf', data: PDF, accountNumber: null, tx: 'k', awaiting: null });
    // wipeFailed does the same for what went through before a later step failed (the routes).
    await docs.wipeDocs(fourth);
    await assert.rejects(docs.addReceipt(fourth, { name: 'x.pdf', data: PDF, accountNumber: null, tx: 'k', awaiting: null }), { status: 409 });
    wipe.wipeFailed([fourth]);
    await docs.addReceipt(fourth, { name: 'y.pdf', data: PDF, accountNumber: null, tx: 'k', awaiting: null });
  } finally {
    fs.rmSync(stuck, { recursive: true, force: true });
    for (const s of [fourth, fifth]) {
      await docs.wipeDocsOf(loginOf(s));
      await history.wipeHistoryOf(loginOf(s));
    }
  }
});

test('the same login twice, or the primary\'s own, is never wiped through this path', async () => {
  await keepSomething(primary);
  const before = filesOf(loginOf(primary)).length;
  const twin = fakeSession('11111', 'erste', '10010010');
  await wipe.wipeFurtherBanks(primary, [twin]);
  assert.equal(filesOf(loginOf(primary)).length, before);
});

test('the sync group\'s files leave the LAN shelf, another group\'s stay', async () => {
  const key = crypto.randomBytes(32);
  const other = crypto.randomBytes(32);
  const shelf = lanHostDir();
  fs.mkdirSync(shelf, { recursive: true });
  const g = groupOf(key);
  const mine = [`${g}.devices`, `${g}.0011223344556677.state`, `${g}.00112233445566778899aabbccddeeff.doc`, `${g}.token`];
  for (const name of mine) fs.writeFileSync(path.join(shelf, name), 'sealed');
  fs.writeFileSync(path.join(shelf, `${groupOf(other)}.devices`), 'sealed');
  assert.equal(await wipe.forgetLanGroup(key), mine.length);
  assert.deepEqual(fs.readdirSync(shelf), [`${groupOf(other)}.devices`]);
  // No shelf folder at all: nothing to do.
  fs.rmSync(shelf, { recursive: true, force: true });
  assert.equal(await wipe.forgetLanGroup(key), 0);
});

test('on the desktop the shell deletes the shelf\'s files on disk; a failure there stops the wipe', async () => {
  const key = crypto.randomBytes(32);
  const asked: string[] = [];
  const g = globalThis as { __girovoLanForget?: (group: string) => Promise<number> };
  try {
    g.__girovoLanForget = async (group) => {
      asked.push(group);
      return 3;
    };
    assert.equal(await wipe.forgetLanGroup(key), 3);
    assert.deepEqual(asked, [groupOf(key)]);
    g.__girovoLanForget = async () => {
      throw new Error('EIO: 1 file(s) of the group left');
    };
    await assert.rejects(wipe.forgetLanGroup(key), (err: unknown) => err instanceof vault.VaultError && err.status === 500);
  } finally {
    delete g.__girovoLanForget;
  }
});
