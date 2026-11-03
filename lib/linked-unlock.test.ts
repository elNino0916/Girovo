import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// STATE_DIR is read when state-store.ts loads, so the scratch directory has to
// be in place before the first import of linked-unlock.ts.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fints-linked-'));
process.env.FINTS_STATE_DIR = dir;
const store = await import('./linked-unlock.ts');

after(() => fs.rmSync(dir, { recursive: true, force: true }));

const first = { blz: '12345678', userId: 'kunde1', pin: '12345' };
const sparkasse = { blz: '50050201', userId: 'max', pin: '54321' };
const dkb = { blz: '12030000', userId: 'max.muster', pin: '99999' };
const secret = crypto.randomBytes(store.SECRET_BYTES);

test('parseSecret: exactly 32 bytes of base64, nothing else', () => {
  assert.deepEqual(store.parseSecret(secret.toString('base64')), secret);
  assert.equal(store.parseSecret(crypto.randomBytes(16).toString('base64')), null);
  assert.equal(store.parseSecret('not base64!'), null);
  assert.equal(store.parseSecret(null), null);
  assert.equal(store.parseSecret(42), null);
});

test('a new login keeps nothing and is off', async () => {
  const fresh = { blz: '10010010', userId: 'neu', pin: '11111' };
  assert.equal(store.isOn(fresh), false);
  assert.deepEqual(await store.openLogins(fresh, secret), { on: false, linked: [] });
});

test('sealed further banks open with the first login\'s PIN and the secret', async () => {
  assert.equal(await store.sealLogins(first, secret, [sparkasse]), 1);
  assert.equal(store.isOn(first), true);
  assert.equal(await store.sealLogins(first, secret, [dkb]), 2);
  const opened = await store.openLogins(first, secret);
  assert.equal(opened.on, true);
  assert.deepEqual(opened.linked.map((l) => l.blz).sort(), [dkb.blz, sparkasse.blz].sort());
  assert.deepEqual(opened.linked.find((l) => l.blz === dkb.blz), dkb);
});

test('the file names no bank and holds no PIN in the clear', async () => {
  const file = store.linkedUnlockFile(first.blz, first.userId);
  const raw = fs.readFileSync(file, 'utf8');
  assert.match(path.basename(file), /^[0-9a-f]{32}\.linked$/);
  for (const word of [first.blz, first.userId, sparkasse.pin, sparkasse.userId, dkb.pin]) assert.equal(raw.includes(word), false, word);
});

test('a new PIN for a kept bank replaces the old one', async () => {
  await store.sealLogins(first, secret, [{ ...sparkasse, pin: '24680' }]);
  const opened = await store.openLogins(first, secret);
  assert.equal(opened.linked.filter((l) => l.blz === sparkasse.blz).length, 1);
  assert.equal(opened.linked.find((l) => l.blz === sparkasse.blz)?.pin, '24680');
});

test('the first login is never kept beside itself', async () => {
  await store.sealLogins(first, secret, [{ ...first }]);
  const opened = await store.openLogins(first, secret);
  assert.equal(opened.linked.some((l) => l.blz === first.blz && l.userId === first.userId), false);
});

test('another secret opens nothing and deletes the file', async () => {
  const other = { blz: '20020020', userId: 'zwei', pin: '22222' };
  await store.sealLogins(other, secret, [sparkasse]);
  assert.deepEqual(await store.openLogins(other, crypto.randomBytes(32)), { on: false, linked: [], dropped: true });
  assert.equal(store.isOn(other), false);
});

test('a changed first PIN opens nothing and deletes the file', async () => {
  const other = { blz: '30030030', userId: 'drei', pin: '33333' };
  await store.sealLogins(other, secret, [sparkasse]);
  assert.deepEqual(await store.openLogins({ ...other, pin: '33334' }, secret), { on: false, linked: [], dropped: true });
  assert.equal(store.isOn(other), false);
});

test('one login\'s file cannot be passed off as another\'s, even with the same PIN', async () => {
  const a = { blz: '40040040', userId: 'vier', pin: '44444' };
  const b = { blz: '40040040', userId: 'fuenf', pin: '44444' };
  await store.sealLogins(a, secret, [sparkasse]);
  fs.copyFileSync(store.linkedUnlockFile(a.blz, a.userId), store.linkedUnlockFile(b.blz, b.userId));
  assert.deepEqual(await store.openLogins(b, secret), { on: false, linked: [], dropped: true });
});

test('a damaged file counts as stale', async () => {
  const other = { blz: '50050050', userId: 'kaputt', pin: '55555' };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(store.linkedUnlockFile(other.blz, other.userId), '{"v":1,"nonsense":true}');
  assert.deepEqual(await store.openLogins(other, secret), { on: false, linked: [], dropped: true });
  assert.equal(store.isOn(other), false);
});

test('forgetLogin deletes one bank and keeps the switch on', async () => {
  const own = { blz: '60060060', userId: 'sechs', pin: '66666' };
  await store.sealLogins(own, secret, [sparkasse, dkb]);
  assert.deepEqual(await store.forgetLogin(own, secret, sparkasse), { on: true });
  const opened = await store.openLogins(own, secret);
  assert.deepEqual(opened, { on: true, linked: [dkb] });
  // The last one too: the switch stays on, with nothing kept.
  await store.forgetLogin(own, secret, dkb);
  assert.deepEqual(await store.openLogins(own, secret), { on: true, linked: [] });
});

test('removeLinkedUnlock takes the copies a cut-short write left beside the file', async () => {
  const own = { blz: '90090090', userId: 'neun', pin: '99999' };
  await store.sealLogins(own, secret, [sparkasse]);
  const file = store.linkedUnlockFile(own.blz, own.userId);
  fs.copyFileSync(file, `${file}.0a1b2c3d4e5f.tmp`);
  await store.removeLinkedUnlock(own);
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.startsWith(path.basename(file))), []);
});

test('removeLinkedUnlock turns it off without any key', async () => {
  const own = { blz: '70070070', userId: 'sieben', pin: '77777' };
  await store.sealLogins(own, secret, [sparkasse]);
  await store.removeLinkedUnlock(own);
  assert.equal(store.isOn(own), false);
  // Removing what is not there is no error.
  await store.removeLinkedUnlock(own);
});

test('at most LINKED_BANK_LIMITS.count further banks, the newest kept', async () => {
  const own = { blz: '80080080', userId: 'acht', pin: '88888' };
  for (let i = 0; i < 10; i++) {
    await store.sealLogins(own, secret, [{ blz: String(10000000 + i), userId: `u${i}`, pin: '12121' }]);
  }
  const opened = await store.openLogins(own, secret);
  assert.equal(opened.linked.length, 8);
  assert.ok(opened.linked.some((l) => l.userId === 'u9'));
  assert.ok(!opened.linked.some((l) => l.userId === 'u0'));
});

test('sanitizeLogins drops what is not a login', () => {
  const kept = store.sanitizeLogins([
    sparkasse,
    { ...dkb, blz: '1234' },
    { ...dkb, userId: 'a\u2028b' },
    { ...dkb, pin: '' },
    { ...dkb, pin: 'x'.repeat(65) },
    'nonsense',
    sparkasse,
  ], first);
  assert.deepEqual(kept, [sparkasse]);
});

test('loginOfSession reads the login and PIN a session holds', () => {
  assert.deepEqual(store.loginOfSession({ meta: { blz: first.blz }, client: { config: { userId: first.userId, pin: first.pin } } }), first);
  assert.equal(store.loginOfSession({ meta: { blz: first.blz }, client: { config: { userId: first.userId } } }), null);
  assert.equal(store.loginOfSession(null), null);
});

test('linkedUnlockServed: the desktop server and development only', () => {
  const env = { ...process.env };
  try {
    process.env.GIROVO_DESKTOP = '';
    (process.env as Record<string, string>).NODE_ENV = 'production';
    assert.equal(store.linkedUnlockServed(), false);
    process.env.GIROVO_DESKTOP = '1';
    assert.equal(store.linkedUnlockServed(), true);
    process.env.GIROVO_DESKTOP = '';
    (process.env as Record<string, string>).NODE_ENV = 'development';
    assert.equal(store.linkedUnlockServed(), true);
  } finally {
    process.env.GIROVO_DESKTOP = env.GIROVO_DESKTOP;
    (process.env as Record<string, string | undefined>).NODE_ENV = env.NODE_ENV;
  }
});
