import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// STATE_DIR is read when state-store.ts loads, so the scratch directory has to
// be in place before the first import of security-key.ts.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fints-skey-'));
process.env.FINTS_STATE_DIR = dir;
const store = await import('./security-key.ts');

after(() => fs.rmSync(dir, { recursive: true, force: true }));

const login = { blz: '12345678', userId: 'kunde1', pin: '12345' };
const other = { blz: '50050201', userId: 'max', pin: '54321' };
const secret = crypto.randomBytes(32);
const answerA = crypto.randomBytes(32);
const answerB = crypto.randomBytes(32);
const credA = crypto.randomBytes(48).toString('base64');
const credB = crypto.randomBytes(48).toString('base64');

const files = () => fs.readdirSync(dir).filter((n) => n.endsWith('.skey'));
const clean = async () => {
  await store.removeSecurityKeys(login);
  await store.removeSecurityKeys(other);
};

test('parsers: a credential is base64 of a sensible length, a key id is what keyIdOf makes', () => {
  assert.equal(store.parseCredential(credA), credA);
  assert.equal(store.parseCredential('not base64!'), null);
  assert.equal(store.parseCredential('A'.repeat(1500)), null);
  assert.equal(store.parseCredential(undefined), null);
  assert.equal(store.parseKeyId(store.keyIdOf(credA)), store.keyIdOf(credA));
  assert.equal(store.parseKeyId('../../evil'), null);
  assert.equal(store.parseKeyId('ABCDEF0123456789'), null);
});

test('the salt is the login\'s own and the same each time', () => {
  assert.equal(store.saltOf(login), store.saltOf({ blz: login.blz, userId: login.userId }));
  assert.notEqual(store.saltOf(login), store.saltOf(other));
  assert.equal(Buffer.from(store.saltOf(login), 'base64').length, 32);
});

test('a kept PIN opens with its key and the shell\'s secret, and only those', async () => {
  await clean();
  assert.equal(await store.sealPin(login, credA, answerA, secret), 'sealed');
  assert.deepEqual(await store.openPin(login, credA, answerA, secret), { pin: '12345' });
  // The PIN is not in the file.
  assert.ok(!fs.readFileSync(path.join(dir, files()[0]), 'utf8').includes('12345'));
  // Without the shell's secret it does not open, and that copy goes.
  assert.deepEqual(await store.openPin(login, credA, answerA, crypto.randomBytes(32)), { dropped: true });
  assert.equal(files().length, 0);
});

test('a key the file does not know is simply not there', async () => {
  await clean();
  await store.sealPin(login, credA, answerA, secret);
  assert.equal(await store.openPin(login, credB, answerB, secret), null);
  assert.deepEqual(await store.openPin(login, credA, answerA, secret), { pin: '12345' });
});

test('a spare key: each opens on its own, and one that fails takes only its own copy', async () => {
  await clean();
  await store.sealPin(login, credA, answerA, secret);
  await store.sealPin(login, credB, answerB, secret);
  assert.equal(store.listKeys(login).length, 2);
  assert.deepEqual(await store.openPin(login, credB, answerB, secret), { pin: '12345' });
  assert.deepEqual(await store.openPin(login, credA, crypto.randomBytes(32), secret), { dropped: true });
  assert.deepEqual(store.listKeys(login).map((k) => k.credential), [credB]);
  assert.deepEqual(await store.openPin(login, credB, answerB, secret), { pin: '12345' });
});

test('logins are kept apart: one\'s file does not open as another\'s', async () => {
  await clean();
  await store.sealPin(login, credA, answerA, secret);
  await store.sealPin(other, credA, answerA, secret);
  assert.deepEqual(await store.openPin(other, credA, answerA, secret), { pin: '54321' });
  // One login's file put in the place of another's.
  const names = files();
  assert.equal(names.length, 2);
  const [first, second] = names.map((n) => path.join(dir, n));
  fs.copyFileSync(first, second);
  const opened = await Promise.all([
    store.openPin(login, credA, answerA, secret),
    store.openPin(other, credA, answerA, secret),
  ]);
  assert.equal(opened.filter((o) => o && 'dropped' in o).length, 1, 'the swapped file refuses');
  assert.equal(opened.filter((o) => o && 'pin' in o).length, 1, 'the real one still opens');
});

test('at most KEYS_MAX keys for a login; sealing one already there replaces it', async () => {
  await clean();
  const creds = Array.from({ length: store.KEYS_MAX }, () => crypto.randomBytes(32).toString('base64'));
  for (const c of creds) assert.equal(await store.sealPin(login, c, answerA, secret), 'sealed');
  assert.equal(await store.sealPin(login, credA, answerA, secret), 'full');
  assert.equal(await store.sealPin(login, creds[0], answerB, secret), 'sealed');
  assert.equal(store.listKeys(login).length, store.KEYS_MAX);
  assert.deepEqual(await store.openPin(login, creds[0], answerB, secret), { pin: '12345' });
});

test('one key goes; all of them go; other logins stay', async () => {
  await clean();
  await store.sealPin(login, credA, answerA, secret);
  await store.sealPin(login, credB, answerB, secret);
  await store.sealPin(other, credA, answerA, secret);
  await store.removeKey(login, store.keyIdOf(credA));
  assert.deepEqual(store.listKeys(login).map((k) => k.credential), [credB]);
  await store.removeSecurityKeys(login);
  assert.deepEqual(store.listKeys(login), []);
  assert.equal(store.listKeys(other).length, 1);
  assert.deepEqual(await store.openPin(other, credA, answerA, secret), { pin: '54321' });
});

test('a damaged file is not listed, and refuses to open', async () => {
  await clean();
  await store.sealPin(login, credA, answerA, secret);
  fs.writeFileSync(path.join(dir, files()[0]), 'not json');
  assert.deepEqual(store.listKeys(login), []);
  assert.deepEqual(await store.openPin(login, credA, answerA, secret), { dropped: true });
  assert.equal(files().length, 0);
});

test('a key keeps its name, and what it opens stays as it was', async () => {
  await clean();
  await store.sealPin(login, credA, answerA, secret);
  const id = store.keyIdOf(credA);
  await store.renameKey(login, id, 'Schluesselbund');
  assert.equal(store.listKeys(login)[0].name, 'Schluesselbund');
  assert.deepEqual(await store.openPin(login, credA, answerA, secret), { pin: '12345' });
  await store.renameKey(login, id, '');
  assert.equal(store.listKeys(login)[0].name, undefined);
  await store.renameKey(login, 'ffffffffffffffff', 'nobody');
  assert.equal(store.listKeys(login).length, 1);
});

test('a key name is on one line and not too long', () => {
  assert.equal(store.parseKeyName('  Blau  '), 'Blau');
  assert.equal(store.parseKeyName(''), '');
  assert.equal(store.parseKeyName('a\nb'), null);
  assert.equal(store.parseKeyName(5), null);
  assert.equal(store.parseKeyName('x'.repeat(50))?.length, store.KEY_NAME_MAX);
  assert.equal(store.parseKeyName('x'.repeat(500)), null);
});

test('what is not a PIN is not kept', async () => {
  await clean();
  await assert.rejects(store.sealPin({ ...login, pin: '' }, credA, answerA, secret));
  await assert.rejects(store.sealPin({ ...login, pin: 'a\nb' }, credA, answerA, secret));
  assert.equal(files().length, 0);
});
