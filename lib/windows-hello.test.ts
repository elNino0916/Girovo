import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// STATE_DIR is read when state-store.ts loads, so the scratch directory has to
// be in place before the first import of windows-hello.ts.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fints-hello-'));
process.env.FINTS_STATE_DIR = dir;
const store = await import('./windows-hello.ts');

after(() => fs.rmSync(dir, { recursive: true, force: true }));

const login = { blz: '12345678', userId: 'kunde1', pin: '12345' };
const other = { blz: '50050201', userId: 'max', pin: '54321' };
const helloKey = crypto.randomBytes(store.HELLO_KEY_BYTES);
const secret = crypto.randomBytes(32);

test('parseHelloKey: exactly 32 bytes of base64, nothing else', () => {
  assert.deepEqual(store.parseHelloKey(helloKey.toString('base64')), helloKey);
  assert.equal(store.parseHelloKey(crypto.randomBytes(16).toString('base64')), null);
  assert.equal(store.parseHelloKey('not base64!'), null);
  assert.equal(store.parseHelloKey(undefined), null);
});

test('readLoginName: a BLZ of eight digits and a login name on one line', () => {
  assert.deepEqual(store.readLoginName({ blz: '12345678', userId: 'kunde1', pin: 'dropped' }), { blz: '12345678', userId: 'kunde1' });
  assert.equal(store.readLoginName({ blz: '1234', userId: 'kunde1' }), null);
  assert.equal(store.readLoginName({ blz: '12345678', userId: 'zwei\nzeilen' }), null);
  assert.equal(store.readLoginName({ blz: '12345678', userId: '' }), null);
  assert.equal(store.readLoginName(null), null);
});

test('a login with nothing kept is off and opens to nothing', async () => {
  assert.equal(store.isOn(login), false);
  assert.equal(await store.openPin(login, helloKey, secret), null);
});

test('the kept PIN opens with the Windows Hello key and the secret together', async () => {
  await store.sealPin(login, helloKey, secret);
  assert.equal(store.isOn(login), true);
  assert.deepEqual(await store.openPin(login, helloKey, secret), { pin: '12345' });
  // The file names neither the login nor the PIN.
  const raw = fs.readFileSync(store.windowsHelloFile(login.blz, login.userId), 'utf8');
  assert.ok(!raw.includes('12345') && !raw.includes('kunde1'));
  assert.ok(path.basename(store.windowsHelloFile(login.blz, login.userId)).endsWith('.hello'));
});

test('a wrong key — Windows Hello\'s or the secret — deletes the file for good', async () => {
  await store.sealPin(login, helloKey, secret);
  assert.deepEqual(await store.openPin(login, crypto.randomBytes(32), secret), { dropped: true });
  assert.equal(store.isOn(login), false);
  await store.sealPin(login, helloKey, secret);
  assert.deepEqual(await store.openPin(login, helloKey, crypto.randomBytes(32)), { dropped: true });
  assert.equal(store.isOn(login), false);
});

test('one login\'s file cannot be passed off as another\'s', async () => {
  await store.sealPin(login, helloKey, secret);
  fs.copyFileSync(store.windowsHelloFile(login.blz, login.userId), store.windowsHelloFile(other.blz, other.userId));
  assert.deepEqual(await store.openPin(other, helloKey, secret), { dropped: true });
  assert.deepEqual(await store.openPin(login, helloKey, secret), { pin: '12345' });
});

test('a new seal replaces the PIN kept before (it was changed at the bank)', async () => {
  await store.sealPin(login, helloKey, secret);
  await store.sealPin({ ...login, pin: '67890' }, helloKey, secret);
  assert.deepEqual(await store.openPin(login, helloKey, secret), { pin: '67890' });
});

test('something that is not a PIN is never kept', async () => {
  await assert.rejects(store.sealPin({ ...other, pin: '' }, helloKey, secret));
  await assert.rejects(store.sealPin({ ...other, pin: 'zwei\nzeilen' }, helloKey, secret));
  assert.equal(store.isOn(other), false);
});

test('removing it deletes the file and every copy beside it', async () => {
  await store.sealPin(login, helloKey, secret);
  const file = store.windowsHelloFile(login.blz, login.userId);
  fs.writeFileSync(`${file}.abc123.tmp`, 'left over');
  await store.removeWindowsHello(login);
  assert.equal(store.isOn(login), false);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith(path.basename(file))), []);
});

test('a garbled file counts as one that does not open', async () => {
  fs.writeFileSync(store.windowsHelloFile(other.blz, other.userId), '{"not":"a box"}');
  assert.deepEqual(await store.openPin(other, helloKey, secret), { dropped: true });
  assert.equal(store.isOn(other), false);
});
